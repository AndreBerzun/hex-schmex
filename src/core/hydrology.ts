// Hydrology on the CPU (after erosion read-back): lakes, flow accumulation, moisture.
//
// Lakes: priority-flood depression filling (Barnes et al. 2014). Every closed depression deeper than
// `minLakeDepthM` and larger than `minLakeCells` becomes a lake at its spill level. Chosen over
// "render the sim's standing water" because it is deterministic, independent of erosion iteration
// count and resolution, always gives a flat lake surface with a real outlet, and its flood order
// gives a valid drainage order for flow accumulation for free.

import type { ClimateSettings } from './types';

export interface HydroInput {
  nx: number;
  ny: number;
  kmPerPx: number;
  height: Float32Array;
  seaLevelM: number;
  climate: ClimateSettings;
  /** additive moisture bias (same grid) */
  moistureBias?: Float32Array;
  /** 0..1 intended lakes (basin ops). Unintended depressions need to be big to count as lakes. */
  lakeIntent?: Float32Array;
  minLakeDepthM?: number;
  minLakeCells?: number;
}

export interface HydroOutput {
  /** water surface where wet; height - 1 where dry (so linear filtering behaves at shores) */
  waterLevel: Float32Array;
  /** 0 dry, 1 sea, 2 lake, 3 dry playa (endorheic basin in a dry climate) */
  waterKind: Uint8Array;
  /** log10 of upstream drainage area in km² */
  logArea: Float32Array;
  /** 0..1 */
  moisture: Float32Array;
  /** index of downstream cell, -1 at outlets */
  receiver: Int32Array;
}

export class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  size = 0;
  constructor(cap: number) {
    this.keys = new Float64Array(cap);
    this.vals = new Int32Array(cap);
  }
  push(k: number, v: number) {
    if (this.size >= this.keys.length) {
      const nk = new Float64Array(this.keys.length * 2); nk.set(this.keys); this.keys = nk;
      const nv = new Int32Array(this.vals.length * 2); nv.set(this.vals); this.vals = nv;
    }
    let i = this.size++;
    const K = this.keys, V = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= k) break;
      K[i] = K[p]; V[i] = V[p];
      i = p;
    }
    K[i] = k; V[i] = v;
  }
  pop(): number {
    const K = this.keys, V = this.vals;
    const top = V[0];
    const n = --this.size;
    const k = K[n], v = V[n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && K[c + 1] < K[c]) c++;
      if (K[c] >= k) break;
      K[i] = K[c]; V[i] = V[c];
      i = c;
    }
    K[i] = k; V[i] = v;
    return top;
  }
}

const DX = [-1, 1, 0, 0, -1, 1, -1, 1];
const DY = [0, 0, -1, 1, -1, -1, 1, 1];
const DD = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

export function computeHydrology(inp: HydroInput): HydroOutput {
  const { nx, ny, height: h, seaLevelM: sea } = inp;
  const n = nx * ny;
  const filled = new Float32Array(n);
  const closed = new Uint8Array(n);
  const order = new Int32Array(n);
  const parent = new Int32Array(n).fill(-1);
  const heap = new MinHeap(Math.max(1024, (nx + ny) * 4));
  const eps = 1e-3;
  for (let i = 0; i < nx; i++) for (const j of [0, ny - 1]) {
    const k = j * nx + i;
    if (closed[k]) continue;
    closed[k] = 1; filled[k] = Math.max(h[k], sea); heap.push(filled[k], k);
  }
  for (let j = 1; j < ny - 1; j++) for (const i of [0, nx - 1]) {
    const k = j * nx + i;
    closed[k] = 1; filled[k] = Math.max(h[k], sea); heap.push(filled[k], k);
  }
  let oc = 0;
  while (heap.size > 0) {
    const c = heap.pop();
    order[oc++] = c;
    const ci = c % nx, cj = (c / nx) | 0;
    for (let d = 0; d < 8; d++) {
      const i = ci + DX[d], j = cj + DY[d];
      if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const k = j * nx + i;
      if (closed[k]) continue;
      closed[k] = 1;
      filled[k] = Math.max(h[k], filled[c] + eps);
      parent[k] = c;
      heap.push(filled[k], k);
    }
  }

  // --- water: sea + lakes (filtered by depth and area)
  const minDepth = inp.minLakeDepthM ?? 3;
  const minCells = inp.minLakeCells ?? Math.max(6, Math.round(1.5 / (inp.kmPerPx * inp.kmPerPx)));
  const waterKind = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (h[k] < sea && filled[k] <= sea + 0.5) waterKind[k] = 1;
    else if (filled[k] - h[k] > minDepth) waterKind[k] = 2;
  }
  // remove small ponds (flood fill components)
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  const comp: number[] = [];
  const comps: number[][] = [];
  for (let k = 0; k < n; k++) {
    if (waterKind[k] !== 2 || seen[k]) continue;
    comp.length = 0;
    stack.push(k); seen[k] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      comp.push(c);
      const ci = c % nx, cj = (c / nx) | 0;
      for (let d = 0; d < 4; d++) {
        const i = ci + DX[d], j = cj + DY[d];
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const q = j * nx + i;
        if (!seen[q] && waterKind[q] === 2) { seen[q] = 1; stack.push(q); }
      }
    }
    let intended = 0, maxDepth = 0;
    for (const c of comp) {
      if (inp.lakeIntent && inp.lakeIntent[c] > 0.5) intended++;
      maxDepth = Math.max(maxDepth, filled[c] - h[c]);
    }
    // accidental depressions (noise, erosion debris) must be big and deep to read as lakes;
    // intended ones (basin ops) only need to exist
    const big = comp.length >= minCells * 4 && maxDepth >= 12;
    const keep = intended > 0 ? comp.length >= 3 : comp.length >= minCells && big;
    if (!keep) for (const c of comp) waterKind[c] = 0;
    else comps.push(comp.slice());
  }
  const waterLevel = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    waterLevel[k] = waterKind[k] === 1 ? sea : waterKind[k] === 2 ? filled[k] : h[k] - 1;
  }

  // --- flow: D8 steepest descent on the filled surface; flood parent where flat
  const receiver = new Int32Array(n).fill(-1);
  for (let k = 0; k < n; k++) {
    const ci = k % nx, cj = (k / nx) | 0;
    let best = -1, bestS = 0;
    for (let d = 0; d < 8; d++) {
      const i = ci + DX[d], j = cj + DY[d];
      if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const q = j * nx + i;
      const s = (filled[k] - filled[q]) / DD[d];
      if (s > bestS + 1e-6) { bestS = s; best = q; }
    }
    receiver[k] = bestS > eps * 2 ? best : parent[k];
  }
  const cellArea = inp.kmPerPx * inp.kmPerPx;
  const area = new Float32Array(n).fill(cellArea);
  for (let o = n - 1; o >= 0; o--) {
    const k = order[o];
    const r = receiver[k];
    if (r >= 0) area[r] += area[k];
  }
  const logArea = new Float32Array(n);
  for (let k = 0; k < n; k++) logArea[k] = Math.log10(area[k]);

  const moisture = computeMoisture(inp, waterKind, logArea);
  // closed lakes in a dry climate are playas (salt flats) rather than open water
  for (const comp of comps) {
    let m = 0;
    for (const c of comp) m += moisture[c];
    if (m / comp.length < 0.28) for (const c of comp) { waterKind[c] = 3; waterLevel[c] = h[c] - 1; }
  }
  return { waterLevel, waterKind, logArea, moisture, receiver };
}

/** Moisture 0..1 from base climate, rain shadow, windward slopes, nearby water, flow and op bias. */
function computeMoisture(inp: HydroInput, waterKind: Uint8Array, logArea: Float32Array): Float32Array {
  const { nx, ny, kmPerPx, height: h, climate } = inp;
  // coarse grid ~1.5 km
  const f = Math.max(1, Math.round(1.5 / kmPerPx));
  const cx = Math.ceil(nx / f), cy = Math.ceil(ny / f);
  const ch = new Float32Array(cx * cy);
  const cw = new Float32Array(cx * cy);
  for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let s = 0, w = 0, c = 0;
    for (let b = 0; b < f; b++) for (let a = 0; a < f; a++) {
      const x = Math.min(nx - 1, i * f + a), y = Math.min(ny - 1, j * f + b);
      const k = y * nx + x;
      s += Math.max(h[k], inp.seaLevelM);
      w += waterKind[k] ? 1 : 0;
      c++;
    }
    ch[j * cx + i] = s / c;
    cw[j * cx + i] = w / c;
  }
  const ckm = kmPerPx * f;
  // wind travels toward (windFrom + 180°); compass: 0 = north (-y), 90 = east (+x)
  const a = ((climate.windFromDeg + 180) * Math.PI) / 180;
  const wx = Math.sin(a), wy = -Math.cos(a);
  const reach = 70; // km of upwind look
  const steps = Math.ceil(reach / 3);
  const cm = new Float32Array(cx * cy);
  // water proximity: separable blur of the water mask (~12 km)
  const near = blur2(cw, cx, cy, Math.max(1, Math.round(12 / ckm)));
  const sample = (x: number, y: number) => {
    const i = Math.min(cx - 1, Math.max(0, Math.round(x))), j = Math.min(cy - 1, Math.max(0, Math.round(y)));
    return ch[j * cx + i];
  };
  for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    const k = j * cx + i;
    const here = ch[k];
    let shadow = 0;
    for (let s = 1; s <= steps; s++) {
      const dkm = s * 3;
      const up = sample(i - (wx * dkm) / ckm, j - (wy * dkm) / ckm);
      const decay = 1 - dkm / (reach + 10);
      shadow = Math.max(shadow, (up - here) * decay);
    }
    // windward: terrain rising along the wind direction
    const ahead = sample(i + (wx * 6) / ckm, j + (wy * 6) / ckm);
    const behind = sample(i - (wx * 6) / ckm, j - (wy * 6) / ckm);
    const rise = (ahead - behind) / 12000; // slope-ish
    let m = climate.baseMoisture;
    m -= Math.min(0.45, Math.max(0, shadow) / 2200);
    m += Math.max(-0.1, Math.min(0.2, rise * 2.5));
    m += 0.25 * near[k];
    m += Math.min(0.12, Math.max(0, (here - 600) / 8000));
    m -= climate.temperature * 0.15;
    cm[k] = m;
  }
  const smooth = blur2(cm, cx, cy, 1);
  const out = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const fx = Math.min(cx - 1.001, Math.max(0, (i + 0.5) / f - 0.5)), fy = Math.min(cy - 1.001, Math.max(0, (j + 0.5) / f - 0.5));
    const i0 = Math.floor(fx), j0 = Math.floor(fy), tx = fx - i0, ty = fy - j0;
    const i1 = Math.min(cx - 1, i0 + 1), j1 = Math.min(cy - 1, j0 + 1);
    const v = (smooth[j0 * cx + i0] * (1 - tx) + smooth[j0 * cx + i1] * tx) * (1 - ty) + (smooth[j1 * cx + i0] * (1 - tx) + smooth[j1 * cx + i1] * tx) * ty;
    const k = j * nx + i;
    const flow = Math.max(0, Math.min(1, (logArea[k] - 0.5) / 2.5));
    let m = v + 0.18 * flow + (inp.moistureBias ? inp.moistureBias[k] : 0);
    m = Math.max(0, Math.min(1, m));
    out[k] = m;
  }
  return out;
}

function blur2(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let s = 0, c = 0;
    for (let k = -r; k <= r; k++) { const x = i + k; if (x >= 0 && x < w) { s += src[j * w + x]; c++; } }
    tmp[j * w + i] = s / c;
  }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let s = 0, c = 0;
    for (let k = -r; k <= r; k++) { const y = j + k; if (y >= 0 && y < h) { s += tmp[y * w + i]; c++; } }
    out[j * w + i] = s / c;
  }
  return out;
}

/** Box-downsample a field by an integer factor. */
export function downsample(src: Float32Array, nx: number, ny: number, f: number): { data: Float32Array; nx: number; ny: number } {
  if (f <= 1) return { data: src, nx, ny };
  const ox = Math.floor(nx / f), oy = Math.floor(ny / f);
  const out = new Float32Array(ox * oy);
  for (let j = 0; j < oy; j++) for (let i = 0; i < ox; i++) {
    let s = 0;
    for (let b = 0; b < f; b++) for (let a = 0; a < f; a++) s += src[(j * f + b) * nx + i * f + a];
    out[j * ox + i] = s / (f * f);
  }
  return { data: out, nx: ox, ny: oy };
}

/** Bilinear resample to a new size (cell-centred). */
export function resample(src: Float32Array, nx: number, ny: number, ox: number, oy: number): Float32Array {
  const out = new Float32Array(ox * oy);
  for (let j = 0; j < oy; j++) {
    const fy = Math.min(ny - 1.0001, Math.max(0, ((j + 0.5) * ny) / oy - 0.5));
    const j0 = Math.floor(fy), ty = fy - j0, j1 = Math.min(ny - 1, j0 + 1);
    for (let i = 0; i < ox; i++) {
      const fx = Math.min(nx - 1.0001, Math.max(0, ((i + 0.5) * nx) / ox - 0.5));
      const i0 = Math.floor(fx), tx = fx - i0, i1 = Math.min(nx - 1, i0 + 1);
      out[j * ox + i] = (src[j0 * nx + i0] * (1 - tx) + src[j0 * nx + i1] * tx) * (1 - ty) + (src[j1 * nx + i0] * (1 - tx) + src[j1 * nx + i1] * tx) * ty;
    }
  }
  return out;
}
