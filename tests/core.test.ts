import { describe, expect, it } from 'vitest';
import { allHexes, hexCenter, hexId, makeGrid, mapDims, parseHexId, pointToHex } from '../src/core/hex';
import { evaluate, opPath, sampleBilinear } from '../src/core/ops';
import { normalizeOp } from '../src/core/opSchema';
import { Resolver } from '../src/core/resolve';
import { computeHydrology } from '../src/core/hydrology';
import { fluvialErode } from '../src/core/fluvial';
import { defaultWorld, loadWorld, setWorldParam } from '../src/core/world';
import { polylineInfo } from '../src/core/geom';
import { Store } from '../src/app/store';
import type { World } from '../src/core/types';

function smallWorld(ops: Record<string, unknown>[] = [], patch: Partial<World> = {}): World {
  const w = defaultWorld('test');
  w.terrain.designRes = 256;
  w.grid.cols = 10;
  w.grid.rows = 8;
  Object.assign(w, patch);
  for (const o of ops) w.ops.push(normalizeOp(w, o));
  return w;
}

function at(hf: ReturnType<typeof evaluate>, x: number, y: number) {
  return sampleBilinear(hf.height, hf.nx, hf.ny, x / hf.kmPerPx, y / hf.kmPerPx);
}

describe('hex maths', () => {
  for (const orientation of ['flat', 'pointy'] as const) {
    it(`id -> km -> id round-trips for every hex (${orientation})`, () => {
      const g = makeGrid({ cols: 20, rows: 16, hexMiles: 6, orientation });
      for (const hx of allHexes(g)) {
        const c = hexCenter(g, hx.col, hx.row);
        expect(pointToHex(g, c)).toEqual({ col: hx.col, row: hx.row });
        // points well inside the hex resolve to it too
        for (let a = 0; a < 6; a++) {
          const p: [number, number] = [c[0] + Math.cos(a) * g.flat * 0.4, c[1] + Math.sin(a) * g.flat * 0.4];
          expect(pointToHex(g, p)).toEqual({ col: hx.col, row: hx.row });
        }
      }
    });
  }
  it('flat-top: even columns sit half a hex lower; 6-mile hexes are 9.66 km flat-to-flat', () => {
    const g = makeGrid({ cols: 20, rows: 16, hexMiles: 6, orientation: 'flat' });
    expect(g.flat).toBeCloseTo(9.656, 2);
    const a = hexCenter(g, 1, 1), b = hexCenter(g, 2, 1);
    expect(b[1] - a[1]).toBeCloseTo(g.flat / 2, 6);
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(g.flat, 6); // neighbours are one flat apart
  });
  it('parses ids and pads them', () => {
    expect(parseHexId('0507')).toEqual({ col: 5, row: 7 });
    expect(parseHexId('5,7')).toEqual({ col: 5, row: 7 });
    expect(parseHexId('nope')).toBeNull();
    expect(hexId(5, 7)).toBe('0507');
  });
  it('world extent covers the grid with a margin and pixels are square', () => {
    const g = makeGrid({ cols: 20, rows: 16, hexMiles: 6, orientation: 'flat' });
    expect(g.widthKm).toBeGreaterThan(170);
    expect(g.heightKm).toBeGreaterThan(160);
    const d = mapDims(g, 1024);
    expect(Math.max(d.nx, d.ny)).toBe(1024);
    expect(Math.abs(d.nx * d.kmPerPx - g.widthKm)).toBeLessThan(d.kmPerPx);
  });
});

describe('resolver', () => {
  const w = smallWorld();
  const r = new Resolver(w);
  it('resolves hex ids, offsets, compass words and km', () => {
    const g = makeGrid(w.grid);
    expect(r.point('0304')).toEqual(hexCenter(g, 3, 4));
    const ne = r.point('0304:NE');
    expect(ne[0]).toBeGreaterThan(hexCenter(g, 3, 4)[0]);
    expect(ne[1]).toBeLessThan(hexCenter(g, 3, 4)[1]);
    expect(r.point([10, 20])).toEqual([10, 20]);
    expect(r.point({ u: 0.5, v: 0.5 })).toEqual([g.widthKm / 2, g.heightKm / 2]);
    const n = r.point('N');
    expect(n[1]).toBeLessThan(g.heightKm * 0.3);
  });
  it('resolves regions', () => {
    expect(r.region({ hexes: ['0101', '0102'] }).kind).toBe('union');
    expect(r.region({ hex: '0304', radius: 2 }).kind).toBe('circle');
    expect(r.region({ side: 'S', fraction: 0.25 }).kind).toBe('rect');
    expect(() => r.region('bogus')).toThrow();
  });
  it('normalizeOp keeps the original expression', () => {
    const op = normalizeOp(w, { type: 'peak', center: '0304', height: 1000, radius: 5 });
    expect(op.expr).toEqual({ center: '0304' });
    expect(op.type === 'peak' && Array.isArray(op.center)).toBe(true);
  });
});

describe('op evaluation', () => {
  it('is deterministic for the same world and seed, and seed-sensitive', () => {
    const w = smallWorld([{ type: 'ridge', points: ['0204', '0904'], height: 1500, width: 10 }, { type: 'hills', region: 'all', amplitude: 100, wavelengthKm: 5 }]);
    const a = evaluate(w), b = evaluate(JSON.parse(JSON.stringify(w)));
    expect(Buffer.from(a.height.buffer).equals(Buffer.from(b.height.buffer))).toBe(true);
    const c = evaluate({ ...w, seed: w.seed + 1 });
    let diff = 0;
    for (let i = 0; i < a.height.length; i++) diff += Math.abs(a.height[i] - c.height[i]);
    expect(diff / a.height.length).toBeGreaterThan(1);
  });

  const base = { base: { type: 'fbm' as const, elevation: 300, amplitude: 60, wavelengthKm: 30, octaves: 4, warpKm: 0 } };
  const flat = (ops: Record<string, unknown>[]) => evaluate(smallWorld(ops, base));
  const g = makeGrid(smallWorld().grid);

  it('ridge raises terrain along its line, more at the crest than the flank', () => {
    const hf0 = flat([]);
    const hf = flat([{ type: 'ridge', id: 'r1', points: ['0204', '0904'], height: 2000, width: 12, roughness: 0 }]);
    const [x, y] = hexCenter(g, 5, 4);
    expect(at(hf, x, y) - at(hf0, x, y)).toBeGreaterThan(800);
    expect(at(hf, x, y + 20) - at(hf0, x, y + 20)).toBeLessThan(at(hf, x, y) - at(hf0, x, y));
  });
  it('peak shapes raise their centre; volcano has a crater', () => {
    const [x, y] = hexCenter(g, 5, 4);
    for (const shape of ['cone', 'dome', 'massif']) {
      const hf = flat([{ type: 'peak', center: '0504', height: 2000, radius: 12, shape }]);
      expect(at(hf, x, y)).toBeGreaterThan(1000);
    }
    const v = flat([{ type: 'peak', center: '0504', height: 2000, radius: 12, shape: 'volcano' }]);
    expect(at(v, x + 3.5, y)).toBeGreaterThan(at(v, x, y));
  });
  it('plateau lifts to (at least) its height; basin lowers; lowlands flatten toward target', () => {
    const [x, y] = hexCenter(g, 5, 4);
    expect(at(flat([{ type: 'plateau', region: { center: '0504', radiusKm: 15 }, height: 1200, edgeSteepness: 0.8 }]), x, y)).toBeCloseTo(1200, -1);
    expect(at(flat([{ type: 'basin', region: { center: '0504', radiusKm: 10 }, depth: 200, falloffKm: 5 }]), x, y)).toBeLessThan(150);
    expect(Math.abs(at(flat([{ type: 'lowlands', region: 'all', targetElevation: 50, flatness: 1 }]), x, y) - 50)).toBeLessThan(5);
  });
  it('keeps sub-kilometre plateaus and flats on their centre, wherever they sit', () => {
    const fine = (ops: Record<string, unknown>[]) => evaluate(smallWorld(ops, { ...base, terrain: { ...defaultWorld('t').terrain, designRes: 1024 } }));
    for (let c = 2; c <= 8; c++) {
      const [x, y] = hexCenter(g, c, 4);
      const id = `0${c}04`;
      expect(at(fine([{ type: 'plateau', region: { center: id, radiusKm: 0.6 }, height: 900, edgeSteepness: 0.6 }]), x, y)).toBeGreaterThan(650);
      expect(at(fine([{ type: 'lowlands', region: { center: id, radiusKm: 0.5 }, targetElevation: 100, flatness: 1, falloffKm: 0.15 }]), x, y)).toBeCloseTo(100, -1);
    }
  });
  it('coast pushes its side below sea level', () => {
    const hf = flat([{ type: 'coast', side: 'W', extentKm: 30, targetElevation: -200, falloffKm: 5, roughness: 0 }]);
    expect(at(hf, 3, g.heightKm / 2)).toBeLessThan(0);
    expect(at(hf, g.widthKm - 3, g.heightKm / 2)).toBeGreaterThan(0);
  });
  it('escarpment raises one side only', () => {
    const hf0 = flat([]);
    const hf = flat([{ type: 'escarpment', points: [[20, 10], [20, 70]], heightDelta: 500, side: 'left', width: 1 }]);
    // heading south, "left" is east (+x) in a y-down frame
    expect(at(hf, 30, 40) - at(hf0, 30, 40)).toBeGreaterThan(300);
    expect(Math.abs(at(hf, 10, 40) - at(hf0, 10, 40))).toBeLessThan(80);
  });
  it('moisture ops paint moisture, not height', () => {
    const hf0 = flat([]);
    const hf = flat([{ type: 'moisture', region: { center: '0504', radiusKm: 15 }, delta: 0.5 }]);
    const [x, y] = hexCenter(g, 5, 4);
    expect(at(hf, x, y)).toBeCloseTo(at(hf0, x, y), 5);
    const k = Math.floor(y / hf.kmPerPx) * hf.nx + Math.floor(x / hf.kmPerPx);
    expect(hf.moisture[k]).toBeGreaterThan(0.4);
  });

  for (const [type, extra] of [['river', { width: 0.6, depth: 15 }], ['valley', { width: 6, depth: 300 }], ['canyon', { width: 4, depth: 400, wallSteepness: 0.8 }]] as const) {
    it(`${type} never steps uphill along its path (even when drawn uphill)`, () => {
      const w = smallWorld([
        { type: 'hills', id: 'h1', region: 'all', amplitude: 500, wavelengthKm: 12, style: 'rugged' },
        { type: 'ridge', id: 'r1', points: ['0103', '1003'], height: 1200, width: 15 },
        // drawn from the low south to the high north on purpose
        { type, id: `${type}-1`, points: ['0508', '0406', '0603', '0501'], ...extra },
      ]);
      const hf = evaluate(w);
      const op = w.ops[2];
      let pts = opPath(op, hf.kmPerPx);
      const info0 = polylineInfo(pts);
      const first = at(hf, pts[0][0], pts[0][1]), last = at(hf, pts[pts.length - 1][0], pts[pts.length - 1][1]);
      if (first < last) pts = pts.slice().reverse();
      const info = polylineInfo(pts);
      expect(info.length).toBeCloseTo(info0.length, 3);
      let prev = Infinity, worst = 0;
      const steps = Math.ceil(info.length / (hf.kmPerPx * 0.5));
      for (let i = 0; i <= steps; i++) {
        const s = (i / steps) * info.length;
        let p: [number, number] = pts[0];
        for (let k = 0; k < pts.length - 1; k++) {
          if (s <= info.cum[k + 1]) {
            const t = (s - info.cum[k]) / (info.cum[k + 1] - info.cum[k] || 1);
            p = [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t];
            break;
          }
          p = pts[k + 1];
        }
        // the first/last km are radial bowls around the endpoints; bilinear sampling there reads the walls
        if (s < 1 || s > info.length - 1) continue;
        const v = at(hf, p[0], p[1]);
        if (v - prev > worst && process.env.DEBUG_MONO) console.log(type, 's', s.toFixed(1), 'of', info.length.toFixed(1), 'up', (v - prev).toFixed(1));
        worst = Math.max(worst, v - prev);
        prev = Math.min(prev, v);
      }
      // allow bilinear sampling slop of a couple of metres
      expect(worst).toBeLessThan(3);
    });
  }

  it('evaluates the bundled example worlds without NaNs', async () => {
    const fs = await import('node:fs');
    for (const f of fs.readdirSync('worlds')) {
      const w = loadWorld(JSON.parse(fs.readFileSync(`worlds/${f}`, 'utf8')));
      w.terrain.designRes = 256;
      const hf = evaluate(w);
      expect(hf.height.every(Number.isFinite)).toBe(true);
    }
  });
});

describe('hydrology', () => {
  it('fills a closed bowl into a lake and accumulates flow to an outlet', () => {
    const nx = 64, ny = 64;
    const h = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const r = Math.hypot(i - 32, j - 32);
      h[j * nx + i] = 100 + i * 2 + (r < 10 ? -(10 - r) * 5 : 0);
    }
    const out = computeHydrology({ nx, ny, kmPerPx: 0.5, height: h, seaLevelM: 0, climate: defaultWorld().climate });
    expect(out.waterKind[32 * nx + 32]).toBe(2);
    expect(out.waterLevel[32 * nx + 32]).toBeGreaterThan(h[32 * nx + 32] + 10);
    // the west edge drains the most
    let maxA = -Infinity, maxI = -1;
    for (let k = 0; k < nx * ny; k++) if (out.logArea[k] > maxA) { maxA = out.logArea[k]; maxI = k; }
    expect(maxI % nx).toBe(0);
  });
  it('stream power lowers land, never sea, and keeps it finite', () => {
    const nx = 64, ny = 64;
    const h = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = i < 4 ? -50 : 20 * i + 30 * Math.sin(j * 0.7);
    const before = h.slice();
    fluvialErode(h, nx, ny, 0.5, 0, { iterations: 10, k: 0.02 });
    let lowered = 0;
    for (let k = 0; k < h.length; k++) {
      expect(Number.isFinite(h[k])).toBe(true);
      if (before[k] < 0) expect(h[k]).toBe(before[k]);
      if (h[k] < before[k] - 1) lowered++;
    }
    expect(lowered).toBeGreaterThan(100);
  });
});

describe('store', () => {
  it('commits, undoes, redoes and reverts a single transaction', () => {
    const s = new Store(smallWorld());
    const c1 = s.commit('a', (w) => { w.ops.push(normalizeOp(w, { type: 'peak', id: 'p1', center: '0304' })); return ['p1']; })!;
    s.commit('b', (w) => { w.ops.push(normalizeOp(w, { type: 'peak', id: 'p2', center: '0504' })); });
    expect(s.world.ops.map((o) => o.id)).toEqual(['p1', 'p2']);
    s.undo();
    expect(s.world.ops.map((o) => o.id)).toEqual(['p1']);
    s.redo();
    expect(s.world.ops.map((o) => o.id)).toEqual(['p1', 'p2']);
    s.revertTx(c1.txId, 'revert a');
    expect(s.world.ops.map((o) => o.id)).toEqual(['p2']);
    expect(s.commit('noop', () => {})).toBeNull();
  });
  it('setWorldParam only accepts known paths', () => {
    const w = smallWorld();
    setWorldParam(w, 'climate.snowlineM', 2000);
    expect(w.climate.snowlineM).toBe(2000);
    expect(() => setWorldParam(w, 'ops', [])).toThrow();
  });
});
