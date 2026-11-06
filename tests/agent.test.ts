import { describe, expect, it, vi } from 'vitest';
import { evaluate } from '../src/core/ops';
import { defaultWorld } from '../src/core/world';
import { buildContext } from '../src/agent/context';
import { renderMapImage } from '../src/agent/mapImage';
import { fieldProbe } from '../src/agent/probe';
import { ToolExecutor } from '../src/agent/tools';
import type { RidgeOp } from '../src/core/types';
import { MapLink } from '../src/app/mapLink';
import { Store } from '../src/app/store';
import { isBlankReadback } from '../src/gpu/pacing';

const base = () => {
  const w = defaultWorld('test');
  w.grid.cols = 8; w.grid.rows = 6;
  return w;
};

describe('tool executor', () => {
  it('adds, updates, reorders and removes ops on a draft', () => {
    const w = base();
    const ex = new ToolExecutor(w, null, base());
    const a = ex.run('add_op', { op: { type: 'ridge', label: 'Spine', points: ['0202', '0603'], height: 2000 } });
    expect(a.ok).toBe(true);
    const id = a.opId!;
    expect(w.ops[0].expr?.points).toEqual(['0202', '0603']);
    const u = ex.run('update_op', { id, patch: { height: 2600 } });
    expect(u.ok).toBe(true);
    const r = w.ops[0] as RidgeOp;
    expect(r.height).toBe(2600);
    // geometry expression survives a numeric patch
    expect(r.expr?.points).toEqual(['0202', '0603']);
    // patched geometry replaces the expression
    ex.run('update_op', { id, patch: { points: ['0102', '0704'] } });
    expect((w.ops[0] as RidgeOp).expr?.points).toEqual(['0102', '0704']);
    ex.run('add_op', { op: { type: 'peak', label: 'Horn', center: '0404' }, index: 0 });
    expect(w.ops[0].type).toBe('peak');
    ex.run('reorder_op', { id, index: 0 });
    expect(w.ops[0].id).toBe(id);
    expect(ex.run('remove_op', { id }).ok).toBe(true);
    expect(w.ops.length).toBe(1);
  });

  it('reports errors as failed results instead of throwing', () => {
    const w = base();
    const ex = new ToolExecutor(w, null, base());
    expect(ex.run('update_op', { id: 'nope', patch: {} }).ok).toBe(false);
    expect(ex.run('add_op', { op: { type: 'blob', label: 'x' } }).ok).toBe(false);
    expect(ex.run('add_op', { op: { type: 'peak', label: 'x', center: '9999' } }).ok).toBe(false);
    expect(ex.run('set_world_param', { path: 'grid.cols', value: 40 }).ok).toBe(false);
    expect(ex.run('set_world_param', { path: 'climate.snowlineM', value: 2200 }).ok).toBe(true);
    expect(w.climate.snowlineM).toBe(2200);
  });

  it('answers one query_region per request', () => {
    const w = base();
    const probe = fieldProbe(w, evaluate(w, { res: 128 }));
    const ex = new ToolExecutor(w, probe, w);
    const q = ex.run('query_region', { bbox: ['0101', '0202'] });
    expect(q.ok).toBe(true);
    expect(q.result.split('\n').length).toBe(5);
    expect(ex.run('query_region', { hexes: ['0303'] }).ok).toBe(false);
  });
});

describe('context and map image', () => {
  it('builds a compact context with ops in hex terms and an elevation table', () => {
    const w = base();
    new ToolExecutor(w, null, w).run('add_op', { op: { type: 'peak', label: 'Horn', center: '0404', height: 1800 } });
    const ctx = buildContext(w, fieldProbe(w, evaluate(w, { res: 128 })));
    expect(ctx).toContain('"center":"0404"');
    expect(ctx).toContain('mean elevation');
    expect(ctx.length).toBeLessThan(6000);
  });
  it('renders a map raster of the world aspect', () => {
    const w = base();
    const r = renderMapImage(w, fieldProbe(w, evaluate(w, { res: 128 })), 200);
    expect(r.width).toBe(200);
    expect(r.rgba.length).toBe(r.width * r.height * 4);
  });
});

describe('map overlays', () => {
  it('draws op geometry without throwing', () => {
    const w = base();
    const ex = new ToolExecutor(w, null, w);
    ex.run('add_op', { op: { type: 'river', label: 'R', points: ['0202', '0505'] } });
    ex.run('add_op', { op: { type: 'basin', label: 'L', region: { hex: '0303', radius: 1 } } });
    const r = renderMapImage(w, fieldProbe(w, evaluate(w, { res: 96 })), 160, w.ops.map((op) => ({ op })));
    expect(r.rgba.some((v, i) => i % 4 === 0 && v === 225)).toBe(true);
  });
});

describe('map file link', () => {
  const linked = () => {
    vi.stubGlobal('window', { setTimeout: () => 0 });
    const store = new Store(base());
    const link = new MapLink(store);
    link.adopt('my-marches', '{}');
    return { store, link };
  };

  it('lets go of the file when another world is loaded, so it cannot be overwritten', () => {
    const { store, link } = linked();
    store.replace(defaultWorld('another world'), 'load another');
    expect(link.name).toBeNull();
  });

  it('stays linked through ordinary edits', () => {
    const { store, link } = linked();
    store.commit('rename', (w) => { w.meta.name = 'renamed'; });
    expect(link.name).toBe('my-marches');
  });
});

describe('GPU readback check', () => {
  it('flags a readback that came back empty', () => {
    expect(isBlankReadback(new Float32Array([0, 120, 900]), new Float32Array(6))).toBe(true);
  });

  it('accepts real heights and a map that really is flat at zero', () => {
    expect(isBlankReadback(new Float32Array([0, 120]), new Float32Array([0, 80, 0, 0]))).toBe(false);
    expect(isBlankReadback(new Float32Array(4), new Float32Array(4))).toBe(false);
  });
});
