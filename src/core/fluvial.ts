// Large-scale fluvial erosion: stream-power law, dh/dt = -K A^m S, solved with the implicit O(n)
// scheme of Braun & Willett (2013) on priority-flood drainage (Barnes 2014).
//
// Why a CPU stage before the GPU pipe model: the pipe model moves water about one cell per step, so a
// drainage network across a ~500-cell map needs thousands of iterations to self-organise. Stream power
// routes all flow globally every iteration, so ~25 iterations carve a dendritic valley network whose
// depth scales with catchment area (big rivers grade down, small gullies barely move). The GPU pipe
// model then adds gullies, deposition fans and talus at full resolution.

import { MinHeap, resample } from './hydrology';
import type { ErosionSettings } from './types';

export interface FluvialOptions {
  iterations: number;
  /** erosion coefficient (dimensionless, ~0.004 is "medium") */
  k: number;
  /** drainage-area exponent */
  m?: number;
  /** metres of sediment that can settle in a closed depression per iteration */
  pitFillM?: number;
  /** 0..1 per cell: intended lakes (basin ops) where depressions are kept open */
  lakeMask?: Float32Array;
  /** hillslope diffusion per iteration (0..0.25) */
  diffusion?: number;
}

const DX = [-1, 1, 0, 0, -1, 1, -1, 1];
const DY = [0, 0, -1, 1, -1, -1, 1, 1];
const DD = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

/** Erodes `h` in place. Cells below sea level are base level and are not eroded. */
export function fluvialErode(h: Float32Array, nx: number, ny: number, kmPerPx: number, seaM: number, o: FluvialOptions, onProgress?: (it: number) => void) {
  const n = nx * ny;
  const m = o.m ?? 0.5;
  const pitFillM = o.pitFillM ?? 2.5;
  const diff = o.diffusion ?? 0.0;
  const filled = new Float32Array(n);
  const closed = new Uint8Array(n);
  const order = new Int32Array(n);
  const recv = new Int32Array(n);
  const rdist = new Float32Array(n);
  const area = new Float32Array(n);
  const tmp = new Float32Array(n);
  const heap = new MinHeap(Math.max(1024, (nx + ny) * 8));
  const cellArea = kmPerPx * kmPerPx;
  const eps = 1e-3;
  const areaPower = m === 0.5 ? Math.sqrt : (a: number) => Math.pow(a, m);
  const neighbour = new Int32Array(DX.map((dx, d) => DY[d] * nx + dx));
  const neighbourKm = new Float32Array(DD.map((dd) => dd * kmPerPx));
  const onBorder = new Uint8Array(n);
  for (let i = 0; i < nx; i++) onBorder[i] = onBorder[(ny - 1) * nx + i] = 1;
  for (let j = 0; j < ny; j++) onBorder[j * nx] = onBorder[j * nx + nx - 1] = 1;

  for (let it = 0; it < o.iterations; it++) {
    // --- priority flood: order, filled surface, receivers
    closed.fill(0);
    recv.fill(-1);
    for (let i = 0; i < nx; i++) for (const j of [0, ny - 1]) {
      const k = j * nx + i;
      if (closed[k]) continue;
      closed[k] = 1; filled[k] = Math.max(h[k], seaM); heap.push(filled[k], k);
    }
    for (let j = 1; j < ny - 1; j++) for (const i of [0, nx - 1]) {
      const k = j * nx + i;
      closed[k] = 1; filled[k] = Math.max(h[k], seaM); heap.push(filled[k], k);
    }
    let oc = 0;
    while (heap.size > 0) {
      const c = heap.pop();
      order[oc++] = c;
      const interior = !onBorder[c];
      const ci = c % nx, cj = (c / nx) | 0;
      for (let d = 0; d < 8; d++) {
        if (!interior) {
          const i = ci + DX[d], j = cj + DY[d];
          if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        }
        const k = c + neighbour[d];
        if (closed[k]) continue;
        closed[k] = 1;
        filled[k] = Math.max(h[k], filled[c] + eps);
        recv[k] = c;
        rdist[k] = neighbourKm[d];
        heap.push(filled[k], k);
      }
    }
    // steepest descent on the filled surface where it's not flat (nicer than flood parents)
    for (let k = 0; k < n; k++) {
      if (recv[k] < 0) continue;
      const interior = !onBorder[k];
      const ci = k % nx, cj = (k / nx) | 0;
      const fk = filled[k];
      let best = -1, bestS = 0, bestD = 0;
      for (let d = 0; d < 8; d++) {
        if (!interior) {
          const i = ci + DX[d], j = cj + DY[d];
          if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        }
        const q = k + neighbour[d];
        const s = (fk - filled[q]) / DD[d];
        if (s > bestS) { bestS = s; best = q; bestD = d; }
      }
      if (best >= 0 && bestS > eps * 3) { recv[k] = best; rdist[k] = neighbourKm[bestD]; }
    }
    // --- drainage area
    area.fill(cellArea);
    for (let q = n - 1; q >= 0; q--) {
      const k = order[q];
      const r = recv[k];
      if (r >= 0) area[r] += area[k];
    }
    // --- implicit stream-power update, receivers first (ascending flood order)
    for (let q = 0; q < n; q++) {
      const k = order[q];
      const r = recv[k];
      if (r < 0 || h[k] < seaM) continue;
      const hr = h[r];
      if (h[k] > hr) {
        const f = (o.k * areaPower(area[k])) / rdist[k];
        h[k] = (h[k] + f * hr) / (1 + f);
      } else {
        // closed depression: sediment settles toward the spill level (unless a lake is intended here)
        const keep = o.lakeMask ? o.lakeMask[k] : 0;
        h[k] += Math.min(filled[k] - h[k], pitFillM) * (1 - keep);
      }
    }
    // --- light hillslope diffusion so valley walls relax a little
    if (diff > 0) {
      tmp.set(h);
      for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        if (h[k] < seaM) continue;
        const lap = tmp[k - 1] + tmp[k + 1] + tmp[k - nx] + tmp[k + nx] - 4 * tmp[k];
        h[k] += diff * lap;
      }
    }
    onProgress?.(it + 1);
  }
}

/** Run stream-power erosion at <= maxRes and add the (upsampled) incision back onto the design heights. */
export function fluvialOnDesign(h: Float32Array, nx: number, ny: number, kmPerPx: number, seaM: number, opts: FluvialOptions, maxRes: number, lake?: Float32Array): Float32Array {
  const f = Math.max(1, Math.max(nx, ny) / maxRes);
  const fx = Math.round(nx / f), fy = Math.round(ny / f);
  const lo = f > 1 ? resample(h, nx, ny, fx, fy) : h.slice();
  const orig = lo.slice();
  const lakeMask = lake ? (f > 1 ? resample(lake, nx, ny, fx, fy) : lake) : undefined;
  fluvialErode(lo, fx, fy, kmPerPx * (nx / fx), seaM, { ...opts, lakeMask });
  for (let i = 0; i < lo.length; i++) lo[i] -= orig[i];
  const delta = f > 1 ? resample(lo, fx, fy, nx, ny) : lo;
  const out = h.slice();
  for (let i = 0; i < out.length; i++) out[i] += delta[i];
  return out;
}

/** Fluvial options derived from the world's erosion settings. */
export function fluvialOptionsFor(e: ErosionSettings): FluvialOptions {
  return { iterations: Math.round(12 + e.iterations / 12), k: 0.012 * e.strength, pitFillM: 12 };
}
