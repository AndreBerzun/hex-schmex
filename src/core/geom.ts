// Geometry helpers: polyline distance, region signed distance, bounding boxes. All in km.

import type { Region, Vec2 } from './types';

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function bboxOfPoints(pts: Vec2[], pad = 0): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export function regionBBox(r: Region, pad = 0): BBox | null {
  switch (r.kind) {
    case 'circle':
      return { minX: r.center[0] - r.radius - pad, minY: r.center[1] - r.radius - pad, maxX: r.center[0] + r.radius + pad, maxY: r.center[1] + r.radius + pad };
    case 'polygon':
      return bboxOfPoints(r.points, pad);
    case 'rect':
      return { minX: Math.min(r.min[0], r.max[0]) - pad, minY: Math.min(r.min[1], r.max[1]) - pad, maxX: Math.max(r.min[0], r.max[0]) + pad, maxY: Math.max(r.min[1], r.max[1]) + pad };
    case 'union': {
      let b: BBox | null = null;
      for (const p of r.parts) {
        const pb = regionBBox(p, pad);
        if (!pb) return null;
        b = b ? { minX: Math.min(b.minX, pb.minX), minY: Math.min(b.minY, pb.minY), maxX: Math.max(b.maxX, pb.maxX), maxY: Math.max(b.maxY, pb.maxY) } : pb;
      }
      return b;
    }
    case 'all':
      return null;
  }
}

function polygonSdf(pts: Vec2[], x: number, y: number): number {
  // Inigo Quilez's polygon SDF. Negative inside.
  const n = pts.length;
  let d = (x - pts[0][0]) ** 2 + (y - pts[0][1]) ** 2;
  let s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const ex = pts[j][0] - pts[i][0], ey = pts[j][1] - pts[i][1];
    const wx = x - pts[i][0], wy = y - pts[i][1];
    const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey || 1), 0, 1);
    const bx = wx - ex * t, by = wy - ey * t;
    d = Math.min(d, bx * bx + by * by);
    const c1 = y >= pts[i][1], c2 = y < pts[j][1], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

/** Signed distance to a region in km; negative inside. */
export function regionSdf(r: Region, x: number, y: number): number {
  switch (r.kind) {
    case 'circle':
      return Math.hypot(x - r.center[0], y - r.center[1]) - r.radius;
    case 'polygon':
      return r.points.length >= 3 ? polygonSdf(r.points, x, y) : Infinity;
    case 'rect': {
      const cx = (r.min[0] + r.max[0]) / 2, cy = (r.min[1] + r.max[1]) / 2;
      const hx = Math.abs(r.max[0] - r.min[0]) / 2, hy = Math.abs(r.max[1] - r.min[1]) / 2;
      const dx = Math.abs(x - cx) - hx, dy = Math.abs(y - cy) - hy;
      return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
    }
    case 'union': {
      let d = Infinity;
      for (const p of r.parts) d = Math.min(d, regionSdf(p, x, y));
      return d;
    }
    case 'all':
      return -1e9;
  }
}

/** Mask 1 inside, smoothly falling to 0 over `falloff` km outside the region. */
export function regionMask(r: Region, x: number, y: number, falloff: number): number {
  const d = regionSdf(r, x, y);
  if (d <= 0) return 1;
  if (falloff <= 0) return 0;
  return 1 - smoothstep(0, falloff, d);
}

export interface PolylineInfo {
  pts: Vec2[];
  /** cumulative length at each vertex */
  cum: number[];
  length: number;
  /** per-segment bbox [minX, minY, maxX, maxY] for culling */
  segBox: Float64Array;
}

export function polylineInfo(pts: Vec2[]): PolylineInfo {
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const segBox = new Float64Array(Math.max(0, pts.length - 1) * 4);
  for (let i = 0; i < pts.length - 1; i++) {
    segBox[i * 4] = Math.min(pts[i][0], pts[i + 1][0]);
    segBox[i * 4 + 1] = Math.min(pts[i][1], pts[i + 1][1]);
    segBox[i * 4 + 2] = Math.max(pts[i][0], pts[i + 1][0]);
    segBox[i * 4 + 3] = Math.max(pts[i][1], pts[i + 1][1]);
  }
  return { pts, cum, length: cum[cum.length - 1], segBox };
}

export interface PolylineHit {
  /** unsigned distance, km */
  d: number;
  /** arc length position of the closest point, km */
  s: number;
  /** +1 if the point is on the right of the line (direction of travel), -1 left */
  side: number;
}

/**
 * Closest point on a polyline. Coordinates use +y south, so "right" of a line heading east is south.
 * Segments farther than `maxDist` (by bbox) are skipped; if all are, d = Infinity.
 */
export function polylineClosest(info: PolylineInfo, x: number, y: number, out: PolylineHit, maxDist = Infinity): PolylineHit {
  const p = info.pts;
  const sb = info.segBox;
  let best = maxDist === Infinity ? Infinity : maxDist * maxDist, bestS = 0, bestSide = 1, found = false;
  if (p.length === 1) {
    out.d = Math.hypot(x - p[0][0], y - p[0][1]);
    out.s = 0; out.side = 1;
    return out;
  }
  for (let i = 0; i < p.length - 1; i++) {
    const b4 = i * 4;
    if (x < sb[b4] - maxDist || x > sb[b4 + 2] + maxDist || y < sb[b4 + 1] - maxDist || y > sb[b4 + 3] + maxDist) continue;
    const ax = p[i][0], ay = p[i][1];
    const ex = p[i + 1][0] - ax, ey = p[i + 1][1] - ay;
    const len2 = ex * ex + ey * ey || 1e-9;
    const wx = x - ax, wy = y - ay;
    const t = clamp((wx * ex + wy * ey) / len2, 0, 1);
    const dx = wx - ex * t, dy = wy - ey * t;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) {
      found = true;
      best = d2;
      bestS = info.cum[i] + t * Math.sqrt(len2);
      // cross > 0 => point is to the right in a y-down frame
      bestSide = ex * wy - ey * wx >= 0 ? 1 : -1;
    }
  }
  out.d = found ? Math.sqrt(best) : Infinity;
  out.s = bestS;
  out.side = bestSide;
  return out;
}

/** Point at arc length s along the polyline. */
export function polylineAt(info: PolylineInfo, s: number): Vec2 {
  const p = info.pts;
  if (p.length === 1 || s <= 0) return [p[0][0], p[0][1]];
  for (let i = 0; i < p.length - 1; i++) {
    if (s <= info.cum[i + 1]) {
      const seg = info.cum[i + 1] - info.cum[i] || 1e-9;
      const t = (s - info.cum[i]) / seg;
      return [lerp(p[i][0], p[i + 1][0], t), lerp(p[i][1], p[i + 1][1], t)];
    }
  }
  const last = p[p.length - 1];
  return [last[0], last[1]];
}

/** Catmull-Rom resample so hand-placed polylines become natural curves. */
export function smoothPolyline(pts: Vec2[], stepKm: number): Vec2[] {
  if (pts.length < 3) return pts.map((p) => [p[0], p[1]] as Vec2);
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(segLen / stepKm));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  const last = pts[pts.length - 1];
  out.push([last[0], last[1]]);
  return out;
}
