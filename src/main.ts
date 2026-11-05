import { App } from './app/app';
import { Store } from './app/store';
import { defaultWorld, loadWorld } from './core/world';
import type { World } from './core/types';
import { mountToolbar } from './ui/toolbar';
import { mountHud } from './ui/hud';
import { mountOpsPanel } from './ui/opsPanel';
import { mountPromptPanel } from './ui/promptPanel';
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
const store = new Store(initialWorld());
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
  mountPromptPanel(document.getElementById('prompt-panel')!, app, store);
}

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
  renderFrames(n = 2) { for (let i = 0; i < n; i++) app.frame(); },
  timings: () => app.timings,
};
