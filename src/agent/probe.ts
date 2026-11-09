// Terrain sampling for the prompter: per-hex stats from any height source (the baked GPU terrain in the
// browser, or a CPU-evaluated heightfield in the CLI). Pure TS, no DOM.

import { hexCenter, hexId, inGrid, makeGrid, pointToHex, type HexGrid } from '../core/hex';
import type { Heightfield } from '../core/ops';
import { paintAt, type Field, type PaintRaster } from '../core/layers';
import { classifySurface, surfaceName } from '../core/surfaces';
import type { World } from '../core/types';

export interface SurfaceInfo { mat: string; water: boolean; moisture: number }

export interface TerrainProbe {
  /** metres at world km */
  heightAt(x: number, y: number): number;
  /** dominant surface class at a point (slope = |gradient|, rise/run) */
  surfaceAt(x: number, y: number, h: number, slope: number): SurfaceInfo;
  /** sample spacing, km */
  kmPerPx: number;
  /** "eroded" (what the GM sees) or "design" (op stack only, before erosion) */
  kind: 'eroded' | 'design';
}

export interface HexSummary {
  id: string;
  minM: number;
  maxM: number;
  meanM: number;
  slopeDeg: number;
  /** dominant surface class */
  surface: string;
  /** fraction of the hex under water */
  water: number;
  moisture: number;
}

export function hexSummary(world: World, probe: TerrainProbe, col: number, row: number, grid: HexGrid = makeGrid(world.grid)): HexSummary | null {
  if (!inGrid(grid, col, row)) return null;
  const [cx, cy] = hexCenter(grid, col, row);
  const r = grid.flat / 2;
  const step = Math.max(probe.kmPerPx, r / 10);
  const d = probe.kmPerPx;
  const cell = d * 1000;
  let mn = Infinity, mx = -Infinity, sum = 0, n = 0, slope = 0, water = 0, moist = 0;
  const counts: Record<string, number> = {};
  for (let y = cy - r * 1.15; y <= cy + r * 1.15; y += step) for (let x = cx - r * 1.15; x <= cx + r * 1.15; x += step) {
    const h = pointToHex(grid, [x, y]);
    if (h.col !== col || h.row !== row) continue;
    const v = probe.heightAt(x, y);
    const gx = (probe.heightAt(x + d, y) - probe.heightAt(x - d, y)) / (2 * cell);
    const gy = (probe.heightAt(x, y + d) - probe.heightAt(x, y - d)) / (2 * cell);
    const sl = Math.hypot(gx, gy);
    const s = probe.surfaceAt(x, y, v, sl);
    mn = Math.min(mn, v); mx = Math.max(mx, v); sum += v; n++;
    slope += (Math.atan(sl) * 180) / Math.PI;
    counts[s.mat] = (counts[s.mat] ?? 0) + 1;
    if (s.water) water++;
    moist += s.moisture;
  }
  if (!n) return null;
  let surface = 'grassland', best = -1;
  for (const k in counts) if (counts[k] > best) { best = counts[k]; surface = k; }
  return { id: hexId(col, row), minM: mn, maxM: mx, meanM: sum / n, slopeDeg: slope / n, surface, water: water / n, moisture: moist / n };
}

export function allHexSummaries(world: World, probe: TerrainProbe): HexSummary[] {
  const grid = makeGrid(world.grid);
  const out: HexSummary[] = [];
  for (let r = 1; r <= grid.rows; r++) for (let c = 1; c <= grid.cols; c++) {
    const s = hexSummary(world, probe, c, r, grid);
    if (s) out.push(s);
  }
  return out;
}

export interface ProbeHydro {
  nx: number;
  ny: number;
  kmPerPx: number;
  moisture: Float32Array;
  logArea: Float32Array;
  waterKind: Uint8Array | Int8Array | Float32Array;
}

export interface ProbeLayers {
  height?: Field;
  paint?: PaintRaster | null;
  hydro?: ProbeHydro | null;
  kind?: 'eroded' | 'design';
}

export function fieldProbe(world: World, hf: Heightfield, layers: ProbeLayers = {}): TerrainProbe {
  const sample = (a: Float32Array, nx: number, ny: number, kmPerPx: number, x: number, y: number) => {
    const fx = Math.min(nx - 1.001, Math.max(0, x / kmPerPx - 0.5));
    const fy = Math.min(ny - 1.001, Math.max(0, y / kmPerPx - 0.5));
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, k = j * nx + i;
    return (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - ty) + (a[k + nx] * (1 - tx) + a[k + nx + 1] * tx) * ty;
  };
  const d = (a: Float32Array, x: number, y: number) => sample(a, hf.nx, hf.ny, hf.kmPerPx, x, y);
  const H = layers.height ?? { height: hf.height, nx: hf.nx, ny: hf.ny, kmPerPx: hf.kmPerPx };
  const paint = layers.paint ?? null;
  const hy = layers.hydro ?? null;
  return {
    kind: layers.kind ?? 'design',
    kmPerPx: H.kmPerPx,
    heightAt: (x, y) => sample(H.height, H.nx, H.ny, H.kmPerPx, x, y),
    surfaceAt: (x, y, h, slope) => {
      const c = world.climate;
      const painted = paintAt(paint, x, y);
      if (hy) {
        const i = Math.min(hy.nx - 1, Math.max(0, Math.floor(x / hy.kmPerPx))), j = Math.min(hy.ny - 1, Math.max(0, Math.floor(y / hy.kmPerPx)));
        const k = j * hy.nx + i;
        return classifySurface(world, { moisture: hy.moisture[k], logArea: hy.logArea[k], water: hy.waterKind[k] === 1 || hy.waterKind[k] === 2, playa: hy.waterKind[k] === 3 }, h, slope, painted);
      }
      const moisture = Math.max(0, Math.min(1, c.baseMoisture + d(hf.moisture, x, y)));
      const elev = h - world.terrain.seaLevelM;
      if (elev < 0) return { mat: surfaceName(world, 'water', elev, slope), water: true, moisture: 1 };
      if (d(hf.lake, x, y) > 0.5) return { mat: surfaceName(world, 'lake basin', elev, slope), water: false, moisture };
      if (d(hf.river, x, y) > 0.5) return { mat: surfaceName(world, 'river', elev, slope), water: false, moisture };
      if (painted) return classifySurface(world, { moisture, logArea: 0, water: false, playa: false }, h, slope, painted);
      const dry = 1 - moisture * 1.6 + c.temperature * 0.3;
      let mat = 'grassland';
      if (elev > c.snowlineM && slope < 1.1) mat = 'snow';
      else if (slope > 0.75) mat = 'rock';
      else if (moisture > 0.48 && elev < c.treelineM && slope < 0.7) mat = 'forest';
      else if (elev > c.treelineM) mat = 'alpine';
      else if (dry > 0.85) mat = slope > 0.3 ? 'badlands' : 'desert';
      else if (dry > 0.55) mat = 'steppe';
      return { mat: surfaceName(world, mat, elev, slope), water: false, moisture };
    },
  };
}
