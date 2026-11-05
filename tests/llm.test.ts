import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/ops';
import { defaultWorld, loadWorld } from '../src/core/world';
import { buildContext } from '../src/llm/context';
import { renderMapImage } from '../src/llm/mapImage';
import { MockProvider } from '../src/llm/mockProvider';
import { fieldProbe } from '../src/llm/probe';
import { runPrompt } from '../src/llm/prompter';
import { ToolExecutor } from '../src/llm/tools';
import type { RidgeOp } from '../src/core/types';

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

describe('prompt loop (mock provider)', () => {
  it('applies a prompt as edits on a copy and reports changed ops', async () => {
    const w = base();
    const out = await runPrompt({ world: w, prompt: 'add a volcanic peak in 0403', provider: new MockProvider(), probe: null });
    expect(out.changed).toBe(true);
    expect(w.ops.length).toBe(0); // input untouched
    expect(out.world.ops[0].type).toBe('peak');
    expect(out.changedOps).toEqual([out.world.ops[0].id]);
    // refinement updates the existing op instead of adding one
    const out2 = await runPrompt({ world: out.world, prompt: 'make it higher', provider: new MockProvider(), probe: null });
    expect(out2.world.ops.length).toBe(1);
    expect((out2.world.ops[0] as { height: number }).height).toBeGreaterThan((out.world.ops[0] as { height: number }).height);
    // the result loads as a valid world
    expect(() => loadWorld(JSON.parse(JSON.stringify(out2.world)))).not.toThrow();
  });
});
