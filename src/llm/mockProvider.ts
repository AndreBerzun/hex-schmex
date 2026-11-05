// Deterministic offline provider: keyword rules turn a prompt into plausible tool calls. For tests and for
// trying the prompt flow without an API key. Not smart, but it exercises the whole loop.

import type Anthropic from '@anthropic-ai/sdk';
import type { CompletionRequest, LLMProvider, ToolCallResult } from './provider';

type Block = Anthropic.Beta.BetaContentBlockParam;

export class MockProvider implements LLMProvider {
  readonly name = 'mock';
  private n = 0;

  async complete(req: CompletionRequest): Promise<ToolCallResult> {
    const last = req.messages[req.messages.length - 1];
    const blocks = Array.isArray(last.content) ? last.content : [{ type: 'text', text: last.content } as Block];
    const results = blocks.filter((b) => b.type === 'tool_result') as Anthropic.Beta.BetaToolResultBlockParam[];
    if (results.length) {
      const errs = results.filter((r) => r.is_error);
      const text = errs.length
        ? `Mock: ${errs.length} of ${results.length} edits failed (${String(errs[0].content).slice(0, 120)}).`
        : `Mock: applied ${results.length} edit${results.length > 1 ? 's' : ''}. (Offline mock provider, keyword rules only.)`;
      return { content: [{ type: 'text', text }], stopReason: 'end_turn', model: 'mock' };
    }
    const all = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    const prompt = (all.match(/^Request: ([\s\S]*)$/m)?.[1] ?? all).trim();
    const ops = [...all.matchAll(/^\d+: (\{.*\})$/gm)].map((m) => JSON.parse(m[1]) as Record<string, unknown>);
    const calls = plan(prompt, ops);
    return {
      content: calls.map((c) => ({ type: 'tool_use', id: `mock_${++this.n}`, name: c.name, input: c.input }) as Block),
      stopReason: 'tool_use',
      model: 'mock',
    };
  }
}

interface Call { name: string; input: Record<string, unknown> }

export function plan(prompt: string, ops: Record<string, unknown>[]): Call[] {
  const p = prompt.toLowerCase();
  const hexes = prompt.match(/\b\d{4}\b/g) ?? [];
  const side = p.match(/\b(north|south|east|west)(?:ern)?\b/)?.[1];
  const S = side ? side[0].toUpperCase() : undefined;
  const add = (op: Record<string, unknown>): Call => ({ name: 'add_op', input: { op } });
  const findOp = (types: string[]) => [...ops].reverse().find((o) => types.includes(String(o.type)));

  if (/\b(higher|taller|raise|bigger)\b/.test(p) && !hexes.length) {
    const o = findOp(['ridge', 'peak', 'plateau']);
    if (o) return [{ name: 'update_op', input: { id: o.id, patch: { height: Math.round(Number(o.height ?? 1500) * 1.3) } } }];
  }
  if (/\b(lower|smaller|flatter)\b/.test(p) && !hexes.length) {
    const o = findOp(['ridge', 'peak', 'plateau', 'hills']);
    if (o) return [{ name: 'update_op', input: { id: o.id, patch: o.type === 'hills' ? { amplitude: Math.round(Number(o.amplitude) * 0.7) } : { height: Math.round(Number(o.height ?? 1500) * 0.7) } } }];
  }
  if (/\b(remove|delete)\b/.test(p)) {
    const o = ops.find((x) => p.includes(String(x.label).toLowerCase())) ?? ops[ops.length - 1];
    if (o) return [{ name: 'remove_op', input: { id: o.id } }];
  }
  if (/volcan/.test(p)) return [add({ type: 'peak', label: 'Volcano', center: hexes[0] ?? 'center', height: 2400, radius: 12, shape: 'volcano' })];
  if (/\b(sea|coast|ocean)\b/.test(p)) return [add({ type: 'coast', label: `${side ?? 'western'} coast`, side: S ?? 'W', extentKm: 30 })];
  if (/\b(ridge|range|mountains)\b/.test(p) && hexes.length >= 2) return [add({ type: 'ridge', label: 'Mountain range', points: hexes, height: 2200, width: 16 })];
  if (/\b(peak|mountain)\b/.test(p)) return [add({ type: 'peak', label: 'Peak', center: hexes[0] ?? 'center', height: 2000, radius: 10 })];
  if (/\briver\b/.test(p) && hexes.length >= 2) return [add({ type: 'river', label: 'River', points: hexes })];
  if (/\bcanyon\b/.test(p) && hexes.length >= 2) return [add({ type: 'canyon', label: 'Canyon', points: hexes })];
  if (/\bvalley\b/.test(p) && hexes.length >= 2) return [add({ type: 'valley', label: 'Valley', points: hexes, profile: /glacia/.test(p) ? 'U' : 'V' })];
  if (/\b(lake|basin)\b/.test(p)) return [add({ type: 'basin', label: 'Lake basin', region: { hex: hexes[0] ?? 'center', radius: 1 }, depth: 200 })];
  if (/\b(desert|dry|arid)\b/.test(p)) return [add({ type: 'moisture', label: 'Dry country', region: hexes.length ? { hexes } : { side: S ?? 'E', fraction: 0.4 }, delta: -0.5 })];
  if (/\b(forest|wet|swamp|marsh)\b/.test(p)) return [add({ type: 'moisture', label: 'Wet country', region: hexes.length ? { hexes } : { side: S ?? 'W', fraction: 0.4 }, delta: 0.45 })];
  if (/\b(plain|flat)\b/.test(p)) return [add({ type: 'lowlands', label: 'Plains', region: hexes.length ? { hexes } : { side: S ?? 'S', fraction: 0.35 }, targetElevation: 150 })];
  return [add({ type: 'hills', label: 'Hills', region: hexes.length ? { hex: hexes[0], radius: 2 } : side ? { side: S, fraction: 0.35 } : 'all', amplitude: 220, wavelengthKm: 7 })];
}
