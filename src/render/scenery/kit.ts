import type * as THREE from 'three';
import { hashString, mulberry32 } from '../../core/noise';
import type { Kind } from '../../core/scenery/kit';
import { curve, hash3, MeshBuilder, mixC, scaleC, vec, type C, type V } from './mesh';

export type Lod = 0 | 1 | 2;

const P = {
  crimson: [[0.72, 0.09, 0.13], [0.82, 0.16, 0.17], [0.66, 0.08, 0.22], [0.86, 0.3, 0.24]] as C[],
  tip: [0.98, 0.42, 0.36] as C,
  trunk: [0.26, 0.18, 0.2] as C,
  trunkLight: [0.42, 0.32, 0.3] as C,
  bone: [0.88, 0.84, 0.74] as C,
  boneDark: [0.62, 0.56, 0.46] as C,
  stone: [0.47, 0.46, 0.45] as C,
  stoneDark: [0.3, 0.3, 0.32] as C,
  moss: [0.56, 0.58, 0.24] as C,
  pale: [0.66, 0.63, 0.56] as C,
  gold: [0.8, 0.64, 0.26] as C,
  goldDark: [0.5, 0.4, 0.2] as C,
  wood: [0.42, 0.31, 0.21] as C,
  woodGrey: [0.5, 0.46, 0.4] as C,
  ochre: [0.72, 0.54, 0.32] as C,
  violet: [0.5, 0.3, 0.52] as C,
  orange: [0.9, 0.4, 0.2] as C,
  sandstone: [0.62, 0.5, 0.42] as C,
  sandstoneDark: [0.46, 0.37, 0.33] as C,
  slate: [0.44, 0.45, 0.5] as C,
  slateDark: [0.3, 0.31, 0.36] as C,
  masonry: [0.6, 0.58, 0.53] as C,
  dark: [0.07, 0.06, 0.07] as C,
};

function strata(y0: number, y1: number, s0: number, s1: number, lod: Lod, seed: number): { y: number; s: number }[] {
  const n = lod === 0 ? 14 : lod === 1 ? 6 : 2;
  const out: { y: number; s: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ledge = i > 0 && i < n ? (hash3([i, seed, 0], 4) - 0.5) * 0.08 : 0;
    out.push({ y: y0 + (y1 - y0) * t, s: s0 + (s1 - s0) * t + ledge });
  }
  return out;
}

const sides = (lod: Lod, a: number, b: number, c: number) => (lod === 0 ? a : lod === 1 ? b : c);
const band = (a: C, b: C, period: number, phase = 0) => (p: V) => mixC(a, b, 0.5 + 0.5 * Math.sin(p[1] / period + phase + Math.sin(p[0] * 0.3 + p[2] * 0.2)));

interface Branch { path: V[]; r0: number; r1: number; depth: number; tip: boolean }

function branches(rng: () => number, height: number, opts: { spread: number; levels: number; fork: number; flat: number; trunkLean?: number; trunk?: number }): Branch[] {
  const out: Branch[] = [];
  const grow = (from: V, dir: V, len: number, r: number, depth: number) => {
    const pts: V[] = [from];
    let d = dir;
    let p = from;
    for (let s = 1; s <= 3; s++) {
      d = vec.norm(vec.add(d, [(rng() - 0.5) * 0.5, -opts.flat * 0.15 * depth / opts.levels, (rng() - 0.5) * 0.5]));
      p = vec.add(p, vec.mul(d, len / 3));
      pts.push(p);
    }
    const tip = depth >= opts.levels;
    out.push({ path: pts, r0: r, r1: r * (tip ? 0.35 : 0.62), depth, tip });
    if (tip) return;
    const n = opts.fork + (rng() < 0.4 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const a = rng() * Math.PI * 2;
      const out2: V = [Math.cos(a), 0, Math.sin(a)];
      const nd = vec.norm(vec.add(vec.mul(d, 0.7 - opts.flat * 0.25), vec.mul(out2, opts.spread * (0.6 + rng() * 0.5))));
      grow(p, nd, len * (0.62 + rng() * 0.2), r * 0.62, depth + 1);
    }
  };
  const lean = opts.trunkLean ?? 0.15;
  grow([0, 0, 0], vec.norm([(rng() - 0.5) * lean, 1, (rng() - 0.5) * lean]), height * 0.42, height * (opts.trunk ?? 0.045), 0);
  return out;
}

function coralTree(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const dead = variant === 3;
  const H = 16;
  const sk = branches(rng, H, { spread: 1.15, levels: 3, fork: 2, flat: dead ? 0.1 : 0.8, trunkLean: 0.35, trunk: 0.065 });
  const red = P.crimson[variant % 4];
  const bark = dead ? ([0.36, 0.33, 0.36] as C) : P.trunk;
  for (const br of sk) {
    if (lod === 2 && br.depth > 0) continue;
    if (lod === 1 && br.depth > 1) continue;
    const s = br.depth === 0 ? sides(lod, 7, 5, 3) : sides(lod, 5, 4, 3);
    const path = lod === 0 ? curve(br.path, 6) : br.path;
    b.tube(path, path.map((_, i) => br.r0 + (br.r1 - br.r0) * i / (path.length - 1)), s, (p) => mixC(bark, P.trunkLight, Math.min(1, p[1] / H) * 0.6), { capEnd: br.tip, jitter: 0.12, seed: br.depth });
  }
  if (lod === 0) for (let k = 0; k < 4; k++) {
    const a = k * 1.57 + rng() * 0.8;
    const d: V = [Math.cos(a), 0, Math.sin(a)];
    b.tube(curve([[0, 1.6, 0], vec.add(vec.mul(d, 1.4), [0, 0.5, 0]), vec.add(vec.mul(d, 2.6), [0, -0.3, 0])], 4), [0.45, 0.35, 0.25, 0.15, 0.1], 4, bark);
  }
  if (dead) return;
  const tips = sk.filter((x) => x.depth >= (lod === 0 ? 2 : 1));
  const crownPaint = (p: V, n: V): C => mixC(scaleC(red, 0.75), P.tip, Math.max(0, n[1]) * 0.45 + hash3(p, 3) * 0.15);
  if (lod === 2) {
    const top = sk[0].path[sk[0].path.length - 1];
    b.blob([top[0], top[1] + 2.6, top[2]], [7, 3.4, 7], -1, crownPaint, { jitter: 0.15, seed: variant });
    return;
  }
  for (const t of tips) {
    const e = t.path[t.path.length - 1];
    const r = lod === 0 ? 2.2 + rng() * 1.1 : 3.6;
    b.blob([e[0], e[1] + 0.5, e[2]], [r * 1.2, r * 0.82, r * 1.2], lod === 0 ? 1 : 0, crownPaint, { jitter: 0.32, seed: hashString(String(e[0])), yaw: rng() * 6 });
    if (lod === 0) for (let k = 0; k < 6; k++) {
      const a = rng() * Math.PI * 2, rr = rng() * r * 0.9;
      const base: V = [e[0] + Math.cos(a) * rr, e[1] + 0.4, e[2] + Math.sin(a) * rr];
      const tipP = vec.add(base, [(rng() - 0.5) * 0.8, 1.1 + rng() * 1.2, (rng() - 0.5) * 0.8]);
      b.tube([base, tipP], [0.16, 0.05], 3, (_p, _n, tt) => mixC(red, P.tip, tt), { capEnd: true });
    }
  }
}

function coralClump(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const red = P.crimson[variant % 4];
  if (lod === 2) {
    b.prism([0, 0, 0], 0.55, 4, [{ y: 0, s: 0.7 }, { y: 0.9, s: 1 }, { y: 1.6, s: 0.25 }], (p) => mixC(scaleC(red, 0.7), P.tip, p[1] / 3), { jitter: 0.3, seed: variant });
    return;
  }
  const n = lod === 0 ? 16 : 6;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rng() * 0.6, lean = 0.15 + rng() * 0.55;
    const h = 0.9 + rng() * 0.7;
    const base: V = [Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15];
    const mid: V = [Math.cos(a) * lean * 0.6, h * 0.55, Math.sin(a) * lean * 0.6];
    const top: V = [Math.cos(a) * lean, h, Math.sin(a) * lean];
    const paint = (_p: V, _n: V, t: number) => mixC(scaleC(red, 0.6), P.tip, t * 0.8);
    b.tube(lod === 0 ? curve([base, mid, top], 3) : [base, top], lod === 0 ? [0.09, 0.08, 0.065, 0.05] : [0.12, 0.06], lod === 0 ? 4 : 3, paint, { capEnd: true });
    if (lod === 0 && rng() < 0.6) {
      const f: V = vec.add(mid, [Math.cos(a + 0.8) * 0.25, h * 0.35, Math.sin(a + 0.8) * 0.25]);
      b.tube([mid, f], [0.06, 0.035], 3, paint, { capEnd: true });
    }
  }
}

function tussock(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const g = variant === 2 ? mixC(P.gold, [0.6, 0.55, 0.3], 0.5) : P.gold;
  if (lod === 2) { b.prism([0, 0, 0], 0.35, 3, [{ y: 0, s: 1 }, { y: 1, s: 0.15 }], (p) => mixC(P.goldDark, g, p[1]), { seed: variant }); return; }
  const n = lod === 0 ? 14 : 5;
  for (let k = 0; k < n; k++) {
    const a = rng() * Math.PI * 2, l = 0.2 + rng() * 0.45, h = 0.6 + rng() * 0.45;
    b.tube([[0, 0, 0], [Math.cos(a) * l * 0.4, h * 0.6, Math.sin(a) * l * 0.4], [Math.cos(a) * l, h, Math.sin(a) * l]], [0.05, 0.03, 0.002], 3, (_p, _n, t) => mixC(P.goldDark, g, t));
  }
}

function stone(b: MeshBuilder, _rng: () => number, lod: Lod, variant: number, size = 1) {
  const mossy = variant >= 2;
  const paint = (p: V, n: V): C => mixC(mixC(P.stoneDark, P.stone, 0.5 + 0.5 * n[1]), mossy ? P.moss : P.pale, mossy ? Math.max(0, n[1] - 0.45) * 1.5 : hash3(p, 9) * 0.2);
  b.blob([0, 0.42 * size, 0], [0.7 * size, 0.58 * size, 0.62 * size], lod === 0 ? 1 : lod === 1 ? 0 : -1, paint, { jitter: 0.28, seed: variant * 7 + 1, cut: -0.6 });
}

function slab(b: MeshBuilder, _rng: () => number, lod: Lod, variant: number) {
  const paint = (p: V, n: V): C => scaleC(mixC(P.pale, variant === 1 ? P.moss : P.stone, n[1] > 0.5 ? 0.4 + hash3(p, 2) * 0.5 : 0.8), 0.7);
  b.prism([0, 0, 0], 1.9, lod === 2 ? 5 : 7, [{ y: 0, s: 0.92 }, { y: 0.35, s: 1 }], paint, { jitter: 0.25, seed: variant + 3, yaw: variant });
}

function bone(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const s = sides(lod, 5, 4, 3);
  if (variant === 0) {
    b.tube(curve([[-1.2, 0.1, 0], [-0.4, 0.9, 0.2], [0.6, 1.0, 0.1], [1.3, 0.2, 0]], lod === 0 ? 8 : 3), new Array(lod === 0 ? 9 : 4).fill(0).map((_, i, a) => 0.12 - 0.06 * i / a.length), s, P.bone, { capEnd: true });
  } else {
    b.tube([[-1.1, 0.15, 0], [1.1, 0.25, 0]], [0.12, 0.12], s, P.bone);
    b.blob([-1.15, 0.2, 0], [0.25, 0.22, 0.3], lod === 0 ? 0 : -1, P.bone);
    b.blob([1.15, 0.28, 0], [0.25, 0.22, 0.3], lod === 0 ? 0 : -1, P.bone);
    if (variant === 2) b.blob([0.2, 0.3, 0.6], [0.45, 0.35, 0.4], 0, mixC(P.bone, P.boneDark, rng() * 0.4), { jitter: 0.2 });
  }
}

function post(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const c = variant === 2 ? P.woodGrey : P.wood;
  const pts: V[] = [[0, 0, 0], [0.05, 1.8, 0.03], [rng() * 0.15, 3.5, rng() * 0.1]];
  b.tube(pts, [0.17, 0.15, 0.12], sides(lod, 5, 4, 3), (p) => mixC(scaleC(c, 0.7), P.woodGrey, p[1] / 5), { capEnd: true, jitter: 0.1, seed: variant });
  if (lod === 0) b.tube([pts[2], vec.add(pts[2], [0.05, 0.5, 0])], [0.08, 0], 3, c);
}

function fanCoral(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const col = [P.orange, P.violet, mixC(P.crimson[1], P.orange, 0.4)][variant % 3];
  const H = 5, W = 2.8;
  b.tube([[0, 0, 0], [0, 0.9, 0]], [0.18, 0.14], sides(lod, 5, 4, 3), scaleC(col, 0.55));
  const fan: V[] = [[0, 0.7, 0]];
  const n = lod === 2 ? 4 : lod === 1 ? 7 : 11;
  for (let k = 0; k <= n; k++) {
    const a = -1.25 + 2.5 * k / n;
    const r = H * (0.78 + rng() * 0.22);
    fan.push([Math.sin(a) * W * (r / H) * 1.1, 0.7 + Math.cos(a) * r * 0.85, (rng() - 0.5) * 0.25]);
  }
  b.sheet(fan, (p) => mixC(scaleC(col, 0.7), col, Math.min(1, p[1] / H)));
  if (lod === 0) for (let k = 1; k < fan.length; k += 2) b.tube([[0, 0.8, 0.05], vec.add(vec.mul(fan[k], 0.95), [0, 0, 0.05])], [0.07, 0.035], 3, scaleC(col, 0.6));
}

function brainMound(b: MeshBuilder, _rng: () => number, lod: Lod, variant: number) {
  const col = [[0.86, 0.52, 0.44], P.ochre, [0.62, 0.42, 0.6]][variant % 3] as C;
  const paint = (p: V): C => mixC(scaleC(col, 0.62), col, 0.5 + 0.5 * Math.sin(p[0] * 2.6 + Math.sin(p[2] * 2.2) * 2.4 + p[1] * 1.3));
  b.blob([0, 0.6, 0], [2.4, 2.9, 2.2], lod === 0 ? 2 : lod === 1 ? 1 : -1, paint, { jitter: 0.12, seed: variant + 11, cut: -0.25, flat: lod !== 0 });
}

function coralWall(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const red = P.crimson[variant % 4];
  const L = 16, H = 8;
  const n = lod === 0 ? 12 : lod === 1 ? 5 : 2;
  const pts: { x: number; h: number; t: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const x = -L / 2 + L * i / n;
    const end = Math.min(1, (L / 2 - Math.abs(x)) / 3 + 0.55);
    pts.push({ x, h: H * end * (0.55 + rng() * 0.6), t: 1.1 + rng() * 0.5 });
  }
  const paint = (p: V): C => mixC(scaleC(red, 0.42), mixC(red, P.tip, 0.15), Math.min(1, p[1] / H) * 0.85 + hash3(p, 5) * 0.15);
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[i + 1];
    const A0: V = [a.x, -0.5, -a.t], A1: V = [a.x, -0.5, a.t], A2: V = [a.x, a.h, a.t * 0.25], A3: V = [a.x, a.h, -a.t * 0.25];
    const C0: V = [c.x, -0.5, -c.t], C1: V = [c.x, -0.5, c.t], C2: V = [c.x, c.h, c.t * 0.25], C3: V = [c.x, c.h, -c.t * 0.25];
    b.quad(A1, C1, C2, A2, paint);
    b.quad(C0, A0, A3, C3, paint);
    b.quad(A2, C2, C3, A3, paint);
    if (i === 0) b.quad(A0, A1, A2, A3, paint);
    if (i === n - 1) b.quad(C1, C0, C3, C2, paint);
  }
  if (lod === 0) for (let k = 0; k < 18; k++) {
    const i = Math.floor(rng() * n), f = rng();
    const x = pts[i].x + (pts[i + 1].x - pts[i].x) * f, h = pts[i].h + (pts[i + 1].h - pts[i].h) * f;
    const base: V = [x, h - 0.3, (rng() - 0.5) * 0.6];
    b.tube([base, vec.add(base, [(rng() - 0.5) * 0.8, 0.8 + rng() * 1.6, (rng() - 0.5) * 0.8])], [0.22, 0.06], 4, (_p, _n, t) => mixC(red, P.tip, t * 0.7), { capEnd: true });
  }
  if (lod === 0) for (let k = 0; k < 5; k++) {
    const x = (rng() - 0.5) * L * 0.9, side = rng() < 0.5 ? -1 : 1;
    b.blob([x, 0.6 + rng() * 2, side * 1.0], [0.9, 0.7, 0.6], 0, mixC(red, P.violet, 0.4), { jitter: 0.3, seed: k });
  }
}

function wreck(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const wood = variant === 1 ? P.woodGrey : P.wood;
  const L = 38, beam = 6.5;
  const s = sides(lod, 5, 3, 3);
  const keel = curve([[-L / 2, 3.5, 0], [-L / 4, 0.4, 0], [L / 4, 0.3, 0], [L / 2, 4.5, 0]], lod === 0 ? 10 : 4);
  b.tube(keel, keel.map(() => 0.45), s, scaleC(wood, 0.8));
  if (lod === 2) {
    b.prism([0, 0, 0], 1, 6, [{ y: 0, s: 0.4 }, { y: 4.5, s: 1 }], wood, { stretch: [L / 2.2, beam / 2], capTop: true });
    return;
  }
  const ribs = lod === 0 ? 13 : 6;
  for (let i = 0; i < ribs; i++) {
    const x = -L * 0.42 + L * 0.84 * i / (ribs - 1);
    const w = beam * Math.sqrt(1 - (x / (L * 0.55)) ** 2);
    const broken = rng();
    for (const side of [-1, 1]) {
      if (broken < 0.25 && side === 1) continue;
      const top = 7 + rng() * 3 * (side === -1 ? 1 : 0.4);
      const arc = curve([[x, 0.4, 0], [x, 1.2, side * w * 0.9], [x, top * 0.6, side * w], [x, top, side * w * 0.8]], lod === 0 ? 6 : 3);
      b.tube(arc, arc.map(() => 0.28), s, wood);
    }
  }
  const planks = lod === 0 ? 5 : 2;
  for (let j = 0; j < planks; j++) {
    const y = 1.2 + j * 1.1, x0 = -L * 0.35 + rng() * L * 0.2, x1 = L * 0.2 + rng() * L * 0.2;
    const zr = (x: number) => -beam * Math.sqrt(Math.max(0, 1 - (x / (L * 0.55)) ** 2)) * (0.95 + j * 0.02);
    const segs = lod === 0 ? 6 : 3;
    for (let k = 0; k < segs; k++) {
      const xa = x0 + (x1 - x0) * k / segs, xb = x0 + (x1 - x0) * (k + 1) / segs;
      b.sheet([[xa, y, zr(xa)], [xb, y, zr(xb)], [xb, y + 0.9, zr(xb)], [xa, y + 0.9, zr(xa)]], (p) => mixC(scaleC(wood, 0.75), wood, hash3([Math.floor(p[0] / 3), p[1], 0], 1)));
    }
  }
  b.tube([[L * 0.08, 0.5, 0], [L * 0.08 + 3, 9, 1.5], [L * 0.08 + 5.5, 15 + variant * 2, 2.6]], [0.5, 0.4, 0.3], s, scaleC(wood, 0.7), { capEnd: true });
}

function boulder(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const barnacle = variant >= 2;
  const paint = (p: V, n: V): C => {
    let c = mixC(P.stoneDark, P.stone, 0.45 + 0.55 * n[1]);
    if (barnacle) c = mixC(c, n[1] > 0.4 ? P.moss : P.pale, n[1] > 0.4 ? (n[1] - 0.4) * 1.3 : hash3(p, 4) * 0.35);
    return c;
  };
  b.blob([0, 1.6, 0], [3, 2.6, 2.6], lod === 0 ? 1 : lod === 1 ? 0 : -1, paint, { jitter: 0.3, seed: variant * 5 + 2, cut: -0.5 });
  if (lod === 0 && variant % 2 === 0) b.blob([2.2, 0.6, 1.4], [1.3, 1, 1.1], 0, paint, { jitter: 0.25, seed: variant + rng() });
}

function tubeSponge(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const col = [P.ochre, P.violet, [0.78, 0.45, 0.3]][variant % 3] as C;
  const n = lod === 2 ? 1 : lod === 1 ? 3 : 5 + Math.floor(rng() * 3);
  const s = sides(lod, 8, 6, 4);
  for (let k = 0; k < n; k++) {
    const a = rng() * Math.PI * 2, d = k === 0 ? 0 : 1.2 + rng() * 1.4;
    const h = k === 0 ? 9 : 3.5 + rng() * 5, r = k === 0 ? 1.1 : 0.6 + rng() * 0.5;
    const base: V = [Math.cos(a) * d, 0, Math.sin(a) * d];
    const top: V = [base[0] + (rng() - 0.5) * 0.8, h, base[2] + (rng() - 0.5) * 0.8];
    const path = lod === 0 ? curve([base, vec.add(vec.mul(vec.add(base, top), 0.5), [0.2, 0, 0.1]), top], 4) : [base, top];
    b.tube(path, path.map((_, i) => r * (1.15 - 0.2 * i / (path.length - 1))), s, (p) => mixC(scaleC(col, 0.6), col, p[1] / 9 + 0.2));
    b.tube([top, vec.add(top, [0, 0.35, 0])], [r * 1.05, r * 1.2], s, mixC(col, P.pale, 0.3));
    const lip = vec.add(top, [0, 0.3, 0]);
    b.prism(lip, r * 1.1, s, [{ y: 0, s: 1 }], P.dark, { capTop: true });
  }
}

function ribs(b: MeshBuilder, rng: () => number, lod: Lod, _variant: number) {
  const n = lod === 2 ? 2 : lod === 1 ? 4 : 7;
  const len = 18;
  b.tube([[-len / 2, 0.3, 0], [len / 2, 0.6, 0]], [0.55, 0.4], sides(lod, 6, 4, 3), P.boneDark);
  for (let i = 0; i < n; i++) {
    const x = -len * 0.4 + len * 0.8 * i / Math.max(1, n - 1);
    const h = 9 * (0.65 + 0.35 * Math.sin(Math.PI * (i + 0.5) / n)) * (0.85 + rng() * 0.2);
    for (const side of [-1, 1]) {
      if (rng() < 0.12) continue;
      const arc = curve([[x, 0.3, side * 0.4], [x, h * 0.45, side * h * 0.42], [x + 0.6, h * 0.85, side * h * 0.3], [x + 1.2, h, side * h * 0.1]], lod === 0 ? 7 : 3);
      b.tube(arc, arc.map((_, k) => 0.42 - 0.3 * k / arc.length), sides(lod, 5, 3, 3), (_p, _n, t) => mixC(P.boneDark, P.bone, 0.4 + t * 0.6), { capEnd: true });
    }
  }
}

function deadTrunk(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const c = [P.woodGrey, [0.32, 0.27, 0.25], [0.4, 0.36, 0.34]][variant % 3] as C;
  const H = 10;
  const pts = curve([[0, 0, 0], [0.2, H * 0.35, 0.1], [-0.1, H * 0.7, 0.3], [0.2, H, 0.2]], lod === 0 ? 6 : 2);
  b.tube(pts, pts.map((_, i) => 0.42 * (1 - 0.7 * i / (pts.length - 1))), sides(lod, 6, 4, 3), (p) => mixC(scaleC(c, 0.7), c, p[1] / H), { capEnd: true, jitter: 0.15, seed: variant });
  if (lod === 2) return;
  const n = lod === 0 ? 4 : 2;
  for (let k = 0; k < n; k++) {
    const y = H * (0.45 + 0.4 * rng()), a = rng() * Math.PI * 2, l = 1.5 + rng() * 2.5;
    const s: V = [0, y, 0];
    b.tube([s, [Math.cos(a) * l * 0.6, y + l * 0.5, Math.sin(a) * l * 0.6], [Math.cos(a) * l, y + l * 0.6 + rng(), Math.sin(a) * l]], [0.16, 0.09, 0.03], 3, c, { capEnd: true });
  }
}

function reedBed(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const g = variant === 1 ? mixC(P.gold, [0.6, 0.58, 0.32], 0.45) : variant === 2 ? mixC(P.gold, P.ochre, 0.4) : P.gold;
  const soil: C = [0.2, 0.17, 0.13];
  const R = 15.4;
  b.prism([0, 0, 0], R, lod === 2 ? 6 : 12, [{ y: -0.5, s: 1.03 }, { y: 0.25, s: 1 }, { y: 0.4, s: 0.9 }], (_p, _n, t) => mixC(soil, mixC(P.goldDark, g, 0.55), Math.min(1, t * 1.6)), { jitter: 0.35, seed: variant * 3 + 1, stretch: [1, 0.75] });
  const n = lod === 0 ? 70 : lod === 1 ? 14 : 0;
  for (let k = 0; k < n; k++) {
    const a = rng() * 6.28, d = Math.sqrt(rng()) * R * 0.88;
    const x = Math.cos(a) * d, z = Math.sin(a) * d * 0.75;
    const h = 0.6 + rng() * 0.6, w = lod === 0 ? 0.55 + rng() * 0.5 : 1.4;
    b.prism([x, 0.3, z], w, lod === 0 ? 4 : 3, [{ y: 0, s: 1 }, { y: h * 0.6, s: 0.75 }, { y: h, s: 0.08 }], (_p, _n, t) => mixC(P.goldDark, g, 0.45 + t * 0.4), { jitter: 0.3, seed: k, yaw: rng() * 3 });
  }
}

function tor(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const paint = (_p: V, n: V): C => mixC(mixC(P.stoneDark, [0.52, 0.5, 0.47], 0.4 + 0.6 * n[1]), P.moss, n[1] > 0.7 ? 0.25 : 0);
  if (lod === 2) { b.blob([0, 6, 0], [6.5, 7.5, 6], -1, paint, { jitter: 0.2, seed: variant }); return; }
  let y = 0, w = 6.5;
  const n = 3 + (variant % 2);
  for (let k = 0; k < n; k++) {
    const h = 3 + rng() * 2.5;
    const off: V = [(rng() - 0.5) * 2, 0, (rng() - 0.5) * 2];
    b.blob([off[0], y + h / 2, off[2]], [w, h * 0.62, w * (0.7 + rng() * 0.3)], lod === 0 ? 1 : 0, paint, { jitter: 0.18, seed: variant * 13 + k, yaw: rng() * 3 });
    y += h * 0.92; w *= 0.72 + rng() * 0.15;
  }
  if (lod === 0) for (let k = 0; k < 4; k++) b.blob([(rng() - 0.5) * 14, 0.5, (rng() - 0.5) * 14], [1.4, 1, 1.2], 0, paint, { jitter: 0.3, seed: k + 40 });
}

function spiralShell(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const paint = (_p: V, _n: V, t: number): C => mixC(P.bone, [0.62, 0.46, 0.3], Math.pow(0.5 + 0.5 * Math.sin(t * 60), 3) * 0.6 + (1 - t) * 0.25);
  const segs = lod === 0 ? 46 : lod === 1 ? 18 : 8;
  const s = sides(lod, 10, 6, 3);
  if (variant === 0) {
    const pts: V[] = [], radii: number[] = [];
    const turns = 2.4, a0 = 0.42, k = 0.19;
    for (let i = 0; i <= segs; i++) {
      const th = (i / segs) * turns * Math.PI * 2;
      const r = a0 * Math.exp(k * th);
      pts.push([Math.cos(th) * r, 5 + Math.sin(th) * r, 0]);
      radii.push(r * 0.62);
    }
    b.tube(pts, radii, s, paint, { capStart: true, squash: 0.75 });
    const end = pts[pts.length - 1];
    b.blob(end, [radii[radii.length - 1] * 0.2, radii[radii.length - 1] * 0.95, radii[radii.length - 1] * 0.8], 0, P.dark);
  } else {
    const pts: V[] = [], radii: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, th = t * 5 * Math.PI * 2, r = 2.8 * (1 - t);
      pts.push([Math.cos(th) * r * 0.5, 9 * t, Math.sin(th) * r * 0.5]);
      radii.push(2.6 * (1 - t) + 0.08);
    }
    b.tube(pts, radii, s, (p, n, t) => paint(p, n, t * 0.7), { capEnd: true, capStart: true });
  }
  if (lod === 0) for (let k = 0; k < 3; k++) b.blob([(rng() - 0.5) * 8, 0.2, (rng() - 0.5) * 6], [0.9, 0.4, 0.7], 0, P.boneDark, { seed: k });
}

function coralSkeleton(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const sk = branches(rng, 9, { spread: 0.8, levels: 3, fork: 2, flat: 0, trunkLean: 0.25, trunk: 0.06 });
  const c = variant === 2 ? ([0.82, 0.72, 0.5] as C) : P.bone;
  for (const br of sk) {
    if (lod === 2 && br.depth > 1) continue;
    if (lod === 1 && br.depth > 2) continue;
    b.tube(br.path, br.path.map((_, i) => (br.r0 + (br.r1 - br.r0) * i / 3) * 1.7), sides(lod, 5, 4, 3), (p) => mixC(P.boneDark, c, Math.min(1, 0.4 + p[1] / 9)), { capEnd: br.tip });
  }
}

function skull(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const d = lod === 0 ? 1 : lod === 1 ? 0 : -1;
  const paint = (p: V, n: V): C => mixC(P.boneDark, P.bone, 0.5 + 0.5 * n[1] - hash3(p, 6) * 0.15);
  b.blob([0, 3.2, 0], [3.2, 2.9, 3.6], d, paint, { jitter: 0.1, seed: 31, cut: -0.6 });
  b.blob([0, 1.8, 3.4], [1.9, 1.5, 2.6], d, paint, { jitter: 0.12, seed: 32 });
  if (lod === 2) return;
  for (const s of [-1, 1]) {
    b.blob([s * 1.5, 3.4, 2.75], [0.95, 0.85, 0.7], 0, P.dark, { seed: 33 });
    if (variant === 1) b.tube(curve([[s * 2.6, 4.6, 0.5], [s * 4.4, 6, -0.5], [s * 5, 7.6, -2.4]], lod === 0 ? 6 : 2), lod === 0 ? [0.8, 0.7, 0.55, 0.4, 0.28, 0.15, 0.02] : [0.8, 0.4, 0.02], 5, P.bone);
  }
  if (lod === 0) b.box([0, 0.5, 4.2], [2.6, 0.6, 2.4], P.boneDark, { jitter: 0.3, seed: rng() * 9 });
}

function fallenBlock(b: MeshBuilder, rng: () => number, _lod: Lod, variant: number) {
  const paint = (p: V, n: V): C => mixC(mixC(P.stoneDark, P.slate, 0.4 + 0.6 * Math.max(0, n[1])), P.pale, hash3(p, 7) * 0.12);
  b.blob([0, 3.6, 0], [5.5 + rng() * 2, 4.4, 3.8 + rng()], 0, paint, { jitter: 0.12, seed: variant * 3 + 4, yaw: rng() * 3 });
  b.box([1, 3.2, 0.5], [8 + rng() * 3, 7, 5.5 + rng() * 2], paint, { jitter: 0.9, seed: variant * 3 + 5, tiltX: (rng() - 0.5) * 0.3, tiltZ: (rng() - 0.5) * 0.3 });
  if (variant === 2) b.box([4, 1.5, 3], [4, 3, 3], paint, { jitter: 0.4, seed: 17, yaw: 0.7 });
}

function ruinWall(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const paint = (p: V, n: V): C => mixC(mixC(scaleC(P.masonry, 0.7), P.masonry, 0.5 + 0.5 * n[1] + hash3([Math.floor(p[0] / 1.2), Math.floor(p[1] / 0.6), 0], variant) * 0.2), P.moss, p[1] < 1.5 ? 0.35 : 0);
  const L = 16, T = 1.6;
  const segs = lod === 2 ? 2 : lod === 1 ? 4 : 8;
  for (let i = 0; i < segs; i++) {
    const x0 = -L / 2 + L * i / segs, w = L / segs;
    const hgt = 9 * (0.35 + 0.65 * Math.abs(Math.sin(i * 1.7 + variant * 2.1))) * (0.85 + rng() * 0.3);
    const window = lod === 0 && i === Math.floor(segs / 2) && hgt > 6;
    if (window) {
      b.box([x0 + w / 2, 1.5, 0], [w, 3, T], paint);
      b.box([x0 + w / 2, hgt - 1, 0], [w, 2, T], paint);
    } else b.box([x0 + w / 2, hgt / 2, 0], [w * 1.02, hgt, T], paint, { jitter: 0.08, seed: i });
  }
  if (lod === 0) for (let k = 0; k < 5; k++) b.box([(rng() - 0.5) * L, 0.4, (rng() - 0.5) * 6 + 2.5], [1.2, 0.8, 0.9], paint, { yaw: rng() * 3, jitter: 0.3, seed: k });
}

function hornSpire(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const H = 60, R = 9.5;
  const bend = 16 + variant * 7;
  const segs = lod === 0 ? 14 : lod === 1 ? 6 : 3;
  const pts = curve([[0, -2, 0], [bend * 0.15, H * 0.35, 0], [bend * 0.55, H * 0.7, rng() * 2], [bend, H, 0]], segs);
  const radii = pts.map((_, i) => { const t = i / segs; return R * Math.pow(1 - t, 0.8) * (1 + (lod === 0 ? 0.09 * Math.abs(Math.sin(t * 36)) : 0)) + 0.05; });
  b.tube(pts, radii, sides(lod, 9, 6, 4), (_p, n, t) => mixC(mixC(P.slateDark, P.slate, 0.5 + 0.5 * Math.sin(t * 30 + variant)), P.pale, Math.max(0, n[1]) * 0.25 + t * 0.15), { capEnd: true, jitter: lod === 0 ? 0.1 : 0, seed: variant });
  if (lod === 0) for (let k = 0; k < 6; k++) {
    const a = rng() * 6.28;
    b.blob([Math.cos(a) * R * 1.1, 0.5, Math.sin(a) * R * 1.1], [2.5, 1.8, 2.2], 0, P.slateDark, { jitter: 0.3, seed: k });
  }
}

function leaningTower(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const H = 55, R = 7;
  const s = sides(lod, 10, 8, 4);
  const paint = (p: V, n: V): C => mixC(mixC(P.slateDark, P.masonry, 0.4 + 0.4 * Math.max(0, n[1]) + 0.2 * hash3([Math.floor(p[1] / 2), 0, 0], variant)), P.moss, p[1] < 6 ? 0.3 : 0);
  const levels = lod === 2 ? [{ y: -2, s: 1.05 }, { y: H, s: 0.55 }] : [{ y: -2, s: 1.1 }, { y: H * 0.3, s: 0.92 }, { y: H * 0.31, s: 1.12 }, { y: H * 0.33, s: 0.9 }, { y: H * 0.62, s: 0.78 }, { y: H * 0.63, s: 0.98 }, { y: H * 0.65, s: 0.75 }, { y: H * 0.92, s: 0.62 }];
  b.prism([0, 0, 0], R, s, levels, paint, { capTop: true, seed: variant });
  if (lod === 2) return;
  const top = H * 0.92;
  for (let k = 0; k < s; k++) {
    if (rng() < 0.35) continue;
    const a = (k + 0.5) / s * Math.PI * 2, r = R * 0.6;
    b.box([Math.cos(a) * r, top + 1.5 + rng() * 4, Math.sin(a) * r], [2, 3 + rng() * 6, 1.2], paint, { yaw: -a });
  }
  if (variant === 1) b.prism([0, top, 0], R * 0.35, 6, [{ y: 0, s: 1 }, { y: 12, s: 0.6 }, { y: 20, s: 0 }], paint);
  if (lod === 0) for (let row = 0; row < 5; row++) for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + row * 0.6, y = 8 + row * 9;
    const r = R * (1 - 0.4 * y / H) + 0.05;
    b.box([Math.cos(a) * r, y, Math.sin(a) * r], [0.4, 2.6, 1.1], P.dark, { yaw: -a });
  }
}

function coralPlateau(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const H = 20, R = 60;
  const stemPaint = (p: V): C => mixC(scaleC(P.sandstoneDark, 0.8), P.pale, Math.min(1, Math.max(0, p[1] / H)) * 0.5);
  b.prism([0, 0, 0], R * 0.3, sides(lod, 9, 6, 4), [{ y: -1, s: 1.15 }, { y: H * 0.5, s: 0.8 }, { y: H * 0.78, s: 0.95 }], stemPaint, { jitter: 0.25, seed: variant, capTop: false });
  const capS = sides(lod, 14, 9, 6);
  b.prism([0, H * 0.74, 0], R, capS, [{ y: 0, s: 0.72 }, { y: H * 0.12, s: 0.98 }, { y: H * 0.2, s: 1 }, { y: H * 0.26, s: 0.95 }], (_p, n, t) => t > 0.8 || n[1] > 0.6 ? mixC(P.orange, P.crimson[variant % 4], 0.4) : mixC(P.pale, P.sandstone, 0.4), { jitter: 0.3, seed: variant * 7 + 3, stretch: [1, 0.7 + rng() * 0.3] });
  if (lod === 2) return;
  const n = lod === 0 ? 26 : 6;
  for (let k = 0; k < n; k++) {
    const a = rng() * 6.28, d = Math.sqrt(rng()) * R * 0.8;
    const r = lod === 0 ? 6 + rng() * 9 : 16;
    b.blob([Math.cos(a) * d, H * 0.97, Math.sin(a) * d * 0.8], [r, r * 0.55, r], lod === 0 ? 0 : -1, (p, nn) => mixC(scaleC(P.orange, 0.75), mixC(P.orange, P.crimson[k % 4], 0.5), nn[1] * 0.6 + hash3(p, 1) * 0.3), { jitter: 0.3, seed: k });
  }
  if (lod === 0) for (let k = 0; k < 5; k++) {
    const a = rng() * 6.28, d = Math.sqrt(rng()) * R * 0.6;
    const base: V = [Math.cos(a) * d, H, Math.sin(a) * d * 0.8];
    b.tube([base, vec.add(base, [0, 5 + rng() * 6, 0])], [1.2, 0.8], 5, P.ochre);
    b.blob(vec.add(base, [0, 9, 0]), [4, 1.4, 4], 0, P.orange, { seed: k + 9 });
  }
}

function butte(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const H = 50, R = 55;
  const paint = band(P.sandstone, P.sandstoneDark, 2.2, variant);
  const s = sides(lod, 13, 9, 6);
  b.prism([0, -2, 0], R, s, [{ y: 0, s: 1.25 }, ...strata(H * 0.12, H * (lod === 2 ? 0.95 : 0.62), 1.02, 0.9, lod, variant)], paint, { jitter: 0.25, seed: variant * 5 + 1, stretch: [1, 0.65] });
  if (lod !== 2) b.prism([R * 0.12, H * 0.6, 0], R * 0.55, s, strata(0, H * 0.38, 1, 0.85, lod, variant + 7), paint, { jitter: 0.3, seed: variant * 5 + 2, stretch: [1, 0.6] });
  if (lod === 0) for (let k = 0; k < 3; k++) {
    const a = rng() * 6.28;
    b.prism([R * 0.12 + Math.cos(a) * R * 0.2, H * 0.95, Math.sin(a) * R * 0.15], 4 + rng() * 3, 5, [{ y: 0, s: 1 }, { y: 8 + rng() * 10, s: 0.45 }], paint);
  }
}

function rockNeedle(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const n = lod === 2 ? 1 : lod === 1 ? 3 : 5;
  const paint = (p: V, nn: V): C => mixC(mixC(P.slateDark, P.slate, 0.3 + 0.5 * Math.max(0, nn[1]) + 0.2 * Math.sin(p[1] * 0.4)), P.pale, Math.max(0, nn[1] - 0.6));
  for (let k = 0; k < n; k++) {
    const a = rng() * 6.28, d = k === 0 ? 0 : 3 + rng() * 4;
    const h = k === 0 ? 45 : 18 + rng() * 22, r = k === 0 ? 7 : 3 + rng() * 2.5;
    b.prism([Math.cos(a) * d, -2, Math.sin(a) * d], r, sides(lod, 6, 5, 4), [{ y: 0, s: 1 }, { y: h * 0.6, s: 0.7 }, { y: h * 0.9, s: 0.35 }, { y: h, s: 0.05 }], paint, { jitter: 0.3, seed: variant * 9 + k, yaw: rng() * 3 });
  }
}

function seaStack(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const H = 80, R = 22;
  const paint = (p: V, n: V): C => n[1] > 0.75 && p[1] > H * 0.9 ? mixC(P.moss, P.orange, hash3(p, 2) * 0.5) : band(P.sandstone, P.slateDark, 3.1, variant)(p);
  const lv = [{ y: -3, s: 1.2 }, ...strata(H * 0.1, H, 1, 0.8, lod, variant + 3)];
  b.prism([0, 0, 0], R, sides(lod, 9, 7, 5), lv, paint, { jitter: 0.28, seed: variant * 3 + 1, stretch: [1, 0.75] });
  if (lod === 0) {
    b.blob([0, H, 0], [R * 0.75, 3, R * 0.6], 0, (p) => mixC(P.moss, P.orange, hash3(p, 4) * 0.6), { seed: 5, cut: -0.1 });
    for (let k = 0; k < 4; k++) b.blob([(rng() - 0.5) * R * 2.4, 0, (rng() - 0.5) * R * 2], [4, 3, 3.5], 0, P.slateDark, { jitter: 0.3, seed: k });
  }
}

function seaArch(b: MeshBuilder, _rng: () => number, lod: Lod, _variant: number) {
  const H = 60, paint = band(P.sandstone, P.slateDark, 2.6);
  const s = sides(lod, 7, 6, 4);
  b.prism([-28, 0, 0], 11, s, [{ y: -3, s: 1.1 }, { y: H * 0.7, s: 0.9 }, { y: H, s: 1 }], paint, { jitter: 0.25, seed: 1 });
  b.prism([28, 0, 0], 10, s, [{ y: -3, s: 1.1 }, { y: H * 0.6, s: 0.85 }, { y: H * 0.85, s: 0.95 }], paint, { jitter: 0.25, seed: 2 });
  const arc = curve([[-28, H * 0.82, 0], [-12, H * 0.95, 0], [12, H * 0.92, 0], [28, H * 0.75, 0]], lod === 0 ? 8 : 3);
  b.tube(arc, arc.map(() => 9), s, paint, { flat: true });
}

function ruinTower(b: MeshBuilder, rng: () => number, lod: Lod, variant: number) {
  const H = 30, R = 6;
  const panels = lod === 2 ? 4 : lod === 1 ? 6 : 10;
  const paint = (p: V, n: V): C => mixC(mixC(scaleC(P.masonry, 0.68), P.masonry, 0.5 + 0.5 * Math.max(0, n[1]) + 0.15 * hash3([Math.floor(p[1] / 1.5), Math.floor(p[0]), 0], variant)), P.moss, p[1] < 3 || n[1] > 0.8 ? 0.35 : 0);
  const broken = rng() * 6.28;
  for (let k = 0; k < panels; k++) {
    const a = (k + 0.5) / panels * Math.PI * 2;
    const gap = Math.abs(Math.atan2(Math.sin(a - broken), Math.cos(a - broken)));
    const h = H * (0.3 + 0.7 * Math.min(1, gap / 1.6)) * (0.88 + rng() * 0.2);
    const w = 2 * Math.PI * R / panels;
    b.box([Math.cos(a) * R, h / 2 - 1, Math.sin(a) * R], [w * 1.05, h, 1.6], paint, { yaw: -a + Math.PI / 2, jitter: 0.05, seed: k });
    if (lod === 0 && h > 14) b.box([Math.cos(a) * (R + 0.8), h * 0.6, Math.sin(a) * (R + 0.8)], [0.6, 2.2, 0.4], P.dark, { yaw: -a + Math.PI / 2 });
  }
  if (lod === 0) for (let k = 0; k < 8; k++) {
    const a = broken + (rng() - 0.5) * 1.5, d = R + 1 + rng() * 6;
    b.box([Math.cos(a) * d, 0.5, Math.sin(a) * d], [1.5 + rng(), 1 + rng(), 1.5 + rng()], paint, { yaw: rng() * 3, jitter: 0.3, seed: k + 20 });
  }
}

const BUILD: Record<Kind, (b: MeshBuilder, rng: () => number, lod: Lod, variant: number) => void> = {
  'coral-clump': coralClump,
  tussock,
  stone: (b, r, l, v) => stone(b, r, l, v),
  slab,
  bone,
  post,
  'coral-tree': coralTree,
  'fan-coral': fanCoral,
  'brain-mound': brainMound,
  'coral-wall': coralWall,
  wreck,
  boulder,
  'tube-sponge': tubeSponge,
  ribs,
  'dead-trunk': deadTrunk,
  'reed-bed': reedBed,
  tor,
  'spiral-shell': spiralShell,
  'coral-skeleton': coralSkeleton,
  skull,
  'fallen-block': fallenBlock,
  'ruin-wall': ruinWall,
  'horn-spire': hornSpire,
  'leaning-tower': leaningTower,
  'coral-plateau': coralPlateau,
  butte,
  'rock-needle': rockNeedle,
  'sea-stack': seaStack,
  'sea-arch': seaArch,
  'ruin-tower': ruinTower,
};

const FLAT_KINDS = new Set<Kind>(['slab', 'reed-bed', 'bone']);

export function buildKind(kind: Kind, variant: number, lod: Lod): THREE.BufferGeometry {
  const b = new MeshBuilder();
  BUILD[kind](b, mulberry32(hashString(`${kind}:${variant}`)), lod, variant);
  return b.geometry({ ao: FLAT_KINDS.has(kind) ? 0 : 0.45 });
}

