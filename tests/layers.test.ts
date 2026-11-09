import { describe, expect, it } from 'vitest';
import { hexCenter, makeGrid } from '../src/core/hex';
import { applySculpt, decodeFoundation, encodeFoundation, foundationKey, normalizePaint, normalizeSculpt, paintAt, rasterPaint, type Field } from '../src/core/layers';
import { normalizeOp } from '../src/core/opSchema';
import { defaultWorld, loadWorld, serializeWorld } from '../src/core/world';
import { Store } from '../src/app/store';
import { ToolExecutor } from '../src/agent/tools';
import { layeredProbe } from '../src/agent/layered';
import { hexSummary } from '../src/agent/probe';
import { evaluate } from '../src/core/ops';
import type { World } from '../src/core/types';

function world(): World {
  const w = defaultWorld('layers');
  w.terrain.designRes = 192;
  return w;
}

function flatField(w: World, h = 100): Field {
  const hf = evaluate(w, { res: 192 });
  return { height: new Float32Array(hf.nx * hf.ny).fill(h), nx: hf.nx, ny: hf.ny, kmPerPx: hf.kmPerPx };
}

function at(f: Field, x: number, y: number) {
  return f.height[Math.floor(y / f.kmPerPx) * f.nx + Math.floor(x / f.kmPerPx)];
}

describe('sculpt layer', () => {
  it('raises a hex by the amount and leaves distant ground alone', () => {
    const w = world();
    w.sculpt.push(normalizeSculpt(w, { tool: 'raise', hexes: ['0505'], amountM: 300, falloffKm: 1 }));
    const f = flatField(w);
    applySculpt(w, f);
    const g = makeGrid(w.grid);
    const [cx, cy] = hexCenter(g, 5, 5);
    const [fx, fy] = hexCenter(g, 1, 1);
    expect(at(f, cx, cy)).toBeCloseTo(400, 3);
    expect(at(f, fx, fy)).toBeCloseTo(100, 3);
  });

  it('flattens a brush path to the target height at its core', () => {
    const w = world();
    const f = flatField(w);
    for (let i = 0; i < f.height.length; i++) f.height[i] = 100 + (i % f.nx);
    w.sculpt.push(normalizeSculpt(w, { tool: 'flatten', points: ['0303', '0306'], radiusKm: 4, falloffKm: 1, targetM: 250 }));
    applySculpt(w, f);
    const g = makeGrid(w.grid);
    const [x, y] = hexCenter(g, 3, 4);
    expect(at(f, x, y)).toBeCloseTo(250, 1);
  });

  it('smooths relief inside the area', () => {
    const w = world();
    const f = flatField(w);
    for (let i = 0; i < f.height.length; i++) f.height[i] = (i % 2) * 200;
    w.sculpt.push(normalizeSculpt(w, { tool: 'smooth', hexes: ['0505'], scaleKm: 1, falloffKm: 0 }));
    applySculpt(w, f);
    const [x, y] = hexCenter(makeGrid(w.grid), 5, 5);
    const k = Math.floor(y / f.kmPerPx) * f.nx + Math.floor(x / f.kmPerPx);
    expect(Math.abs(f.height[k] - f.height[k + 1])).toBeLessThan(20);
  });

  it('rejects edits without the numbers they need', () => {
    const w = world();
    expect(() => normalizeSculpt(w, { tool: 'raise', hexes: ['0505'] })).toThrow(/amountM/);
    expect(() => normalizeSculpt(w, { tool: 'flatten', hexes: ['0505'] })).toThrow(/targetM/);
    expect(() => normalizeSculpt(w, { tool: 'raise', amountM: 10 })).toThrow(/region/);
  });
});

describe('biome paint', () => {
  it('reports the painted biome; later paint and erase win', () => {
    const w = world();
    const g = makeGrid(w.grid);
    const [x, y] = hexCenter(g, 4, 4);
    w.paint.push(normalizePaint(w, { biome: 'crimson coral', hexes: ['0404'], falloffKm: 0.5 }));
    expect(paintAt(rasterPaint(w), x, y)).toBe('forest');
    w.paint.push(normalizePaint(w, { biome: 'mire', points: ['0404'], radiusKm: 3 }));
    expect(paintAt(rasterPaint(w), x, y)).toBe('marsh');
    w.paint.push(normalizePaint(w, { biome: 'erase', hexes: ['0404'], falloffKm: 0.5 }));
    expect(paintAt(rasterPaint(w), x, y)).toBeNull();
  });

  it('shows up in the hex readout with the Shore name', () => {
    const w = world();
    w.environment = { palette: 'ashen' };
    w.paint.push(normalizePaint(w, { biome: 'forest', hexes: ['0606'], falloffKm: 0.5 }));
    const { probe } = layeredProbe(w, { res: 192 });
    expect(hexSummary(w, probe, 6, 6)!.surface).toBe('crimson coral');
  });
});

describe('frozen foundation', () => {
  it('keeps its key across sculpt and paint edits, and changes it for ops', () => {
    const w = world();
    const k = foundationKey(w);
    w.sculpt.push(normalizeSculpt(w, { tool: 'raise', hexes: ['0505'], amountM: 100 }));
    w.paint.push(normalizePaint(w, { biome: 'rock', hexes: ['0505'] }));
    expect(foundationKey(w)).toBe(k);
    w.ops.push(normalizeOp(w, { type: 'peak', center: '0505', height: 900, radius: 6, shape: 'cone' }));
    expect(foundationKey(w)).not.toBe(k);
  });

  it('round-trips through the bake file format', () => {
    const height = new Float32Array([1, 2, 3, 4, 5, 6]);
    const deposit = new Float32Array([0, 1, 0, 1, 0, 1]);
    const f = decodeFoundation(encodeFoundation({ key: 'abc', nx: 3, ny: 2, kmPerPx: 0.5, height, deposit }));
    expect(f.key).toBe('abc');
    expect([...f.height]).toEqual([...height]);
    expect([...f.deposit!]).toEqual([...deposit]);
  });
});

describe('layer edits in the world file, store and tools', () => {
  it('survive save and load', () => {
    const w = world();
    w.sculpt.push(normalizeSculpt(w, { tool: 'lower', hexes: ['0303', '0304'], amountM: 80 }));
    w.paint.push(normalizePaint(w, { biome: 'desert', region: { hex: '0707', radius: 1 } }));
    const back = loadWorld(JSON.parse(serializeWorld(w)));
    expect(back.sculpt).toEqual(w.sculpt);
    expect(back.paint).toEqual(w.paint);
  });

  it('are their own change kinds and revert like ops', () => {
    const s = new Store(world());
    const kinds: string[] = [];
    s.subscribe((c) => kinds.push(c.kind));
    const c = s.commit('raise', (w) => { w.sculpt.push(normalizeSculpt(w, { tool: 'raise', hexes: ['0505'], amountM: 50 })); })!;
    s.commit('paint', (w) => { w.paint.push(normalizePaint(w, { biome: 'snow', hexes: ['0101'] })); });
    expect(kinds).toEqual(['sculpt', 'paint']);
    s.revertTx(c.txId, 'revert raise');
    expect(s.world.sculpt).toHaveLength(0);
    expect(s.world.paint).toHaveLength(1);
  });

  it('are added, updated and removed through the CLI tools', () => {
    const w = world();
    const ex = new ToolExecutor(w, null, w);
    const add = ex.run('add_sculpt', { edit: { tool: 'raise', hexes: ['0505'], amountM: 120 } });
    expect(add.ok).toBe(true);
    const id = add.opId!;
    expect(ex.run('update_op', { id, patch: { amountM: 400 } }).ok).toBe(true);
    expect(w.sculpt[0].amountM).toBe(400);
    expect(ex.run('update_op', { id, patch: { hexes: ['0606'] } }).ok).toBe(true);
    expect(w.sculpt[0].expr?.region).toEqual({ hexes: ['0606'] });
    expect(ex.run('remove_op', { id }).ok).toBe(true);
    expect(w.sculpt).toHaveLength(0);
    expect(ex.run('add_paint', { edit: { biome: 'lava' , hexes: ['0505'] } }).ok).toBe(false);
  });
});
