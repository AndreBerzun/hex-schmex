// Op stack evaluation: World -> design heightmap (metres), moisture bias and river mask.
// Pure TypeScript (no DOM / WebGL) so the browser, the CLI and the tests share it.

import { makeGrid, mapDims, type HexGrid } from './hex';
import {
  bboxOfPoints, clamp, lerp, polylineClosest, polylineInfo, regionBBox, regionMask, regionSdf,
  smoothPolyline, smoothstep, type BBox, type PolylineHit,
} from './geom';
import { hashString, Simplex2 } from './noise';
import type {
  BlendMode, CanyonOp, CoastOp, EscarpmentOp, HillsOp, LowlandsOp, Op, PeakOp, PlateauOp,
  Region, RiverOp, Side, StrokeOp, Vec2, World,
} from './types';

export interface Heightfield {
  nx: number;
  ny: number;
  kmPerPx: number;
  widthKm: number;
  heightKm: number;
  /** metres above datum (sea level is world.terrain.seaLevelM) */
  height: Float32Array;
  /** additive moisture bias from ops, roughly -1..1 */
  moisture: Float32Array;
  /** 0..1 explicit river channels from river ops / river strokes */
  river: Float32Array;
}

export interface EvalOptions {
  /** override world.terrain.designRes */
  res?: number;
  /** evaluate only ops [0, upTo) */
  upTo?: number;
}

export const DEFAULT_BLEND: Record<Op['type'], BlendMode> = {
  ridge: 'add', peak: 'add', plateau: 'max', basin: 'add', valley: 'min', river: 'min', canyon: 'min',
  coast: 'min', hills: 'add', lowlands: 'replace', escarpment: 'add', smooth: 'replace', roughen: 'add',
  stroke: 'add', moisture: 'add',
};

/** Ops whose value is relative (added) when blending with `add`. Others produce absolute targets. */
const RELATIVE_OPS = new Set<Op['type']>(['ridge', 'peak', 'basin', 'hills', 'escarpment', 'roughen']);

interface Ctx {
  world: World;
  grid: HexGrid;
  hf: Heightfield;
  seaLevel: number;
  maxElev: number;
}

export function evaluate(world: World, opts: EvalOptions = {}): Heightfield {
  const grid = makeGrid(world.grid);
  const res = opts.res ?? world.terrain.designRes;
  const { nx, ny, kmPerPx } = mapDims(grid, res);
  const hf: Heightfield = {
    nx, ny, kmPerPx, widthKm: nx * kmPerPx, heightKm: ny * kmPerPx,
    height: new Float32Array(nx * ny),
    moisture: new Float32Array(nx * ny),
    river: new Float32Array(nx * ny),
  };
  const ctx: Ctx = { world, grid, hf, seaLevel: world.terrain.seaLevelM, maxElev: world.terrain.maxElevationM };
  evalBase(ctx);
  const n = opts.upTo ?? world.ops.length;
  for (let i = 0; i < n; i++) {
    const op = world.ops[i];
    if (!op.enabled) continue;
    applyOp(ctx, op);
  }
  const lo = -world.terrain.maxElevationM, hi = world.terrain.maxElevationM * 1.6;
  const h = hf.height;
  for (let i = 0; i < h.length; i++) h[i] = clamp(h[i], lo, hi);
  return hf;
}

// ---------------------------------------------------------------- base terrain

const baseCache = new Map<string, Float32Array>();

/**
 * Base noise is evaluated at half resolution and bilinearly upsampled (its finest octave is >= 4 px),
 * and cached: it only depends on seed + base params + size, and most edits only touch ops.
 */
function evalBase(ctx: Ctx) {
  const { world, hf } = ctx;
  const key = JSON.stringify([world.seed, world.base, hf.nx, hf.ny, hf.kmPerPx]);
  const hit = baseCache.get(key);
  if (hit) { hf.height.set(hit); return; }
  const hx = Math.ceil(hf.nx / 2) + 1, hy = Math.ceil(hf.ny / 2) + 1;
  const half = new Float32Array(hx * hy);
  const step = hf.kmPerPx * 2;
  const b = world.base;
  const sx = new Simplex2(world.seed);
  const sw = new Simplex2(world.seed ^ 0x9e3779b9);
  const lam = Math.max(1, b.wavelengthKm);
  // finest octave should still be >= ~2 px of the half-res grid
  const maxOct = Math.max(1, Math.floor(Math.log2(lam / (2 * step))) + 1);
  const oct = Math.min(b.octaves, maxOct);
  const warpLam = lam * 1.7;
  for (let j = 0; j < hy; j++) {
    const y = j * step;
    for (let i = 0; i < hx; i++) {
      const x = i * step;
      let wx = x, wy = y;
      if (b.warpKm > 0) {
        wx += b.warpKm * sw.fbm(x / warpLam, y / warpLam, 3);
        wy += b.warpKm * sw.fbm(x / warpLam + 5.2, y / warpLam + 1.3, 3);
      }
      let v: number;
      if (b.type === 'fbm') v = sx.fbm(wx / lam, wy / lam, oct);
      else if (b.type === 'ridged') v = sx.ridged(wx / lam, wy / lam, oct) * 2 - 1;
      else {
        const f = sx.fbm(wx / lam, wy / lam, oct);
        const r = sx.ridged(wx / lam + 3.1, wy / lam - 7.7, oct) * 2 - 1;
        v = lerp(f, r, smoothstep(-0.1, 0.5, f));
      }
      half[j * hx + i] = b.elevation + b.amplitude * v;
    }
  }
  for (let j = 0; j < hf.ny; j++) {
    const fy = ((j + 0.5) * hf.kmPerPx) / step;
    const j0 = Math.min(hy - 2, Math.floor(fy)), ty = fy - j0;
    for (let i = 0; i < hf.nx; i++) {
      const fx = ((i + 0.5) * hf.kmPerPx) / step;
      const i0 = Math.min(hx - 2, Math.floor(fx)), tx = fx - i0;
      const k = j0 * hx + i0;
      hf.height[j * hf.nx + i] = lerp(lerp(half[k], half[k + 1], tx), lerp(half[k + hx], half[k + hx + 1], tx), ty);
    }
  }
  if (baseCache.size > 6) baseCache.delete(baseCache.keys().next().value as string);
  baseCache.set(key, hf.height.slice());
}

/** Region mask with a noise-warped boundary so rectangles and circles read as natural areas. */
function softRegion(sn: Simplex2, region: Region, x: number, y: number, fall: number): number {
  if (region.kind === 'all') return 1;
  let d = regionSdf(region, x, y);
  const amp = Math.max(1.5, fall * 0.7);
  if (d > fall + amp) return 0;
  d += amp * sn.fbm(x / 14 + 3.7, y / 14 - 1.9, 2);
  if (d <= 0) return 1;
  return fall <= 0 ? 0 : 1 - smoothstep(0, fall, d);
}

// ---------------------------------------------------------------- helpers

function pxBox(hf: Heightfield, b: BBox | null): [number, number, number, number] {
  if (!b) return [0, 0, hf.nx - 1, hf.ny - 1];
  const i0 = clamp(Math.floor(b.minX / hf.kmPerPx), 0, hf.nx - 1);
  const j0 = clamp(Math.floor(b.minY / hf.kmPerPx), 0, hf.ny - 1);
  const i1 = clamp(Math.ceil(b.maxX / hf.kmPerPx), 0, hf.nx - 1);
  const j1 = clamp(Math.ceil(b.maxY / hf.kmPerPx), 0, hf.ny - 1);
  return [i0, j0, i1, j1];
}

function blendValue(mode: BlendMode, relative: boolean, h: number, s: number, w: number, maxElev: number): number {
  if (w <= 0) return h;
  switch (mode) {
    case 'add':
      return relative ? h + s * w : h + (s - h) * w;
    case 'max':
      return lerp(h, Math.max(h, s), w);
    case 'min':
      return lerp(h, Math.min(h, s), w);
    case 'replace':
      return lerp(h, s, w);
    case 'multiply':
      return h * (1 + (w * s) / maxElev);
  }
}

export function sampleBilinear(a: Float32Array, nx: number, ny: number, xpx: number, ypx: number): number {
  const x = clamp(xpx - 0.5, 0, nx - 1), y = clamp(ypx - 0.5, 0, ny - 1);
  const i = Math.min(nx - 2, Math.floor(x)), j = Math.min(ny - 2, Math.floor(y));
  const fx = x - i, fy = y - j;
  const k = j * nx + i;
  const a00 = a[k], a10 = a[k + 1], a01 = a[k + nx], a11 = a[k + nx + 1];
  return lerp(lerp(a00, a10, fx), lerp(a01, a11, fx), fy);
}

/** Box blur (x2 passes, ~gaussian) of a sub-rectangle. Returns the blurred rectangle. */
function blurRect(src: Float32Array, nx: number, ny: number, box: [number, number, number, number], rad: number) {
  const [i0, j0, i1, j1] = box;
  const w = i1 - i0 + 1, h = j1 - j0 + 1;
  let a = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) a[j * w + i] = src[(j + j0) * nx + i + i0];
  const r = Math.max(1, Math.round(rad));
  let b = new Float32Array(w * h);
  for (let pass = 0; pass < 2; pass++) {
    // horizontal (edge-clamped, reading outside the rect from src where possible)
    for (let j = 0; j < h; j++) {
      const gj = j + j0;
      for (let i = 0; i < w; i++) {
        let s = 0;
        for (let k = -r; k <= r; k++) {
          const li = i + k;
          if (li >= 0 && li < w) s += a[j * w + li];
          else s += src[gj * nx + clamp(i0 + li, 0, nx - 1)];
        }
        b[j * w + i] = s / (2 * r + 1);
      }
    }
    for (let i = 0; i < w; i++) {
      const gi = i + i0;
      for (let j = 0; j < h; j++) {
        let s = 0;
        for (let k = -r; k <= r; k++) {
          const lj = j + k;
          if (lj >= 0 && lj < h) s += b[lj * w + i];
          else s += src[clamp(j0 + lj, 0, ny - 1) * nx + gi];
        }
        a[j * w + i] = s / (2 * r + 1);
      }
    }
  }
  return { data: a, w, h };
}

function opNoise(ctx: Ctx, op: Op, salt = 0): Simplex2 {
  return new Simplex2((hashString(op.id) ^ ctx.world.seed ^ salt) >>> 0);
}

function maskWeight(op: Op, x: number, y: number): number {
  if (!op.mask) return 1;
  const m = regionMask(op.mask.region, x, y, op.mask.falloffKm);
  return op.mask.invert ? 1 - m : m;
}

/** Generic per-pixel loop over a bbox. fn returns [value, weight]. */
function forEachPx(ctx: Ctx, op: Op, box: BBox | null, fn: (x: number, y: number, h: number, k: number) => [number, number] | null) {
  const { hf } = ctx;
  const [i0, j0, i1, j1] = pxBox(hf, box);
  const mode = op.blend ?? DEFAULT_BLEND[op.type];
  const rel = RELATIVE_OPS.has(op.type) || (op.type === 'stroke' && (op.brush === 'raise' || op.brush === 'lower' || op.brush === 'ridge' || op.brush === 'roughen'));
  const H = hf.height;
  for (let j = j0; j <= j1; j++) {
    const y = (j + 0.5) * hf.kmPerPx;
    for (let i = i0; i <= i1; i++) {
      const x = (i + 0.5) * hf.kmPerPx;
      const k = j * hf.nx + i;
      const r = fn(x, y, H[k], k);
      if (!r) continue;
      const w = r[1] * maskWeight(op, x, y);
      if (w <= 0) continue;
      H[k] = blendValue(mode, rel, H[k], r[0], w, ctx.maxElev);
    }
  }
}

function prepLine(points: Vec2[], step: number): Vec2[] {
  return smoothPolyline(points, step);
}

/** Sample the current heightfield along a line and build a monotonic (non-increasing) floor profile. */
function monotonicFloor(ctx: Ctx, pts: Vec2[], depth: number, smoothKm: number, autoReverse: boolean) {
  const { hf } = ctx;
  let info = polylineInfo(pts);
  const step = Math.max(hf.kmPerPx * 0.75, 0.1);
  const sampleAll = (inf: typeof info) => {
    const n = Math.max(2, Math.ceil(inf.length / step) + 1);
    const base = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = (i / (n - 1)) * inf.length;
      const p = pointAt(inf, s);
      base[i] = sampleBilinear(hf.height, hf.nx, hf.ny, p[0] / hf.kmPerPx, p[1] / hf.kmPerPx);
    }
    return base;
  };
  let base = sampleAll(info);
  if (autoReverse && base.length > 1) {
    // compare averaged heights near each end
    const m = Math.max(1, Math.floor(base.length * 0.1));
    let a = 0, b = 0;
    for (let i = 0; i < m; i++) { a += base[i]; b += base[base.length - 1 - i]; }
    if (a < b) {
      pts = pts.slice().reverse();
      info = polylineInfo(pts);
      base = sampleAll(info);
    }
  }
  // smooth the base with a moving average
  const n = base.length;
  const r = Math.max(0, Math.round(smoothKm / step));
  const sm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = -r; k <= r; k++) {
      const q = i + k;
      if (q >= 0 && q < n) { s += base[q]; c++; }
    }
    sm[i] = s / c;
  }
  // Never carve below the outlet: a valley grades into whatever it drains onto.
  const outlet = sm[n - 1] - Math.min(depth, 30);
  const floor = new Float32Array(n);
  let run = Infinity;
  for (let i = 0; i < n; i++) {
    run = Math.min(run, Math.max(sm[i] - depth, outlet));
    floor[i] = run;
  }
  return { info, floor, at: (s: number) => {
    const t = clamp(s / (info.length || 1), 0, 1) * (n - 1);
    const i = Math.min(n - 2, Math.floor(t));
    return lerp(floor[i], floor[i + 1], t - i);
  } };
}

function pointAt(info: ReturnType<typeof polylineInfo>, s: number): Vec2 {
  const p = info.pts;
  if (p.length === 1) return p[0];
  let lo = 0, hi = p.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (info.cum[mid] <= s) lo = mid; else hi = mid;
  }
  const seg = info.cum[hi] - info.cum[lo] || 1e-9;
  const t = clamp((s - info.cum[lo]) / seg, 0, 1);
  return [lerp(p[lo][0], p[hi][0], t), lerp(p[lo][1], p[hi][1], t)];
}

// ---------------------------------------------------------------- ops

function applyOp(ctx: Ctx, op: Op) {
  switch (op.type) {
    case 'ridge': return opRidge(ctx, op, op.points, op.height, op.width, op.sharpness, op.roughness, op.asymmetry);
    case 'peak': return opPeak(ctx, op);
    case 'plateau': return opPlateau(ctx, op);
    case 'basin': {
      const box = regionBBox(op.region, op.falloffKm + 3);
      const sn = opNoise(ctx, op);
      return forEachPx(ctx, op, box, (x, y) => {
        const d = regionSdf(op.region, x, y) + 3 * sn.fbm(x / 10, y / 10, 3);
        const w = smoothstep(op.falloffKm, -op.falloffKm, d);
        return w > 0 ? [-op.depth, w] : null;
      });
    }
    case 'valley': return opCarve(ctx, op, op.points, op.depth, op.width, op.profile, false);
    case 'river': return opRiver(ctx, op, op.points, op.width, op.depth, op.floodplainKm ?? Math.max(1.5, op.width * 4));
    case 'canyon': return opCanyon(ctx, op);
    case 'coast': return opCoast(ctx, op);
    case 'hills': return opHills(ctx, op);
    case 'lowlands': return opLowlands(ctx, op);
    case 'escarpment': return opEscarpment(ctx, op);
    case 'smooth': return opSmooth(ctx, op, op.region, op.falloffKm ?? 3, op.strength);
    case 'roughen': return opRoughen(ctx, op, op.region, op.falloffKm ?? 3, op.strength);
    case 'moisture': {
      const fall = op.falloffKm ?? 5;
      const box = regionBBox(op.region, fall * 1.7 + 2);
      const sn = opNoise(ctx, op);
      const [i0, j0, i1, j1] = pxBox(ctx.hf, box);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) * ctx.hf.kmPerPx, y = (j + 0.5) * ctx.hf.kmPerPx;
        const w = softRegion(sn, op.region, x, y, fall) * maskWeight(op, x, y);
        ctx.hf.moisture[j * ctx.hf.nx + i] += op.delta * w;
      }
      return;
    }
    case 'stroke': return opStroke(ctx, op);
  }
}

function opRidge(ctx: Ctx, op: Op, points: Vec2[], height: number, width: number, sharpness: number, roughness: number, asymmetry: number) {
  if (points.length === 0 || width <= 0) return;
  const pts = prepLine(points, Math.max(1.5, width / 4));
  const info = polylineInfo(pts);
  const sn = opNoise(ctx, op);
  const sr = opNoise(ctx, op, 0x51ed);
  const hit: PolylineHit = { d: 0, s: 0, side: 1 };
  const box = bboxOfPoints(pts, width * 1.6);
  const L = info.length;
  const taper = Math.max(1e-3, Math.min(width * 1.2, L * 0.35));
  const lamR = Math.max(width * 0.55, ctx.hf.kmPerPx * 6);
  const wRight = width * (1 - 0.45 * asymmetry), wLeft = width * (1 + 0.45 * asymmetry);
  const maxW = Math.max(wRight, wLeft) * 1.3;
  // crest height varies along the range (peaks and saddles): precompute along arc length
  const crestStep = Math.max(0.25, ctx.hf.kmPerPx);
  const crestN = Math.ceil(L / crestStep) + 2;
  const crestTab = new Float32Array(crestN);
  for (let i = 0; i < crestN; i++) crestTab[i] = 0.72 + 0.45 * sn.fbm((i * crestStep) / (width * 1.6) + 11.3, 0.37, 3);
  forEachPx(ctx, op, box, (x, y) => {
    polylineClosest(info, x, y, hit, maxW + width * 0.2);
    if (hit.d > maxW + width * 0.15) return null;
    // wobble the footprint so ranges don't look like tubes
    const wob = 1 + 0.3 * sn.fbm(x / (width * 1.3), y / (width * 1.3), 2);
    const jit = sn.noise(x / 9, y / 9) * width * 0.15;
    polylineClosest(info, x + jit, y - jit * 0.7, hit, maxW + width * 0.4);
    const w = (hit.side > 0 ? wRight : wLeft) * wob;
    const u = hit.d / w;
    if (u >= 1) return null;
    const p = 1 - u;
    const prof = lerp(p * p * (3 - 2 * p), p * p, sharpness);
    const along = L > 0 ? smoothstep(0, taper, hit.s) * smoothstep(0, taper, L - hit.s) : 1;
    const endFade = L > 0 ? lerp(0.25, 1, along) : 1;
    // crest height varies along the range: peaks and saddles
    const crest = crestTab[Math.min(crestN - 1, Math.max(0, Math.round(hit.s / crestStep)))];
    const det = sr.ridged(x / lamR, y / lamR, 6);
    const shape = prof * lerp(1, 0.3 + 1.25 * det, roughness);
    return [height * crest * endFade * shape, 1];
  });
}

function opPeak(ctx: Ctx, op: PeakOp) {
  const sn = opNoise(ctx, op);
  const R = Math.max(0.2, op.radius);
  const box: BBox = { minX: op.center[0] - R * 1.3, minY: op.center[1] - R * 1.3, maxX: op.center[0] + R * 1.3, maxY: op.center[1] + R * 1.3 };
  const lam = Math.max(R * 0.45, ctx.hf.kmPerPx * 5);
  forEachPx(ctx, op, box, (x, y) => {
    const dx = x - op.center[0], dy = y - op.center[1];
    const ang = Math.atan2(dy, dx);
    const rr = R * (1 + 0.22 * sn.noise(Math.cos(ang) * 1.3 + 4, Math.sin(ang) * 1.3 - 2));
    const u = Math.hypot(dx, dy) / rr;
    if (u >= 1) return null;
    const p = 1 - u;
    let v: number;
    const det = sn.ridged(x / lam, y / lam, 5);
    switch (op.shape) {
      case 'cone': v = Math.pow(p, 1.7) * lerp(1, 0.55 + 0.8 * det, 0.45); break;
      case 'dome': v = p * p * (3 - 2 * p) * lerp(1, 0.7 + 0.5 * det, 0.25); break;
      case 'massif': v = Math.pow(p * p * (3 - 2 * p), 1.2) * (0.35 + 1.0 * det); break;
      case 'volcano': {
        const cone = Math.pow(p, 1.9);
        const crater = smoothstep(0.22, 0.0, u);
        v = cone - crater * 0.32 + 0.06 * det * p;
        break;
      }
    }
    return [op.height * v, 1];
  });
}

function opPlateau(ctx: Ctx, op: PlateauOp) {
  const sn = opNoise(ctx, op);
  const e = lerp(op.edgeKm ?? 10, 0.35, clamp(op.edgeSteepness, 0, 1));
  const box = regionBBox(op.region, e + 6);
  const n = Math.max(0, Math.round(op.terraces));
  forEachPx(ctx, op, box, (x, y) => {
    let d = regionSdf(op.region, x, y);
    d += sn.fbm(x / 12, y / 12, 4) * Math.max(2, e) * 0.9;
    let t = clamp(0.5 - d / Math.max(e, 0.1), 0, 1);
    if (t <= 0) return null;
    t = t * t * (3 - 2 * t);
    if (n > 0) {
      const f = t * n;
      t = (Math.floor(f) + smoothstep(0.65, 1, f - Math.floor(f))) / n;
    }
    return [op.height, t];
  });
}

function opCarve(ctx: Ctx, op: Op, points: Vec2[], depth: number, width: number, profile: 'V' | 'U', markRiver: boolean) {
  if (points.length < 2 || width <= 0) return;
  const pts = prepLine(points, Math.max(ctx.hf.kmPerPx, Math.min(2, width / 3)));
  const fl = monotonicFloor(ctx, pts, depth, width * 0.75, true);
  const sn = opNoise(ctx, op);
  const hit: PolylineHit = { d: 0, s: 0, side: 1 };
  const box = bboxOfPoints(fl.info.pts, width * 1.3);
  const cap = Math.min(width * 1.5, fl.info.length * 0.3);
  forEachPx(ctx, op, box, (x, y, h, k) => {
    polylineClosest(fl.info, x, y, hit, width * 1.2);
    const w = width * (1 + 0.15 * sn.noise(hit.s / 7, 1.7)) * lerp(0.45, 1, smoothstep(0, cap, hit.s));
    const u = hit.d / w;
    if (u >= 1) return null;
    // the head of a valley rises into a cirque instead of ending in a wall
    const f = lerp(Math.max(h, fl.at(hit.s)), fl.at(hit.s), smoothstep(-cap * 0.3, cap, hit.s));
    let r: number;
    if (profile === 'U') {
      const q = clamp((u - 0.28) / 0.72, 0, 1);
      r = f + (Math.max(h, f) - f) * q * q;
    } else {
      r = f + (Math.max(h, f) - f) * Math.pow(u, 0.9);
    }
    if (markRiver) {
      const rw = Math.max(ctx.hf.kmPerPx * 0.7, width * 0.05);
      ctx.hf.river[k] = Math.max(ctx.hf.river[k], 1 - smoothstep(rw * 0.5, rw * 0.5 + ctx.hf.kmPerPx, hit.d));
    }
    return [r, 1];
  });
}

function opRiver(ctx: Ctx, op: RiverOp | StrokeOp, points: Vec2[], width: number, depth: number, flood: number) {
  if (points.length < 2) return;
  const pts = prepLine(points, Math.max(ctx.hf.kmPerPx, 1.5));
  const fl = monotonicFloor(ctx, pts, depth, Math.max(3, flood), true);
  const hit: PolylineHit = { d: 0, s: 0, side: 1 };
  const half = Math.max(width / 2, ctx.hf.kmPerPx * 0.35);
  const box = bboxOfPoints(fl.info.pts, half + flood + 1);
  forEachPx(ctx, op, box, (x, y, h, k) => {
    polylineClosest(fl.info, x, y, hit, half + flood);
    if (hit.d > half + flood) return null;
    const f = fl.at(hit.s);
    const bank = f + depth * 0.85;
    let r: number;
    if (hit.d <= half) r = f;
    else {
      const t = smoothstep(half, half + flood, hit.d);
      const plain = lerp(bank, Math.max(h, bank), t * t);
      const ch = smoothstep(half, half + ctx.hf.kmPerPx * 1.5, hit.d);
      r = lerp(f, plain, ch);
    }
    ctx.hf.river[k] = Math.max(ctx.hf.river[k], 1 - smoothstep(half, half + ctx.hf.kmPerPx, hit.d));
    ctx.hf.moisture[k] += 0.25 * (1 - smoothstep(half, half + flood * 1.5, hit.d));
    return [r, 1];
  });
}

function opCanyon(ctx: Ctx, op: CanyonOp) {
  if (op.points.length < 2) return;
  const pts = prepLine(op.points, Math.max(ctx.hf.kmPerPx, Math.min(2, op.width / 3)));
  const fl = monotonicFloor(ctx, pts, op.depth, op.width, true);
  const sn = opNoise(ctx, op);
  const hit: PolylineHit = { d: 0, s: 0, side: 1 };
  const half = op.width / 2;
  const box = bboxOfPoints(fl.info.pts, half * 1.6 + 2);
  const band = lerp(0.85, 0.12, clamp(op.wallSteepness, 0, 1));
  forEachPx(ctx, op, box, (x, y, h) => {
    polylineClosest(fl.info, x, y, hit, half * 1.4);
    if (hit.d > half * 1.4) return null;
    const hw = half * (1 + 0.35 * sn.fbm(x / 6, y / 6, 3));
    const u = hit.d / Math.max(hw, 0.1);
    if (u >= 1) return null;
    const f = fl.at(hit.s);
    let t = smoothstep(1 - band, 1, u);
    // stepped walls: a hint of strata
    const n = 4;
    const q = t * n;
    t = lerp(t, (Math.floor(q) + smoothstep(0.5, 1, q - Math.floor(q))) / n, 0.45);
    return [f + (Math.max(h, f) - f) * t, 1];
  });
}

const SIDE_NORMALS: Record<Side, { corner: (W: number, H: number) => Vec2; n: Vec2 }> = {
  N: { corner: () => [0, 0], n: [0, 1] },
  S: { corner: (_W, H) => [0, H], n: [0, -1] },
  W: { corner: () => [0, 0], n: [1, 0] },
  E: { corner: (W) => [W, 0], n: [-1, 0] },
  NW: { corner: () => [0, 0], n: [Math.SQRT1_2, Math.SQRT1_2] },
  NE: { corner: (W) => [W, 0], n: [-Math.SQRT1_2, Math.SQRT1_2] },
  SW: { corner: (_W, H) => [0, H], n: [Math.SQRT1_2, -Math.SQRT1_2] },
  SE: { corner: (W, H) => [W, H], n: [-Math.SQRT1_2, -Math.SQRT1_2] },
};

function opCoast(ctx: Ctx, op: CoastOp) {
  const { hf } = ctx;
  const sn = opNoise(ctx, op);
  const rough = clamp(op.roughness ?? 0.5, 0, 1);
  const fall = Math.max(0.5, op.falloffKm);
  let sdf: (x: number, y: number) => number;
  let box: BBox | null = null;
  if (op.region) {
    const reg = op.region;
    sdf = (x, y) => regionSdf(reg, x, y);
    box = regionBBox(reg, fall + 15 * rough + 2);
  } else {
    const side = SIDE_NORMALS[op.side ?? 'W'];
    const c = side.corner(hf.widthKm, hf.heightKm);
    const ext = op.extentKm ?? 20;
    sdf = (x, y) => (x - c[0]) * side.n[0] + (y - c[1]) * side.n[1] - ext;
  }
  forEachPx(ctx, op, box, (x, y) => {
    let d = sdf(x, y);
    // irregular coastline: bays and headlands at several scales
    d += rough * (14 * sn.fbm(x / 28, y / 28, 3) + 4 * sn.fbm(x / 6 + 9, y / 6 - 4, 3));
    const w = smoothstep(fall * 0.35, -fall, d);
    return w > 0 ? [op.targetElevation, w] : null;
  });
}

function opHills(ctx: Ctx, op: HillsOp) {
  const sn = opNoise(ctx, op);
  const fall = op.falloffKm ?? 6;
  const box = regionBBox(op.region, fall * 1.7 + 2);
  const lam = Math.max(op.wavelengthKm, ctx.hf.kmPerPx * 3);
  const oct = Math.max(1, Math.min(5, Math.floor(Math.log2(lam / (2 * ctx.hf.kmPerPx))) + 1));
  forEachPx(ctx, op, box, (x, y) => {
    const m = softRegion(sn, op.region, x, y, fall);
    if (m <= 0) return null;
    let v: number;
    if (op.style === 'rolling') v = sn.fbm(x / lam, y / lam, oct) * 0.5 + 0.5;
    else if (op.style === 'rugged') v = sn.ridged(x / lam, y / lam, oct + 1);
    else {
      const t = x / lam + 0.8 * sn.fbm(x / (lam * 4), y / (lam * 4), 2) + 0.15 * y / lam;
      const f = t - Math.floor(t);
      const saw = f < 0.75 ? f / 0.75 : (1 - f) / 0.25; // gentle windward, steep lee
      v = saw * saw * (3 - 2 * saw) * (0.6 + 0.4 * (sn.noise(x / (lam * 3), y / (lam * 3)) * 0.5 + 0.5));
    }
    return [op.amplitude * v, m];
  });
}

function opLowlands(ctx: Ctx, op: LowlandsOp) {
  const fall = op.falloffKm ?? 8;
  const box = regionBBox(op.region, fall * 1.7 + 2);
  const sn = opNoise(ctx, op);
  forEachPx(ctx, op, box, (x, y, h) => {
    const m = softRegion(sn, op.region, x, y, fall);
    if (m <= 0) return null;
    return [op.targetElevation + (h - op.targetElevation) * (1 - clamp(op.flatness, 0, 1)), m];
  });
}

function opEscarpment(ctx: Ctx, op: EscarpmentOp) {
  if (op.points.length < 2) return;
  const pts = prepLine(op.points, 2);
  const info = polylineInfo(pts);
  const sn = opNoise(ctx, op);
  const reach = op.reachKm ?? 25;
  const hit: PolylineHit = { d: 0, s: 0, side: 1 };
  const box = bboxOfPoints(pts, reach + op.width);
  const hs = op.side === 'right' ? 1 : -1;
  const L = info.length;
  const taper = Math.min(reach * 0.6, L * 0.3) || 1;
  forEachPx(ctx, op, box, (x, y) => {
    polylineClosest(info, x, y, hit, reach + op.width * 2);
    if (hit.d === Infinity) return null;
    let sd = hit.d * hit.side * hs;
    sd += sn.fbm(x / 8, y / 8, 4) * op.width * 1.2;
    const rise = smoothstep(-op.width / 2, op.width / 2, sd) * (1 - smoothstep(reach * 0.5, reach, sd));
    if (rise <= 0) return null;
    const along = smoothstep(-taper * 0.2, taper, hit.s) * smoothstep(-taper * 0.2, taper, L - hit.s);
    return [op.heightDelta * rise * along, 1];
  });
}

function opSmooth(ctx: Ctx, op: Op, region: Region, fall: number, strength: number) {
  const { hf } = ctx;
  const radKm = 0.5 + 4 * clamp(strength, 0, 1);
  const rpx = radKm / hf.kmPerPx;
  const rb = regionBBox(region, fall * 1.7 + 2 + radKm);
  const box = pxBox(hf, rb);
  const bl = blurRect(hf.height, hf.nx, hf.ny, box, rpx);
  const sn = opNoise(ctx, op);
  forEachPx(ctx, op, rb, (x, y, _h, k) => {
    const m = softRegion(sn, region, x, y, fall);
    if (m <= 0) return null;
    const i = (k % hf.nx) - box[0], j = Math.floor(k / hf.nx) - box[1];
    return [bl.data[j * bl.w + i], m * Math.min(1, strength * 1.5)];
  });
}

function opRoughen(ctx: Ctx, op: Op, region: Region, fall: number, strength: number) {
  const sn = opNoise(ctx, op);
  const lam = Math.max(3, ctx.hf.kmPerPx * 6);
  forEachPx(ctx, op, regionBBox(region, fall * 1.7 + 2), (x, y) => {
    const m = softRegion(sn, region, x, y, fall);
    if (m <= 0) return null;
    return [strength * 350 * (sn.ridged(x / lam, y / lam, 4) - 0.35), m];
  });
}

function opStroke(ctx: Ctx, op: StrokeOp) {
  const { hf } = ctx;
  if (op.points.length === 0) return;
  const R = Math.max(0.05, op.radius);
  const st = clamp(op.strength, 0, 1);
  const inv = op.invert ? -1 : 1;
  switch (op.brush) {
    case 'ridge':
      return opRidge(ctx, op, op.points, 1500 * st * inv, R, 0.6, 0.5, 0);
    case 'carve':
      if (op.river) return opRiver(ctx, op, op.points, Math.max(hf.kmPerPx, R * 0.1), 40 + 260 * st, R);
      return opCarve(ctx, op, op.points.length >= 2 ? op.points : [op.points[0], [op.points[0][0] + 0.01, op.points[0][1]]], 60 + 600 * st, R, 'V', false);
    default:
      break;
  }
  const info = polylineInfo(op.points);
  const hit: PolylineHit = { d: 0, s: 0, side: 1 };
  const soft = Math.max(0.05, clamp(op.falloff, 0, 1));
  const kernel = (x: number, y: number) => {
    polylineClosest(info, x, y, hit, R);
    const u = hit.d / R;
    return u >= 1 ? 0 : 1 - smoothstep(1 - soft, 1, u);
  };
  const box = bboxOfPoints(op.points, R + hf.kmPerPx);
  if (op.brush === 'moisture') {
    const [i0, j0, i1, j1] = pxBox(hf, box);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const kv = kernel((i + 0.5) * hf.kmPerPx, (j + 0.5) * hf.kmPerPx);
      hf.moisture[j * hf.nx + i] += inv * st * kv;
    }
    return;
  }
  if (op.brush === 'smooth' || op.brush === 'erode') {
    const rpx = (op.brush === 'smooth' ? R * 0.35 : R * 0.2) / hf.kmPerPx;
    const pb = pxBox(hf, box);
    const bl = blurRect(hf.height, hf.nx, hf.ny, pb, Math.max(1, rpx));
    return forEachPx(ctx, op, box, (x, y, h, k) => {
      const kv = kernel(x, y);
      if (kv <= 0) return null;
      const i = (k % hf.nx) - pb[0], j = Math.floor(k / hf.nx) - pb[1];
      const b = bl.data[j * bl.w + i];
      // erode: knock down bumps above the local mean more than it fills hollows
      const target = op.brush === 'smooth' ? b : h - Math.max(0, h - b) * 1.5 + Math.max(0, b - h) * 0.3;
      return [target, kv * st];
    });
  }
  if (op.brush === 'flatten') {
    const tgt = op.targetHeight ?? 0;
    return forEachPx(ctx, op, box, (x, y) => {
      const kv = kernel(x, y);
      return kv > 0 ? [tgt, kv * st] : null;
    });
  }
  if (op.brush === 'roughen') {
    const sn = opNoise(ctx, op);
    const lam = Math.max(1, hf.kmPerPx * 5);
    return forEachPx(ctx, op, box, (x, y) => {
      const kv = kernel(x, y);
      return kv > 0 ? [inv * st * 300 * (sn.ridged(x / lam, y / lam, 4) - 0.35), kv] : null;
    });
  }
  // raise / lower
  const sign = (op.brush === 'lower' ? -1 : 1) * inv;
  return forEachPx(ctx, op, box, (x, y) => {
    const kv = kernel(x, y);
    return kv > 0 ? [sign * 600 * st, kv] : null;
  });
}

/** Compute per-op bounding boxes (km) for highlighting / dirty regions. null = whole map. */
export function opBBox(op: Op): BBox | null {
  switch (op.type) {
    case 'ridge': return bboxOfPoints(op.points, op.width * 1.6);
    case 'peak': return { minX: op.center[0] - op.radius * 1.3, minY: op.center[1] - op.radius * 1.3, maxX: op.center[0] + op.radius * 1.3, maxY: op.center[1] + op.radius * 1.3 };
    case 'plateau': return regionBBox(op.region, 10);
    case 'basin': return regionBBox(op.region, op.falloffKm);
    case 'valley': case 'canyon': return bboxOfPoints(op.points, op.width * 1.6);
    case 'river': return bboxOfPoints(op.points, op.width + (op.floodplainKm ?? 4) + 2);
    case 'coast': return op.region ? regionBBox(op.region, op.falloffKm + 10) : null;
    case 'hills': case 'lowlands': case 'smooth': case 'roughen': case 'moisture': return regionBBox(op.region, op.falloffKm ?? 6);
    case 'escarpment': return bboxOfPoints(op.points, (op.reachKm ?? 25) + op.width);
    case 'stroke': return bboxOfPoints(op.points, op.radius * 1.6);
  }
}
