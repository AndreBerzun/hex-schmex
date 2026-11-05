// Top toolbar: file, edit, view, erosion, export, go-to-hex.
import { DEBUG_NAMES, type App } from '../app/app';
import type { Store } from '../app/store';
import { parseHexId } from '../core/hex';
import { EROSION_PRESETS, defaultWorld, loadWorld, serializeWorld, setWorldParam } from '../core/world';
import type { ErosionSettings } from '../core/types';
import { exampleWorld } from '../worlds';
import { download, h, pickFile } from './dom';
import { exportHeightPng, exportScreenshot } from './exports';

export function mountToolbar(el: HTMLElement, app: App, store: Store, examples: Record<string, unknown>) {
  const btn = (text: string, title: string, onclick: () => void, cls = 'btn') => h('button', { class: cls, title, text, onclick });
  const toggle = (text: string, title: string, get: () => boolean, set: (v: boolean) => void) => {
    const b = btn(text, title, () => { set(!get()); sync(); });
    toggles.push(() => b.classList.toggle('on', get()));
    return b;
  };
  const toggles: (() => void)[] = [];

  // ---- file
  const exampleSel = h('select', { title: 'Load an example world', onchange: () => {
    const w = exampleWorld(exampleSel.value);
    if (w) store.replace(w, `load ${exampleSel.value}`);
    exampleSel.value = '';
  } }, h('option', { value: '', text: 'Examples…' }), ...Object.keys(examples).map((k) => h('option', { value: k, text: k })));
  const file = h('div', { class: 'group' },
    h('span', { class: 'title', text: 'Terrain Prompter' }),
    btn('New', 'New empty world', () => { if (confirm('Start a new empty world? (unsaved changes are kept in undo history only)')) store.replace(defaultWorld(), 'new world'); }),
    btn('Open', 'Open a world JSON', async () => {
      const f = await pickFile('.json,application/json');
      if (!f) return;
      try { store.replace(loadWorld(JSON.parse(await f.text())), `open ${f.name}`); }
      catch (e) { alert(`Could not load world: ${String(e)}`); }
    }),
    btn('Save', 'Download the world JSON', () => download(`${slug(store.world.meta.name)}.json`, serializeWorld(store.world))),
    exampleSel,
  );

  // ---- edit
  const undo = btn('↶', 'Undo (Ctrl+Z)', () => store.undo(), 'btn icon');
  const redo = btn('↷', 'Redo (Ctrl+Shift+Z)', () => store.redo(), 'btn icon');
  const edit = h('div', { class: 'group' }, undo, redo);

  // ---- view
  const dbg = h('select', { title: 'Debug views', onchange: () => app.setSettings({ debug: Number(dbg.value) }) },
    ...DEBUG_NAMES.map((n, i) => h('option', { value: i, text: i === 0 ? 'view: shaded' : `debug: ${n}` })));
  const exag = h('input', { type: 'range', min: 1, max: 4, step: 0.1, value: app.settings.exag, title: 'Vertical exaggeration (display only)', oninput: () => {
    app.setSettings({ exag: Number(exag.value) });
    exagLbl.textContent = `×${Number(exag.value).toFixed(1)}`;
  } });
  const exagLbl = h('span', { text: `×${app.settings.exag.toFixed(1)}` });
  const tod = h('input', { type: 'range', min: 6.5, max: 19.5, step: 0.25, value: app.settings.timeOfDay, title: 'Time of day (sun)', oninput: () => {
    app.setSettings({ timeOfDay: Number(tod.value) });
    todLbl.textContent = fmtTime(Number(tod.value));
  } });
  const todLbl = h('span', { text: fmtTime(app.settings.timeOfDay) });
  const view = h('div', { class: 'group' },
    toggle('Map', 'Top-down map mode (orthographic)', () => app.settings.mapMode, (v) => app.setSettings({ mapMode: v })),
    toggle('Hexes', 'Hex grid overlay', () => app.settings.hexGrid, (v) => app.setSettings({ hexGrid: v })),
    toggle('Labels', 'Hex labels', () => app.settings.labels, (v) => app.setSettings({ labels: v })),
    dbg,
    h('label', { class: 'inline' }, 'exag', exag, exagLbl),
    h('label', { class: 'inline' }, 'sun', tod, todLbl),
  );

  // ---- erosion
  const preset = h('select', { title: 'Erosion strength', onchange: () => {
    store.commit(`erosion ${preset.value}`, (w) => { setWorldParam(w, 'erosion.preset', preset.value as ErosionSettings['preset']); });
  } }, ...Object.keys(EROSION_PRESETS).map((k) => h('option', { value: k, text: k })));
  const ero = h('div', { class: 'group' },
    toggle('Erosion', 'Run erosion after every change', () => app.settings.erosion && store.world.erosion.enabled, (v) => {
      app.settings.erosion = v;
      if (v && !store.world.erosion.enabled) store.commit('enable erosion', (w) => { w.erosion.enabled = true; });
      else void app.setWorld(store.world, { keepCamera: true });
    }),
    preset,
    btn('Re-bake', 'Re-run evaluation and erosion', () => void app.setWorld(store.world, { keepCamera: true })),
  );

  // ---- goto + export
  const hexIn = h('input', { type: 'text', placeholder: '0507', size: 5, title: 'Hex id', onkeydown: (ev: Event) => { if ((ev as KeyboardEvent).key === 'Enter') go(); } });
  const go = () => { if (parseHexId(hexIn.value)) app.goToHex(hexIn.value); };
  const nav = h('div', { class: 'group' },
    hexIn, btn('Go', 'Fly to hex', go),
    btn('Overview', 'Back to the region overview', () => { app.setSettings({ mapMode: false }); app.resetCamera(); }),
  );
  const exp = h('div', { class: 'group' },
    btn('PNG16', 'Export 16-bit grayscale heightmap', () => void exportHeightPng(app, store.world)),
    btn('Shot', 'Screenshot at the current camera', () => void exportScreenshot(app, store.world)),
  );

  el.append(file, edit, view, ero, nav, exp);

  function sync() {
    toggles.forEach((f) => f());
    undo.disabled = !store.canUndo;
    redo.disabled = !store.canRedo;
    undo.title = store.canUndo ? `Undo ${store.undoLabel}` : 'Undo';
    redo.title = store.canRedo ? `Redo ${store.redoLabel}` : 'Redo';
    preset.value = store.world.erosion.preset;
  }
  store.subscribe(sync);
  sync();

  window.addEventListener('keydown', (ev) => {
    const t = ev.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) store.redo(); else store.undo();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') {
      ev.preventDefault();
      store.redo();
    } else if (ev.key === 'm') { app.setSettings({ mapMode: !app.settings.mapMode }); sync(); }
    else if (ev.key === 'g') { app.setSettings({ hexGrid: !app.settings.hexGrid }); sync(); }
  });
}

function fmtTime(t: number) {
  const hh = Math.floor(t), mm = Math.round((t - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'world';
}
