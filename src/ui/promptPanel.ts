// Prompt panel (BRIEF §5): natural language -> Claude -> ops, applied as one undoable transaction.

import type { App } from '../app/app';
import type { Store } from '../app/store';
import { browserDeflate, encodeRGB8 } from '../core/png';
import { AnthropicProvider, DEFAULT_MODEL, MODELS, type Effort } from '../llm/anthropicProvider';
import { renderMapImage } from '../llm/mapImage';
import { MockProvider } from '../llm/mockProvider';
import type { TerrainProbe } from '../llm/probe';
import { runPrompt, summarizeOutcome, type PromptOutcome } from '../llm/prompter';
import type { LLMProvider } from '../llm/provider';
import { h } from './dom';

interface Settings { provider: 'anthropic' | 'mock'; model: string; effort: Effort; image: boolean }
interface Entry {
  prompt: string;
  explanation: string;
  summary: string;
  txId?: number;
  reverted?: boolean;
  outcome?: PromptOutcome;
  error?: string;
  at: string;
}

const KEY_KEY = 'tp:anthropicKey';
const SETTINGS_KEY = 'tp:llm';
const HISTORY_KEY = 'tp:prompts';

const load = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

/** A probe over the baked terrain the GM is looking at. */
export function appProbe(app: App): TerrainProbe | null {
  const s = app.heightSrc;
  if (!s) return null;
  return {
    kind: app.settings.erosion && app.world?.erosion.enabled ? 'eroded' : 'design',
    kmPerPx: s.kmPerPx,
    heightAt: (x, y) => app.heightAt(x, y),
    surfaceAt: (x, y, hm, slope) => app.classify(x, y, hm, slope),
  };
}

export async function mapImageBase64(app: App): Promise<string | undefined> {
  const probe = appProbe(app);
  if (!probe) return undefined;
  const r = renderMapImage(app.world!, probe, 800);
  const png = await encodeRGB8(r.width, r.height, r.rgba, browserDeflate);
  let bin = '';
  for (let i = 0; i < png.length; i += 0x8000) bin += String.fromCharCode(...png.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function mountPromptPanel(el: HTMLElement, app: App, store: Store) {
  const settings: Settings = load(SETTINGS_KEY, { provider: 'anthropic', model: DEFAULT_MODEL, effort: 'medium', image: true });
  const history: Entry[] = (load(HISTORY_KEY, { list: [] as Entry[] }).list ?? []).map((e) => ({ ...e, txId: undefined }));
  let running: AbortController | null = null;

  // ---- settings
  const keyIn = h('input', { type: 'password', placeholder: 'sk-ant-…', autocomplete: 'off', spellcheck: 'false', value: localStorage.getItem(KEY_KEY) ?? '', onchange: () => {
    try { if (keyIn.value.trim()) localStorage.setItem(KEY_KEY, keyIn.value.trim()); else localStorage.removeItem(KEY_KEY); } catch { /* ignore */ }
    sync();
  } });
  const provSel = h('select', { onchange: () => { settings.provider = provSel.value as Settings['provider']; persist(); } },
    h('option', { value: 'anthropic', text: 'Claude (your API key)' }), h('option', { value: 'mock', text: 'Offline mock (keyword rules)' }));
  const modelSel = h('select', { onchange: () => { settings.model = modelSel.value; persist(); } }, ...MODELS.map((m) => h('option', { value: m, text: m })));
  const effortSel = h('select', { title: 'How hard the model thinks: higher is slower and costs more', onchange: () => { settings.effort = effortSel.value as Effort; persist(); } },
    ...['low', 'medium', 'high'].map((m) => h('option', { value: m, text: m })));
  const imgChk = h('input', { type: 'checkbox', checked: settings.image, onchange: () => { settings.image = imgChk.checked; persist(); } });
  const details = h('details', { class: 'llm-settings' },
    h('summary', { text: 'Model settings' }),
    h('div', { class: 'row' }, h('span', { text: 'provider' }), provSel),
    h('div', { class: 'row' }, h('span', { text: 'model' }), modelSel),
    h('div', { class: 'row' }, h('span', { text: 'effort' }), effortSel),
    h('div', { class: 'row' }, h('span', { text: 'API key' }), keyIn),
    h('p', { class: 'warn', text: 'Your key is stored in this browser (localStorage) and sent straight from this page to api.anthropic.com. Anyone with access to this browser profile can read it. Use a key with a spending limit, and clear the field to remove it.' }),
    h('label', { class: 'inline' }, imgChk, 'send a top-down map image with each prompt'),
  );

  // ---- input
  const input = h('textarea', { rows: 4, placeholder: 'e.g. "a volcanic peak in 1208", "make the northern spine higher", "a river from 0605 to the lake in 0610"', onkeydown: (ev: Event) => {
    const k = ev as KeyboardEvent;
    if (k.key === 'Enter' && (k.ctrlKey || k.metaKey)) { ev.preventDefault(); void send(); }
  } });
  const sendBtn = h('button', { class: 'btn primary', text: 'Send', title: 'Ctrl+Enter', onclick: () => void send() });
  const stopBtn = h('button', { class: 'btn', text: 'Stop', onclick: () => running?.abort() });
  const status = h('div', { class: 'prompt-status' });
  const list = h('div', { class: 'prompt-history' });
  const clearBtn = h('button', { class: 'btn icon', text: '⌫', title: 'Clear prompt history (does not change the world)', onclick: () => { history.length = 0; persist(); renderHistory(); } });

  el.replaceChildren(
    h('div', { class: 'panel-head' }, h('h2', { text: 'Prompt' }), clearBtn),
    h('div', { class: 'prompt-body' }, details, input, h('div', { class: 'prompt-actions' }, sendBtn, stopBtn, status)),
    list,
  );

  function persist() {
    save(SETTINGS_KEY, settings);
    save(HISTORY_KEY, { list: history.slice(-30).map(({ outcome: _o, ...e }) => e) });
    sync();
  }

  function sync() {
    provSel.value = settings.provider;
    modelSel.value = settings.model;
    effortSel.value = settings.effort;
    const needKey = settings.provider === 'anthropic' && !keyIn.value.trim();
    modelSel.disabled = effortSel.disabled = keyIn.disabled = settings.provider !== 'anthropic';
    sendBtn.disabled = !!running;
    stopBtn.hidden = !running;
    if (needKey && !running) { status.textContent = 'Add an API key in Model settings, or pick the offline mock.'; details.open = true; }
    else if (!running && status.dataset.sticky !== '1') status.textContent = '';
  }

  function provider(): LLMProvider {
    if (settings.provider === 'mock') return new MockProvider();
    return new AnthropicProvider({ apiKey: keyIn.value.trim(), model: settings.model, effort: settings.effort });
  }

  async function send() {
    const prompt = input.value.trim();
    if (!prompt || running) return;
    if (settings.provider === 'anthropic' && !keyIn.value.trim()) { sync(); return; }
    running = new AbortController();
    status.dataset.sticky = '';
    sync();
    const startJson = JSON.stringify(store.world);
    const entry: Entry = { prompt, explanation: '', summary: '', at: new Date().toISOString() };
    try {
      status.textContent = 'preparing context…';
      const probe = appProbe(app);
      const image = settings.image && probe ? await mapImageBase64(app) : undefined;
      const out = await runPrompt({
        world: store.world, prompt, provider: provider(), probe, imagePngBase64: image,
        history: history.filter((e) => !e.error && !e.reverted).map((e) => ({ prompt: e.prompt, summary: e.summary })),
        signal: running.signal,
        onProgress: (m) => { status.textContent = m; },
      });
      entry.outcome = out;
      entry.explanation = out.explanation + (out.warning ? `\n(${out.warning})` : '');
      entry.summary = summarizeOutcome(out);
      if (out.changed) {
        if (JSON.stringify(store.world) !== startJson) throw new Error('The world changed while waiting for the reply, so the edits were not applied. Send the prompt again.');
        const c = store.commit(`prompt: ${prompt.length > 40 ? prompt.slice(0, 39) + '…' : prompt}`, (w) => {
          Object.assign(w, JSON.parse(JSON.stringify(out.world)));
          return out.changedOps;
        });
        entry.txId = c?.txId;
      }
      input.value = '';
      status.textContent = out.changed ? 're-baking…' : 'no changes';
      if (out.changed) {
        const t = window.setInterval(() => {
          if (app.stage === 'ready' || app.stage === 'error') { window.clearInterval(t); if (!running) status.textContent = app.stage === 'ready' ? 'done' : 'bake failed'; }
        }, 500);
      }
    } catch (e) {
      entry.error = (e as Error).name === 'AbortError' || running?.signal.aborted ? 'stopped' : (e instanceof Error ? e.message : String(e));
      status.textContent = '';
    } finally {
      running = null;
      history.push(entry);
      status.dataset.sticky = '1';
      persist();
      renderHistory();
      list.scrollTop = 0;
    }
  }

  function renderHistory() {
    list.replaceChildren(...[...history].reverse().map((e) => {
      const o = e.outcome;
      const log = o?.log.length
        ? h('details', { class: 'tool-log' }, h('summary', { text: `${o.log.length} tool call${o.log.length > 1 ? 's' : ''}${o.usage.input ? ` · ${o.usage.input + o.usage.cacheRead + o.usage.cacheWrite}→${o.usage.output} tok` : ''}${o.model ? ` · ${o.model}` : ''}` }),
          ...o.log.map((l) => h('div', { class: `tl ${l.ok ? 'ok' : 'err'}` }, h('b', { text: `${l.ok ? '✓' : '✗'} ${l.name} ` }), h('code', { text: JSON.stringify(l.input) }), h('div', { class: 'res', text: l.result }))))
        : null;
      const revert = e.txId !== undefined && !e.reverted
        ? h('button', { class: 'btn', text: 'Revert', title: 'Undo just this prompt\'s edits (later edits are kept)', onclick: () => {
            if (store.revertTx(e.txId!, `revert prompt: ${e.prompt.slice(0, 30)}`)) { e.reverted = true; persist(); renderHistory(); }
          } })
        : null;
      return h('div', { class: `prompt-entry${e.error ? ' error' : ''}${e.reverted ? ' reverted' : ''}` },
        h('div', { class: 'p', text: e.prompt }),
        e.error ? h('div', { class: 'x err', text: e.error }) : h('div', { class: 'x', text: e.explanation }),
        o?.changedOps.length ? h('div', { class: 'chips' }, ...o.changedOps.map((id) => h('span', { class: 'chip', text: id }))) : null,
        log,
        h('div', { class: 'meta' }, h('span', { text: new Date(e.at).toLocaleTimeString() + (e.reverted ? ' · reverted' : '') }), revert),
      );
    }));
  }

  sync();
  renderHistory();
}
