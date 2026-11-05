// The prompt runner: world context + prompt -> model -> tool calls applied to a draft world. The caller
// commits the draft as ONE undoable transaction (browser: Store.commit; CLI: write the file).

import type Anthropic from '@anthropic-ai/sdk';
import { cloneWorld } from '../core/world';
import type { World } from '../core/types';
import { buildContext } from './context';
import type { TerrainProbe } from './probe';
import type { LLMProvider, ToolCallResult } from './provider';
import { SYSTEM_PROMPT } from './systemPrompt';
import { TOOLS, ToolExecutor, diffOps, type ToolLogEntry } from './tools';

export interface PromptInput {
  world: World;
  prompt: string;
  provider: LLMProvider;
  /** current terrain for the elevation table and query_region (null: ops only) */
  probe: TerrainProbe | null;
  /** optional top-down map image, PNG base64 (no data: prefix) */
  imagePngBase64?: string;
  history?: { prompt: string; summary: string }[];
  maxTurns?: number;
  signal?: AbortSignal;
  onProgress?: (msg: string) => void;
}

export interface PromptOutcome {
  world: World;
  /** op ids added or modified */
  changedOps: string[];
  removedOps: string[];
  explanation: string;
  log: ToolLogEntry[];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  model?: string;
  /** true if anything in the world changed */
  changed: boolean;
  /** set when the model declined or the loop was cut short */
  warning?: string;
}

export async function runPrompt(inp: PromptInput): Promise<PromptOutcome> {
  const { world, prompt, provider } = inp;
  const draft = cloneWorld(world);
  const exec = new ToolExecutor(draft, inp.probe, world);
  const context = buildContext(world, inp.probe, { history: inp.history });
  const first: Anthropic.Beta.BetaContentBlockParam[] = [{ type: 'text', text: context }];
  if (inp.imagePngBase64) {
    first.push({ type: 'text', text: 'Top-down map of the current terrain (north up, hex ids drawn in each hex, hillshade lit from the NW, colours = surface):' });
    first.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: inp.imagePngBase64 } });
  }
  first.push({ type: 'text', text: `Request: ${prompt}` });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: first }];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const log: ToolLogEntry[] = [];
  let explanation = '';
  let model: string | undefined;
  let warning: string | undefined;
  const maxTurns = inp.maxTurns ?? 6;

  for (let turn = 0; ; turn++) {
    inp.onProgress?.(turn === 0 ? 'asking the model…' : `turn ${turn + 1}…`);
    const res: ToolCallResult = await provider.complete({ system: SYSTEM_PROMPT, tools: TOOLS, messages, signal: inp.signal });
    model = res.model ?? model;
    if (res.usage) for (const k of Object.keys(usage) as (keyof typeof usage)[]) usage[k] += res.usage[k];
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (text) explanation = text;
    if (res.stopReason === 'refusal') { warning = `declined: ${res.refusal ?? ''}`; break; }
    const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === 'tool_use');
    if (!uses.length) break;
    if (res.stopReason === 'max_tokens') { warning = 'the reply was cut off (max_tokens); its last tool calls were not applied'; break; }
    messages.push({ role: 'assistant', content: res.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const u of uses) {
      const entry = exec.run(u.name, u.input);
      log.push(entry);
      inp.onProgress?.(`${u.name}${entry.opId ? ` ${entry.opId}` : ''}${entry.ok ? '' : ' (failed)'}`);
      results.push({ type: 'tool_result', tool_use_id: u.id, content: entry.result, ...(entry.ok ? {} : { is_error: true }) });
    }
    messages.push({ role: 'user', content: results });
    if (turn + 1 >= maxTurns) { warning = `stopped after ${maxTurns} model turns; edits so far were kept`; break; }
  }

  const changed = JSON.stringify(draft) !== JSON.stringify(world);
  return {
    world: draft,
    changedOps: diffOps(world, draft),
    removedOps: [...exec.removed],
    explanation: explanation || (changed ? 'Done.' : 'No changes.'),
    log, usage, model, changed, warning,
  };
}

/** One-line summary of an outcome for the session history sent with later prompts. */
export function summarizeOutcome(o: PromptOutcome): string {
  const ok = o.log.filter((l) => l.ok && l.name !== 'query_region');
  if (!ok.length) return 'no edits';
  return ok.map((l) => `${l.name}${l.opId ? ` ${l.opId}` : ''}`).join(', ');
}
