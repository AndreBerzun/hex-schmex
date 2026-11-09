import { MOUSE } from 'three';
import type { App } from '../app/app';
import type { Store } from '../app/store';
import { hexId, pointToHex } from '../core/hex';
import { BIOMES, normalizePaint, normalizeSculpt } from '../core/layers';
import { newOpId } from '../core/opSchema';
import { biomeLabel } from '../core/surfaces';
import type { Biome, PaintEdit, SculptEdit, SculptTool, Vec2 } from '../core/types';
import { h } from './dom';

type Tool = SculptTool | 'paint';

const TOOLS: { id: Tool; text: string; title: string }[] = [
  { id: 'raise', text: 'Raise', title: 'Lift the ground under the stroke by the set height' },
  { id: 'lower', text: 'Lower', title: 'Sink the ground under the stroke by the set height' },
  { id: 'flatten', text: 'Flatten', title: 'Level the ground to the height where the stroke starts' },
  { id: 'smooth', text: 'Smooth', title: 'Soften the relief under the stroke' },
  { id: 'paint', text: 'Paint', title: 'Paint a biome; paint wins over the climate rules' },
];

interface BrushState {
  tool: Tool | null;
  biome: Biome;
  sizeKm: number;
  heightM: number;
  strength: number;
  edge: number;
}

const PREF_KEY = 'tp:brush';
const SIZE = { min: 0.2, max: 25 };
const HEIGHT = { min: 10, max: 1500 };

const toLog = (v: number, r: { min: number; max: number }) => Math.log(v / r.min) / Math.log(r.max / r.min);
const fromLog = (t: number, r: { min: number; max: number }) => r.min * Math.pow(r.max / r.min, t);
const round2 = (v: number) => Math.round(v * 100) / 100;

function hexOf(p: Vec2, app: App): string {
  const c = pointToHex(app.grid, p);
  return hexId(Math.max(0, c.col), Math.max(0, c.row));
}

export function mountBrushPanel(el: HTMLElement, app: App, store: Store) {
  const st: BrushState = { tool: null, biome: 'forest', sizeKm: 3, heightM: 150, strength: 1, edge: 0.5 };
  try { Object.assign(st, JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}'), { tool: null }); } catch { return; }
  const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...st, tool: null })); } catch { return; } };

  const canvas = app.renderer.domElement;
  const toolBtns = new Map<Tool, HTMLButtonElement>();
  const head = h('div', { class: 'panel-head' }, h('h2', { text: 'Brushes' }));
  const toolRow = h('div', { class: 'brush-tools' }, ...TOOLS.map((t) => {
    const b = h('button', { class: 'btn', text: t.text, title: t.title, onclick: () => setTool(st.tool === t.id ? null : t.id) });
    toolBtns.set(t.id, b);
    return b;
  }));
  const biomeSel = h('select', { 'aria-label': 'Biome', onchange: () => { st.biome = biomeSel.value as Biome; savePrefs(); } });
  const slider = (label: string, get: () => number, set: (t: number) => void, fmt: () => string) => {
    const out = h('span', { class: 'brush-val' });
    const input = h('input', { type: 'range', min: 0, max: 1, step: 0.005, value: get(), 'aria-label': label, oninput: () => { set(Number(input.value)); out.textContent = fmt(); savePrefs(); } });
    out.textContent = fmt();
    const row = h('label', { class: 'brush-row' }, h('span', { text: label }), input, out);
    return { row, input, out, sync: () => { input.value = String(get()); out.textContent = fmt(); } };
  };
  const size = slider('Size', () => toLog(st.sizeKm, SIZE), (t) => { st.sizeKm = round2(fromLog(t, SIZE)); }, () => `${st.sizeKm < 1 ? Math.round(st.sizeKm * 1000) + ' m' : st.sizeKm.toFixed(1) + ' km'}`);
  const height = slider('Height', () => toLog(st.heightM, HEIGHT), (t) => { st.heightM = Math.round(fromLog(t, HEIGHT)); }, () => `${st.heightM} m`);
  const strength = slider('Strength', () => st.strength, (t) => { st.strength = Math.max(0.05, round2(t)); }, () => `${Math.round(st.strength * 100)}%`);
  const edge = slider('Edge', () => st.edge, (t) => { st.edge = round2(t); }, () => (st.edge < 0.15 ? 'hard' : st.edge > 0.8 ? 'soft' : `${Math.round(st.edge * 100)}%`));
  const biomeRow = h('label', { class: 'brush-row' }, h('span', { text: 'Biome' }), biomeSel);
  const status = h('div', { class: 'help' });
  const list = h('ul', { class: 'op-list' });
  const listHead = h('div', { class: 'brush-list-head' });
  el.append(head, h('div', { class: 'section brush-body' }, toolRow, biomeRow, size.row, height.row, strength.row, edge.row, status), listHead, list);

  function renderBiomes() {
    biomeSel.replaceChildren(...BIOMES.map((b) => h('option', { value: b, text: biomeLabel(store.world, b) })));
    biomeSel.value = st.biome;
  }

  function setTool(t: Tool | null) {
    st.tool = t;
    for (const [id, b] of toolBtns) b.classList.toggle('on', id === t);
    const mb = app.controls.mouseButtons as unknown as Record<string, MOUSE | null>;
    if (t) { mb.LEFT = null; mb.MIDDLE = MOUSE.DOLLY; mb.RIGHT = MOUSE.ROTATE; } else { mb.LEFT = MOUSE.ROTATE; mb.MIDDLE = MOUSE.DOLLY; mb.RIGHT = MOUSE.PAN; }
    canvas.style.cursor = t ? 'crosshair' : '';
    if (!t) app.setBrushCursor(null);
    renderControls();
  }

  function renderControls() {
    const t = st.tool;
    biomeRow.style.display = t === 'paint' ? '' : 'none';
    height.row.style.display = t === 'raise' || t === 'lower' ? '' : 'none';
    strength.row.style.display = t === 'flatten' || t === 'smooth' || t === 'paint' ? '' : 'none';
    updateStatus();
  }

  function updateStatus() {
    const t = st.tool;
    if (!t) status.textContent = 'Pick a brush, then drag on the terrain. Right-drag orbits, wheel zooms, Esc puts the brush down, [ and ] resize.';
    else if (t !== 'paint' && !app.canSculpt) status.textContent = 'Sculpting starts once the bake has finished.';
    else status.textContent = t === 'flatten' ? 'Levels to the height where you start the stroke.' : t === 'paint' ? 'Paint wins over the climate rules; Erase paint gives the ground back to them.' : 'Each stroke is one undo step.';
  }

  function renderList() {
    const w = store.world;
    const items: { id: string; label: string; kind: 'sculpt' | 'paint' }[] = [
      ...w.sculpt.map((e) => ({ id: e.id, label: e.label, kind: 'sculpt' as const })),
      ...w.paint.map((e) => ({ id: e.id, label: e.label, kind: 'paint' as const })),
    ];
    const order = new Map([...w.sculpt, ...w.paint].map((e, i) => [e.id, i]));
    items.sort((a, b) => (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0));
    const clear = (kind: 'sculpt' | 'paint') => h('button', { class: 'btn icon danger', text: kind === 'sculpt' ? 'clear sculpt' : 'clear paint', title: `Remove every ${kind} edit`, onclick: () => {
      store.commit(`clear ${kind}`, (d) => { d[kind] = []; });
    } });
    listHead.replaceChildren(h('h3', { text: `Sculpt ${w.sculpt.length} · Paint ${w.paint.length}` }), ...(w.sculpt.length ? [clear('sculpt')] : []), ...(w.paint.length ? [clear('paint')] : []));
    if (!items.length) { list.replaceChildren(h('li', { class: 'empty', text: 'No sculpt or paint edits yet.' })); return; }
    list.replaceChildren(...items.slice(0, 60).map((it) => h('li', { class: 'op brush-edit' },
      h('span', { class: 'op-type', text: it.kind === 'sculpt' ? '▲' : '■' }),
      h('span', { class: 'op-label', text: it.label, title: it.id }),
      h('button', { class: 'btn icon danger', text: '×', title: 'Remove this edit', onclick: () => {
        store.commit(`remove ${it.label}`, (d) => { d.sculpt = d.sculpt.filter((e) => e.id !== it.id); d.paint = d.paint.filter((e) => e.id !== it.id); });
      } }),
    )));
  }

  let stroke: { id: string; tool: Tool; points: Vec2[]; target?: number } | null = null;

  const ndc = (ev: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1];
  };

  function strokeLabel(s: NonNullable<typeof stroke>): string {
    const w = store.world;
    const a = hexOf(s.points[0], app), b = hexOf(s.points[s.points.length - 1], app);
    const where = a === b ? a : `${a}–${b}`;
    switch (s.tool) {
      case 'raise': return `raise ${where} +${st.heightM} m`;
      case 'lower': return `lower ${where} −${st.heightM} m`;
      case 'flatten': return `flatten ${where} to ${Math.round(s.target ?? 0)} m`;
      case 'smooth': return `smooth ${where}`;
      case 'paint': return `paint ${biomeLabel(w, st.biome)} ${where}`;
    }
  }

  function build(s: NonNullable<typeof stroke>): SculptEdit | PaintEdit {
    const area = { kind: 'stroke' as const, points: s.points.map((p) => [round2(p[0]), round2(p[1])] as Vec2), radiusKm: st.sizeKm };
    const common = { id: s.id, label: strokeLabel(s), area, falloffKm: round2(st.sizeKm * st.edge) };
    if (s.tool === 'paint') return normalizePaint(store.world, { ...common, biome: st.biome, strength: st.strength }, { id: s.id, source: 'brush' });
    return normalizeSculpt(store.world, {
      ...common,
      tool: s.tool,
      amountM: st.heightM,
      targetM: s.target !== undefined ? Math.round(s.target) : undefined,
      strength: s.tool === 'raise' || s.tool === 'lower' ? 1 : st.strength,
      scaleKm: s.tool === 'smooth' ? round2(Math.max(0.3, st.sizeKm * 0.3)) : undefined,
    }, { id: s.id, source: 'brush' });
  }

  function preview() {
    if (!stroke) return;
    const e = build(stroke);
    if (stroke.tool === 'paint') app.previewPaint(e as PaintEdit);
    else app.previewSculpt(e as SculptEdit);
  }

  function cursorAt(ev: PointerEvent) {
    if (!st.tool) return null;
    const p = app.pick(...ndc(ev));
    if (!p) { app.setBrushCursor(null); return null; }
    app.setBrushCursor({ x: p.x, z: p.z, radiusKm: st.sizeKm, coreKm: Math.max(0, st.sizeKm * (1 - st.edge)) });
    return p;
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (!st.tool || ev.button !== 0) return;
    if (st.tool !== 'paint' && !app.canSculpt) { updateStatus(); return; }
    const p = cursorAt(ev);
    if (!p) return;
    canvas.setPointerCapture(ev.pointerId);
    stroke = { id: newOpId(st.tool === 'paint' ? 'paint' : st.tool, []), tool: st.tool, points: [[p.x, p.z]], target: st.tool === 'flatten' ? app.heightAt(p.x, p.z) : undefined };
    preview();
  });
  canvas.addEventListener('pointermove', (ev) => {
    const p = cursorAt(ev);
    if (!stroke || !p) return;
    const last = stroke.points[stroke.points.length - 1];
    if (Math.hypot(p.x - last[0], p.z - last[1]) < Math.max(0.05, st.sizeKm * 0.2)) return;
    stroke.points.push([p.x, p.z]);
    preview();
  });
  const finish = () => {
    if (!stroke) return;
    const s = stroke;
    stroke = null;
    const e = build(s);
    app.endPreview(false);
    const c = store.commit(e.label, (d) => {
      if (s.tool === 'paint') d.paint.push(e as PaintEdit); else d.sculpt.push(e as SculptEdit);
      return [e.id];
    });
    if (!c) app.endPreview(true);
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('pointerleave', () => { if (!stroke) app.setBrushCursor(null); });
  window.addEventListener('keydown', (ev) => {
    if ((ev.target as HTMLElement)?.closest?.('input, textarea, select')) return;
    if (ev.code === 'Escape' && st.tool) setTool(null);
    else if ((ev.key === '[' || ev.key === ']') && st.tool) {
      st.sizeKm = round2(Math.min(SIZE.max, Math.max(SIZE.min, st.sizeKm * (ev.key === ']' ? 1.25 : 0.8))));
      size.sync();
      savePrefs();
    }
  });

  store.subscribe((c) => {
    if (c.kind === 'load') renderBiomes();
    renderList();
    updateStatus();
  });
  setInterval(updateStatus, 1000);
  renderBiomes();
  renderControls();
  renderList();
}
