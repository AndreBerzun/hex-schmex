// Ops panel: list (toggle, drag-to-reorder, select), typed param form, add/duplicate/delete, world settings.
import type { App } from '../app/app';
import type { Store } from '../app/store';
import { BLEND_MODES, OP_DESCS, OP_DESC_BY_TYPE, newOpId, normalizeOp, type ParamDesc } from '../core/opSchema';
import { DEFAULT_BLEND } from '../core/ops';
import type { Op, OpType, World } from '../core/types';
import { setWorldParam } from '../core/world';
import { h } from './dom';

export function mountOpsPanel(el: HTMLElement, app: App, store: Store) {
  let selected: string | null = null;
  let highlight = new Set<string>();
  let highlightTimer = 0;
  let dragId: string | null = null;
  let worldOpen = false;

  const head = h('div', { class: 'panel-head' });
  const list = h('ul', { class: 'op-list' });
  const form = h('div');
  const worldSec = h('div');
  el.append(head, list, form, worldSec);

  store.subscribe((c) => {
    if (c.changedOps.length) {
      highlight = new Set(c.changedOps);
      clearTimeout(highlightTimer);
      highlightTimer = window.setTimeout(() => { highlight.clear(); renderList(); }, 6000);
      if (c.changedOps.length === 1) selected = c.changedOps[0];
    }
    if (selected && !store.world.ops.some((o) => o.id === selected)) selected = null;
    render();
  });

  function render() {
    renderHead();
    renderList();
    renderForm();
    renderWorld();
  }

  function renderHead() {
    const add = h('select', { title: 'Add an op', onchange: () => {
      const t = add.value as OpType;
      add.value = '';
      if (!t) return;
      const op = defaultOp(store.world, t, app);
      store.commit(`add ${t}`, (w) => { w.ops.push(op); return [op.id]; });
      selected = op.id;
      render();
    } }, h('option', { value: '', text: '+ Add op…' }), ...OP_DESCS.filter((d) => d.type !== 'stroke').map((d) => h('option', { value: d.type, text: d.type })));
    head.replaceChildren(h('h2', { text: `Op stack · ${store.world.ops.length}` }), add);
  }

  function renderList() {
    const ops = store.world.ops;
    if (!ops.length) {
      list.replaceChildren(h('li', { class: 'empty', text: 'No ops yet. Add one above, or ask Claude Code to shape this map (see Map file).' }));
      return;
    }
    list.replaceChildren(...ops.map((o) => {
      const li = h('li', {
        class: `op${o.id === selected ? ' sel' : ''}${o.enabled ? '' : ' disabled'}${highlight.has(o.id) ? ' changed' : ''}`,
        draggable: 'true',
        title: `${o.type} · ${o.source}${o.expr ? ' · ' + JSON.stringify(o.expr) : ''}`,
        onclick: () => { selected = selected === o.id ? null : o.id; renderList(); renderForm(); },
        ondragstart: (ev: Event) => { dragId = o.id; (ev as DragEvent).dataTransfer?.setData('text/plain', o.id); },
        ondragover: (ev: Event) => { ev.preventDefault(); li.classList.add('drag-over'); },
        ondragleave: () => li.classList.remove('drag-over'),
        ondrop: (ev: Event) => {
          ev.preventDefault();
          li.classList.remove('drag-over');
          if (!dragId || dragId === o.id) return;
          const from = dragId;
          store.commit('reorder ops', (w) => {
            const i = w.ops.findIndex((x) => x.id === from);
            const [m] = w.ops.splice(i, 1);
            const j = w.ops.findIndex((x) => x.id === o.id);
            w.ops.splice(j, 0, m);
          });
          dragId = null;
        },
      },
      h('span', { class: 'grip', text: '⋮⋮' }),
      h('input', { type: 'checkbox', checked: o.enabled, title: 'Enable / disable', onclick: (ev: Event) => ev.stopPropagation(), onchange: (ev: Event) => {
        const on = (ev.target as HTMLInputElement).checked;
        store.commit(`${on ? 'enable' : 'disable'} ${o.label}`, (w) => { w.ops.find((x) => x.id === o.id)!.enabled = on; });
      } }),
      h('span', { class: 'op-label', text: o.label }),
      h('span', { class: 'op-type', text: o.source === 'prompt' ? `${o.type} ✦` : o.type }));
      return li;
    }));
  }

  function patchOp(id: string, label: string, fn: (o: Record<string, unknown>, w: World) => void) {
    try {
      store.commit(label, (w) => {
        const i = w.ops.findIndex((x) => x.id === id);
        const o = JSON.parse(JSON.stringify(w.ops[i])) as Record<string, unknown>;
        fn(o, w);
        w.ops[i] = normalizeOp(w, o, { id });
        return [id];
      });
    } catch (e) {
      alert(String((e as Error).message ?? e));
      renderForm();
    }
  }

  function renderForm() {
    const op = store.world.ops.find((o) => o.id === selected);
    if (!op) { form.replaceChildren(); return; }
    const desc = OP_DESC_BY_TYPE[op.type];
    const rec = op as unknown as Record<string, unknown>;
    const rows: HTMLElement[] = [];
    rows.push(row('label', h('input', { type: 'text', value: op.label, onchange: (ev: Event) => patchOp(op.id, 'rename op', (o) => { o.label = (ev.target as HTMLInputElement).value; }) })));
    rows.push(row('blend', h('select', { onchange: (ev: Event) => patchOp(op.id, `blend ${op.label}`, (o) => { o.blend = (ev.target as HTMLSelectElement).value; }) },
      ...BLEND_MODES.map((b) => h('option', { value: b, text: b + (b === DEFAULT_BLEND[op.type] ? ' (default)' : ''), selected: (op.blend ?? DEFAULT_BLEND[op.type]) === b })))));
    for (const p of desc.params) rows.push(paramRow(op, rec, p));
    form.replaceChildren(h('div', { class: 'op-form' },
      h('div', { class: 'help', text: desc.summary }),
      ...rows,
      h('div', { class: 'row' }, h('span'), h('div', { class: 'group' },
        h('button', { class: 'btn', text: 'Duplicate', onclick: () => {
          const id = newOpId(op.type, store.world.ops.map((o) => o.id));
          store.commit(`duplicate ${op.label}`, (w) => {
            const i = w.ops.findIndex((x) => x.id === op.id);
            w.ops.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(op)), id, label: `${op.label} copy`, source: 'manual' });
            return [id];
          });
        } }),
        h('button', { class: 'btn danger', text: 'Delete', onclick: () => store.commit(`delete ${op.label}`, (w) => { w.ops = w.ops.filter((x) => x.id !== op.id); }) }),
      )),
    ));
  }

  function paramRow(op: Op, rec: Record<string, unknown>, p: ParamDesc): HTMLElement {
    const v = rec[p.key];
    const label = `${p.key}${p.optional ? '?' : ''}`;
    const set = (val: unknown) => patchOp(op.id, `${op.label}: ${p.key}`, (o) => {
      if (val === undefined) delete o[p.key];
      else o[p.key] = val;
      if (o.expr && typeof o.expr === 'object') delete (o.expr as Record<string, unknown>)[p.key];
    });
    let input: HTMLElement;
    switch (p.kind) {
      case 'number': {
        const num = h('input', { type: 'number', step: p.step ?? 'any', value: v === undefined ? '' : String(v), placeholder: String(p.default ?? ''), onchange: () => set(num.value === '' ? undefined : Number(num.value)) });
        const rng = h('input', { type: 'range', min: p.min ?? 0, max: p.max ?? 1, step: p.step ?? 0.01, value: String(v ?? p.default ?? 0),
          oninput: () => { num.value = rng.value; }, onchange: () => set(Number(rng.value)) });
        input = h('div', { class: 'range-row' }, rng, num);
        break;
      }
      case 'enum':
        input = h('select', { onchange: (ev: Event) => set((ev.target as HTMLSelectElement).value) }, ...(p.options ?? []).map((o) => h('option', { value: o, text: o, selected: v === o })));
        break;
      case 'side':
        input = h('select', { onchange: (ev: Event) => set((ev.target as HTMLSelectElement).value || undefined) },
          h('option', { value: '', text: '—' }), ...['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'].map((o) => h('option', { value: o, text: o, selected: v === o })));
        break;
      case 'bool':
        input = h('input', { type: 'checkbox', checked: !!v, onchange: (ev: Event) => set((ev.target as HTMLInputElement).checked) });
        break;
      default: {
        // geometry: show the original expression (hex ids etc) when there is one, else km
        const expr = (op.expr as Record<string, unknown> | undefined)?.[p.key];
        const shown = expr !== undefined ? expr : roundDeep(v);
        const ta = h('textarea', { spellcheck: 'false', title: 'JSON. Points: "0405", "0405:NE", "N", [x,y] km, {u,v}. Regions: {hexes:[…]}, {hex,radius}, {center,radiusKm}, {polygon:[…]}, {rect:[a,b]}, {side,fraction}, "all"' });
        ta.value = shown === undefined ? '' : JSON.stringify(shown);
        ta.addEventListener('change', () => {
          if (ta.value.trim() === '') return set(undefined);
          try { set(JSON.parse(ta.value)); }
          catch { set(ta.value.trim()); }
        });
        return h('div', { class: 'row wide' }, h('span', { text: `${label} — ${p.help}` }), ta);
      }
    }
    const r = row(label, input);
    r.title = p.help;
    return r;
  }

  function row(label: string, input: HTMLElement) {
    return h('div', { class: 'row' }, h('span', { text: label }), input);
  }

  function renderWorld() {
    const w = store.world;
    const set = (path: string, val: unknown, label = path) => {
      try { store.commit(`set ${label}`, (d) => { setWorldParam(d, path, val); }); }
      catch (e) { alert(String(e)); }
    };
    const num = (path: string, val: number, step: number, label?: string) =>
      h('input', { type: 'number', step, value: String(val), onchange: (ev: Event) => set(path, Number((ev.target as HTMLInputElement).value), label) });
    const sel = (path: string, val: string, opts: string[]) =>
      h('select', { onchange: (ev: Event) => set(path, (ev.target as HTMLSelectElement).value) }, ...opts.map((o) => h('option', { value: o, text: o, selected: o === val })));
    const toggle = h('button', { class: 'btn', text: worldOpen ? 'Hide' : 'Show', onclick: () => { worldOpen = !worldOpen; renderWorld(); } });
    const body = worldOpen ? h('div', { class: 'kv' },
      h('span', { text: 'name' }), h('input', { type: 'text', value: w.meta.name, onchange: (ev: Event) => set('meta.name', (ev.target as HTMLInputElement).value, 'name') }),
      h('span', { text: 'seed' }), num('seed', w.seed, 1),
      h('span', { text: 'grid cols × rows' }), h('div', { class: 'group' }, num('grid.cols', w.grid.cols, 1), num('grid.rows', w.grid.rows, 1)),
      h('span', { text: 'hex miles' }), num('grid.hexMiles', w.grid.hexMiles, 0.5),
      h('span', { text: 'orientation' }), sel('grid.orientation', w.grid.orientation, ['flat', 'pointy']),
      h('span', { text: 'sea level m' }), num('terrain.seaLevelM', w.terrain.seaLevelM, 10),
      h('span', { text: 'max elev m' }), num('terrain.maxElevationM', w.terrain.maxElevationM, 100),
      h('span', { text: 'design res' }), sel('terrain.designRes', String(w.terrain.designRes), ['512', '640', '1024', '2048']),
      h('span', { text: 'eroded res' }), sel('terrain.erodedRes', String(w.terrain.erodedRes), ['512', '1024', '1280', '2048', '4096']),
      h('span', { text: 'base type' }), sel('base.type', w.base.type, ['fbm', 'ridged', 'mixed']),
      h('span', { text: 'base elev m' }), num('base.elevation', w.base.elevation, 10),
      h('span', { text: 'base amp m' }), num('base.amplitude', w.base.amplitude, 10),
      h('span', { text: 'base λ km' }), num('base.wavelengthKm', w.base.wavelengthKm, 1),
      h('span', { text: 'base warp km' }), num('base.warpKm', w.base.warpKm, 1),
      h('span', { text: 'wind from °' }), num('climate.windFromDeg', w.climate.windFromDeg, 5),
      h('span', { text: 'moisture' }), num('climate.baseMoisture', w.climate.baseMoisture, 0.05),
      h('span', { text: 'snowline m' }), num('climate.snowlineM', w.climate.snowlineM, 50),
      h('span', { text: 'treeline m' }), num('climate.treelineM', w.climate.treelineM, 50),
      h('span', { text: 'temperature' }), num('climate.temperature', w.climate.temperature, 0.1),
      h('span', { text: 'erosion strength' }), num('erosion.strength', w.erosion.strength, 0.1),
      h('span', { text: 'erosion iters' }), num('erosion.iterations', w.erosion.iterations, 20),
      h('span', { text: 'talus °' }), num('erosion.talusDeg', w.erosion.talusDeg, 1),
    ) : null;
    worldSec.replaceChildren(h('div', { class: 'section' }, h('div', { class: 'panel-head', style: 'position:static;padding:0 0 6px;border:0' }, h('h3', { text: 'World setup' }), toggle), body));
  }

  render();
}

function roundDeep(v: unknown): unknown {
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  if (Array.isArray(v)) return v.map(roundDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDeep(x)]));
  return v;
}

/** A sensible default op of a type, placed around what the camera is looking at. */
export function defaultOp(world: World, type: OpType, app: App): Op {
  const t = app.controls.target;
  const cx = t.x, cz = t.z;
  const desc = OP_DESC_BY_TYPE[type];
  const loose: Record<string, unknown> = { type, label: `New ${type}`, source: 'manual' };
  for (const p of desc.params) {
    if (p.kind === 'points') loose[p.key] = [[cx - 25, cz + 5], [cx, cz - 3], [cx + 25, cz + 4]];
    else if (p.kind === 'point') loose[p.key] = [cx, cz];
    else if (p.kind === 'region') loose[p.key] = { center: [cx, cz], radiusKm: 22 };
  }
  if (type === 'coast') { loose.side = 'W'; loose.extentKm = 30; delete loose.region; }
  return normalizeOp(world, loose);
}
