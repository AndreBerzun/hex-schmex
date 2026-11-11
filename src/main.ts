import { App } from './app/app';
import { Store } from './app/store';
import { defaultWorld, loadWorld } from './core/world';
import type { World } from './core/types';
import { mountExplorer } from './ui/explorer';
import { mountToolbar } from './ui/toolbar';
import { mountHud } from './ui/hud';
import { mountOpsPanel } from './ui/opsPanel';
import { mountLinkPanel } from './ui/linkPanel';
import { mountBrushPanel } from './ui/brushPanel';
import { MapLink } from './app/mapLink';
import { exampleWorld, EXAMPLES } from './worlds';
import { defaultViews, viewNames } from './app/views';

const params = new URLSearchParams(location.search);
const shot = params.has('shot');
const editor = params.has('editor');
if (!editor) document.body.classList.add('explorer');
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
const linkName = params.get('file') ?? (shot || params.has('world') ? null : (() => { try { return localStorage.getItem('tp:link'); } catch { return null; } })());
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
app.bakeStore = link;
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
const { initialView: _initialView, ...previewSettings } = store.world.meta.preview ?? {};
Object.assign(app.settings, previewSettings);
if (params.has('tide')) app.settings.tide = Number(params.get('tide'));
if (params.has('eres')) app.settings.erodedRes = Number(params.get('eres'));
if (params.has('iters')) app.settings.iterations = Number(params.get('iters'));
if (params.has('noerosion')) app.settings.erosion = false;
if (params.has('exag')) app.settings.exag = Number(params.get('exag'));
if (params.has('tod')) app.settings.timeOfDay = Number(params.get('tod'));
if (params.has('debug')) app.settings.debug = Number(params.get('debug'));
if (!editor) { app.settings.hexGrid = false; app.settings.labels = false; }
if (params.has('nohex')) app.settings.hexGrid = false;
app.applySettings();

const ro = new ResizeObserver(() => app.resize());
ro.observe(canvas);
app.resize();

if (!shot) {
  mountHud(app);
  if (editor) {
    mountToolbar(document.getElementById('toolbar')!, app, store, EXAMPLES);
    const left = document.getElementById('ops-panel')!;
    const brushEl = document.createElement('section');
    const opsEl = document.createElement('section');
    left.append(brushEl, opsEl);
    mountBrushPanel(brushEl, app, store);
    mountOpsPanel(opsEl, app, store);
    mountLinkPanel(document.getElementById('prompt-panel')!, store, link);
  } else mountExplorer(document.getElementById('toolbar')!, app, store);
}
if (link && linked) link.adopt(linked.name, linked.text);

let saveTimer = 0;
store.subscribe((c) => {
  if (c.kind === 'load') {
    const { initialView: _view, ...settings } = store.world.meta.preview ?? {};
    app.setSettings({ tide: 0, ...settings });
  }
  if (c.kind === 'terrain' || c.kind === 'load') void app.setWorld(store.world, { keepCamera: c.kind !== 'load' });
  else if (c.kind === 'sculpt') void app.updateSculpt(store.world);
  else if (c.kind === 'paint') app.updatePaint(store.world);
  else if (c.kind === 'climate') void app.updateClimate(store.world);
  else if (c.kind === 'meta') app.updatePresentation(store.world);
  if (!shot) {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try { localStorage.setItem('tp:world', JSON.stringify(store.world)); } catch { /* quota */ }
    }, 400);
  }
});

if (params.has('shot')) app.sceneryBudgetMs = 1e9;
if (params.get('scenery') === '0') app.sceneryOn = false;
app.downsWalkPrototype = params.get('prototype') === 'downs-walk' && params.get('world') === 'forgotten-shore';
const ready = app.setWorld(store.world);
if (app.downsWalkPrototype && !shot) void ready.then(async () => {
  await app.finishNow();
  app.setSettings({ exag: 1, timeOfDay: 12, tide: 0, mapMode: false });
  app.ground.enter();
  app.camera.position.set(40.83, 0, 45.83);
  app.ground.placeCamera();
  app.camera.lookAt(40.83, app.camera.position.y, 46.23);
  app.invalidate();
});
if (params.has('tide')) app.setSettings({ tide: Number(params.get('tide')) });
app.start();

// Scripting / screenshot hooks
declare global {
  interface Window { __tp: unknown }
}
window.__tp = {
  app,
  store,
  ready,
  get viewNames() { return [...new Set([...viewNames, ...Object.keys(store.world.meta.views ?? {})])]; },
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
  renderFrames(n = 2) { for (let i = 0; i < n; i++) { app.frame(); app.render(); } },
  timings: () => app.timings,
};
