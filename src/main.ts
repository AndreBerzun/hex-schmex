import { App } from './app/app';
import { Store } from './app/store';
import { defaultWorld, loadWorld } from './core/world';
import type { World } from './core/types';
import { mountToolbar } from './ui/toolbar';
import { mountHud } from './ui/hud';
import { mountOpsPanel } from './ui/opsPanel';
import { mountLinkPanel } from './ui/linkPanel';
import { MapLink } from './app/mapLink';
import { exampleWorld, EXAMPLES } from './worlds';
import { defaultViews, viewNames } from './app/views';

const params = new URLSearchParams(location.search);
const shot = params.has('shot');
if (shot) document.body.classList.add('shot');

function initialWorld(): World {
  const name = params.get('world');
  if (name) {
    const w = exampleWorld(name);
    if (w) return w;
  }
  if (!shot) {
    try {
      const saved = localStorage.getItem('tp:world');
      if (saved) return loadWorld(JSON.parse(saved));
    } catch { /* ignore */ }
  }
  return exampleWorld('alpine-valley') ?? defaultWorld();
}

const canvas = document.getElementById('view') as HTMLCanvasElement;
let app: App;
try {
  app = new App(canvas, { preserveDrawingBuffer: shot });
} catch (e) {
  document.getElementById('viewport')!.innerHTML = `<div class="empty">WebGL2 with float render targets is required.<br>${String(e)}</div>`;
  throw e;
}
// Live link to a map file on disk (dev server only): ?file=<name>, else the last linked file.
const linkName = params.get('file') ?? (shot ? null : (() => { try { return localStorage.getItem('tp:link'); } catch { return null; } })());
let linked: { name: string; text: string; world: World } | null = null;
if (MapLink.available && linkName) {
  try {
    const text = await MapLink.fetchText(linkName);
    linked = { name: linkName, text, world: loadWorld(JSON.parse(text)) };
  } catch (e) {
    console.warn(String(e));
    if (!params.has('file')) try { localStorage.removeItem('tp:link'); } catch { /* ignore */ }
  }
}
const store = new Store(linked?.world ?? initialWorld());
const link = MapLink.available ? new MapLink(store) : null;
// per-viewer view preferences (hex grid off while sculpting, etc.)
const PREF_KEYS = ['hexGrid', 'labels', 'exag', 'timeOfDay'] as const;
if (!shot) {
  try {
    const p = JSON.parse(localStorage.getItem('tp:prefs') ?? '{}');
    for (const k of PREF_KEYS) if (p[k] !== undefined) (app.settings as unknown as Record<string, unknown>)[k] = p[k];
  } catch { /* ignore */ }
  setInterval(() => {
    try {
      const p = Object.fromEntries(PREF_KEYS.map((k) => [k, app.settings[k]]));
      localStorage.setItem('tp:prefs', JSON.stringify(p));
    } catch { /* ignore */ }
  }, 2000);
}
if (params.has('eres')) app.settings.erodedRes = Number(params.get('eres'));
if (params.has('iters')) app.settings.iterations = Number(params.get('iters'));
if (params.has('noerosion')) app.settings.erosion = false;
if (params.has('exag')) app.settings.exag = Number(params.get('exag'));
if (params.has('tod')) app.settings.timeOfDay = Number(params.get('tod'));
if (params.has('debug')) app.settings.debug = Number(params.get('debug'));
if (params.has('nohex')) app.settings.hexGrid = false;
app.applySettings();

const ro = new ResizeObserver(() => app.resize());
ro.observe(canvas);
app.resize();

if (!shot) {
  mountToolbar(document.getElementById('toolbar')!, app, store, EXAMPLES);
  mountHud(app);
  mountOpsPanel(document.getElementById('ops-panel')!, app, store);
  mountLinkPanel(document.getElementById('prompt-panel')!, store, link);
}
if (link && linked) link.adopt(linked.name, linked.text);

let saveTimer = 0;
store.subscribe((c) => {
  if (c.kind === 'terrain' || c.kind === 'load') void app.setWorld(store.world, { keepCamera: c.kind !== 'load' });
  else if (c.kind === 'climate') void app.updateClimate(store.world);
  if (!shot) {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try { localStorage.setItem('tp:world', JSON.stringify(store.world)); } catch { /* quota */ }
    }, 400);
  }
});

const ready = app.setWorld(store.world);
app.start();

// Scripting / screenshot hooks
declare global {
  interface Window { __tp: unknown }
}
window.__tp = {
  app,
  store,
  ready,
  viewNames,
  async finish() { await ready; await app.finishNow(); },
  setView(name: string) {
    const views = { ...defaultViews(app), ...(store.world.meta.views ?? {}) };
    if (name === 'region-topdown') { app.setSettings({ mapMode: true }); return true; }
    app.setSettings({ mapMode: false });
    if (name === 'region-oblique' && !store.world.meta.views?.['region-oblique']) { app.resetCamera(); return true; }
    const v = views[name];
    if (!v) return false;
    app.setView(v);
    return true;
  },
  renderFrames(n = 2) { for (let i = 0; i < n; i++) { app.invalidate(); app.frame(); } },
  timings: () => app.timings,
};
