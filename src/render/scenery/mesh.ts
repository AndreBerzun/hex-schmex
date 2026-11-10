import * as THREE from 'three';

export type V = [number, number, number];
export type C = [number, number, number];
export type Paint = C | ((p: V, n: V, t: number) => C);

const lin = (c: C): C => [c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2];
export const mixC = (a: C, b: C, t: number): C => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scaleC = (a: C, k: number): C => [a[0] * k, a[1] * k, a[2] * k];

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V): V => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const vec = { sub, add, mul, cross, dot, norm };

export function hash3(p: V, seed: number): number {
  const s = Math.sin(p[0] * 127.1 + p[1] * 311.7 + p[2] * 74.7 + seed * 19.19) * 43758.5453;
  return s - Math.floor(s);
}

export function rotY(p: V, a: number): V {
  const c = Math.cos(a), s = Math.sin(a);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

const ICO: Record<number, Float32Array> = {};
function icosphere(detail: number): Float32Array {
  if (!ICO[detail]) {
    const g = detail < 0 ? new THREE.OctahedronGeometry(1, 0) : new THREE.IcosahedronGeometry(1, detail);
    ICO[detail] = (g.toNonIndexed().getAttribute('position').array as Float32Array).slice();
    g.dispose();
  }
  return ICO[detail];
}

export class MeshBuilder {
  private p: number[] = [];
  private n: number[] = [];
  private c: number[] = [];

  get triangles() { return this.p.length / 9; }

  private paint(paint: Paint, p: V, n: V, t: number): C {
    return lin(typeof paint === 'function' ? paint(p, n, t) : paint);
  }

  tri(a: V, b: V, c: V, paint: Paint, na?: V, nb?: V, nc?: V) {
    const fn = norm(cross(sub(b, a), sub(c, a)));
    for (const [v, nv] of [[a, na ?? fn], [b, nb ?? fn], [c, nc ?? fn]] as [V, V][]) {
      this.p.push(...v); this.n.push(...nv); this.c.push(...this.paint(paint, v, nv, 0));
    }
  }

  quad(a: V, b: V, c: V, d: V, paint: Paint) { this.tri(a, b, c, paint); this.tri(a, c, d, paint); }

  sheet(pts: V[], paint: Paint) {
    for (let i = 1; i + 1 < pts.length; i++) { this.tri(pts[0], pts[i], pts[i + 1], paint); this.tri(pts[0], pts[i + 1], pts[i], paint); }
  }

  tube(path: V[], radii: number[], sides: number, paint: Paint, opts: { capStart?: boolean; capEnd?: boolean; flat?: boolean; jitter?: number; seed?: number; squash?: number } = {}) {
    if (path.length < 2) return;
    const rings: V[][] = [], normals: V[][] = [];
    let ref: V = Math.abs(norm(sub(path[1], path[0]))[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    for (let i = 0; i < path.length; i++) {
      const t = norm(sub(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)]));
      const u = norm(cross(ref, t)), w = cross(t, u);
      ref = w;
      const ring: V[] = [], nr: V[] = [];
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const dir = add(mul(u, Math.cos(a)), mul(w, Math.sin(a) * (opts.squash ?? 1)));
        let r = radii[i];
        if (opts.jitter) r *= 1 + (hash3([i, k, 0], opts.seed ?? 0) - 0.5) * 2 * opts.jitter;
        ring.push(add(path[i], mul(dir, r)));
        nr.push(norm(dir));
      }
      rings.push(ring); normals.push(nr);
    }
    const L = path.length - 1;
    for (let i = 0; i < L; i++) for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      const a = rings[i][k], b = rings[i][k2], c = rings[i + 1][k2], d = rings[i + 1][k];
      const ta = i / L, tb = (i + 1) / L;
      if (opts.flat) { this.quad(a, b, c, d, (p, n) => this.raw(paint, p, n, (ta + tb) / 2)); continue; }
      this.vtx(a, normals[i][k], paint, ta); this.vtx(c, normals[i + 1][k2], paint, tb); this.vtx(d, normals[i + 1][k], paint, tb);
      this.vtx(a, normals[i][k], paint, ta); this.vtx(b, normals[i][k2], paint, ta); this.vtx(c, normals[i + 1][k2], paint, tb);
    }
    if (opts.capStart && radii[0] > 0) for (let k = 0; k < sides; k++) this.tri(path[0], rings[0][(k + 1) % sides], rings[0][k], (p, n) => this.raw(paint, p, n, 0));
    if (opts.capEnd && radii[L] > 0) for (let k = 0; k < sides; k++) this.tri(path[L], rings[L][k], rings[L][(k + 1) % sides], (p, n) => this.raw(paint, p, n, 1));
  }

  private raw(paint: Paint, p: V, n: V, t: number): C { return typeof paint === 'function' ? paint(p, n, t) : paint; }

  private vtx(v: V, nv: V, paint: Paint, t: number) {
    this.p.push(...v); this.n.push(...nv); this.c.push(...this.paint(paint, v, nv, t));
  }

  blob(center: V, r: V, detail: number, paint: Paint, opts: { jitter?: number; seed?: number; yaw?: number; flat?: boolean; cut?: number } = {}) {
    const src = icosphere(detail);
    const seed = opts.seed ?? 0, j = opts.jitter ?? 0;
    const pts: V[] = [];
    for (let i = 0; i < src.length; i += 3) {
      const u: V = [src[i], src[i + 1], src[i + 2]];
      const k = 1 + (hash3(mul(u, 7.3), seed) - 0.5) * 2 * j;
      let p: V = [u[0] * r[0] * k, Math.max(u[1], opts.cut ?? -2) * r[1] * k, u[2] * r[2] * k];
      if (opts.yaw) p = rotY(p, opts.yaw);
      pts.push(add(center, p));
    }
    for (let i = 0; i < pts.length; i += 3) {
      const a = pts[i], b = pts[i + 1], c = pts[i + 2];
      if (opts.flat === false) {
        const ns = [0, 1, 2].map((q) => norm(sub(pts[i + q], center)));
        this.vtx(a, ns[0], paint, 0); this.vtx(b, ns[1], paint, 0); this.vtx(c, ns[2], paint, 0);
      } else this.tri(a, b, c, (p, n) => this.raw(paint, p, n, 0));
    }
  }

  prism(center: V, radius: number, sides: number, levels: { y: number; s: number }[], paint: Paint, opts: { jitter?: number; seed?: number; yaw?: number; capTop?: boolean; stretch?: [number, number] } = {}) {
    const seed = opts.seed ?? 0;
    const base: [number, number][] = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2 + (opts.yaw ?? 0);
      const r = radius * (1 + (hash3([k, 1.3, 0], seed) - 0.5) * 2 * (opts.jitter ?? 0));
      base.push([Math.cos(a) * r * (opts.stretch?.[0] ?? 1), Math.sin(a) * r * (opts.stretch?.[1] ?? 1)]);
    }
    const ring = (l: { y: number; s: number }, li: number): V[] => base.map(([x, z], k) => {
      const w = 1 + (hash3([k, li, 2.1], seed) - 0.5) * (opts.jitter ?? 0) * 0.6;
      return [center[0] + x * l.s * w, center[1] + l.y, center[2] + z * l.s * w];
    });
    const rings = levels.map(ring);
    for (let i = 0; i + 1 < rings.length; i++) for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      const t = (levels[i].y + levels[i + 1].y) / 2;
      this.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2], (p, n) => this.raw(paint, p, n, t));
    }
    if (opts.capTop !== false) {
      const top = rings[rings.length - 1];
      const c: V = [center[0], center[1] + levels[levels.length - 1].y, center[2]];
      for (let k = 0; k < sides; k++) this.tri(c, top[(k + 1) % sides], top[k], (p, n) => this.raw(paint, p, n, 1));
    }
  }

  box(center: V, size: V, paint: Paint, opts: { yaw?: number; jitter?: number; seed?: number; tiltX?: number; tiltZ?: number } = {}) {
    const j = opts.jitter ?? 0, seed = opts.seed ?? 0;
    const corner = (sx: number, sy: number, sz: number): V => {
      let p: V = [sx * size[0] / 2, sy * size[1] / 2, sz * size[2] / 2];
      if (j) p = add(p, mul([hash3([sx, sy, sz], seed) - 0.5, hash3([sy, sz, sx], seed + 1) - 0.5, hash3([sz, sx, sy], seed + 2) - 0.5], j * Math.min(size[0], size[1], size[2])));
      if (opts.tiltX) { const c = Math.cos(opts.tiltX), s = Math.sin(opts.tiltX); p = [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; }
      if (opts.tiltZ) { const c = Math.cos(opts.tiltZ), s = Math.sin(opts.tiltZ); p = [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; }
      if (opts.yaw) p = rotY(p, opts.yaw);
      return add(center, p);
    };
    const v = [corner(-1, -1, -1), corner(1, -1, -1), corner(1, 1, -1), corner(-1, 1, -1), corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1)];
    const f = (a: number, b: number, c: number, d: number) => this.quad(v[a], v[b], v[c], v[d], (p, n) => this.raw(paint, p, n, 0));
    f(0, 3, 2, 1); f(4, 5, 6, 7); f(0, 4, 7, 3); f(1, 2, 6, 5); f(3, 7, 6, 2); f(0, 1, 5, 4);
  }

  geometry(opts: { ao?: number; aoHeight?: number } = {}): THREE.BufferGeometry {
    const pos = new Float32Array(this.p), nor = new Float32Array(this.n), col = new Float32Array(this.c);
    if (opts.ao) {
      let top = 0;
      for (let i = 1; i < pos.length; i += 3) top = Math.max(top, pos[i]);
      const hgt = opts.aoHeight ?? top * 0.4;
      for (let i = 0; i < pos.length; i += 3) {
        const t = Math.max(0, Math.min(1, pos[i + 1] / Math.max(hgt, 1e-3)));
        const k = 1 - opts.ao * (1 - t * t * (3 - 2 * t));
        col[i] *= k; col[i + 1] *= k; col[i + 2] *= k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

export function curve(points: V[], segments: number): V[] {
  const out: V[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * (points.length - 1);
    const k = Math.min(points.length - 2, Math.floor(t)), f = t - k;
    const p0 = points[Math.max(0, k - 1)], p1 = points[k], p2 = points[k + 1], p3 = points[Math.min(points.length - 1, k + 2)];
    const c = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * f + (2 * a - 5 * b + 4 * cc - d) * f * f + (-a + 3 * b - 3 * cc + d) * f * f * f);
    out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1]), c(p0[2], p1[2], p2[2], p3[2])]);
  }
  return out;
}
