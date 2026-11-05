// Resolve human/LLM position expressions into world km.
//
// Points:   "0405" (hex centre) | "0405:NE" (toward that hex's NE edge) | "N" "NE" ... "center" (map positions)
//           | [x, y] km | {x, y} km | {u, v} normalised 0..1 | {hex: "0405", dx, dy} (offset in hexes)
// Regions:  {hexes: [...]} | {hex, radius} (radius in hex steps) | {center, radiusKm} | {polygon: [...]}
//           | {rect: [p, p]} | {side: "N", fraction} | "all"

import { hexCenter, hexPolygon, hexRing, makeGrid, parseHexId, type HexGrid } from './hex';
import type { Region, Side, Vec2, World } from './types';

export type PointExpr = string | Vec2 | { x: number; y: number } | { u: number; v: number } | { hex: string; dx?: number; dy?: number };

const COMPASS: Record<string, Vec2> = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
  NE: [Math.SQRT1_2, -Math.SQRT1_2], NW: [-Math.SQRT1_2, -Math.SQRT1_2],
  SE: [Math.SQRT1_2, Math.SQRT1_2], SW: [-Math.SQRT1_2, Math.SQRT1_2],
};

export class ResolveError extends Error {}

export function isSide(s: unknown): s is Side {
  return typeof s === 'string' && ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'].includes(s.toUpperCase());
}

export class Resolver {
  readonly grid: HexGrid;
  constructor(world: World) {
    this.grid = makeGrid(world.grid);
  }

  point(e: PointExpr): Vec2 {
    const g = this.grid;
    if (Array.isArray(e)) {
      if (e.length !== 2 || !Number.isFinite(e[0]) || !Number.isFinite(e[1])) throw new ResolveError(`bad point ${JSON.stringify(e)}`);
      return [e[0], e[1]];
    }
    if (typeof e === 'string') {
      const s = e.trim();
      const up = s.toUpperCase();
      if (up === 'CENTER' || up === 'CENTRE' || up === 'C') return [g.widthKm / 2, g.heightKm / 2];
      if (COMPASS[up]) {
        const d = COMPASS[up];
        // a point 12% in from the map edge in that direction
        return [g.widthKm / 2 + d[0] * g.widthKm * 0.38 * (Math.abs(d[0]) > 0.9 ? 1 : 1.2), g.heightKm / 2 + d[1] * g.heightKm * 0.38 * (Math.abs(d[1]) > 0.9 ? 1 : 1.2)];
      }
      const [hexPart, dirPart] = s.split(':');
      const h = parseHexId(hexPart);
      if (!h) throw new ResolveError(`not a hex id or direction: "${e}"`);
      this.checkNear(h, hexPart);
      const c = hexCenter(g, h.col, h.row);
      if (dirPart) {
        const d = COMPASS[dirPart.trim().toUpperCase()];
        if (!d) throw new ResolveError(`bad direction in "${e}"`);
        return [c[0] + d[0] * g.flat * 0.45, c[1] + d[1] * g.flat * 0.45];
      }
      return c;
    }
    if (typeof e === 'object' && e) {
      if ('hex' in e) {
        const h = parseHexId(e.hex);
        if (!h) throw new ResolveError(`bad hex "${e.hex}"`);
        this.checkNear(h, e.hex);
        const c = hexCenter(g, h.col, h.row);
        return [c[0] + (e.dx ?? 0) * g.flat, c[1] + (e.dy ?? 0) * g.flat];
      }
      if ('u' in e) return [e.u * g.widthKm, e.v * g.heightKm];
      if ('x' in e) return [e.x, e.y];
    }
    throw new ResolveError(`cannot resolve point ${JSON.stringify(e)}`);
  }

  /** Hex ids may point a little past the grid (river mouths, coasts) but not far off the map. */
  private checkNear(h: { col: number; row: number }, id: string) {
    const g = this.grid;
    if (h.col < 0 || h.row < 0 || h.col > g.cols + 1 || h.row > g.rows + 1) throw new ResolveError(`hex "${id}" is outside the ${g.cols}x${g.rows} grid`);
  }

  points(list: unknown): Vec2[] {
    if (!Array.isArray(list)) throw new ResolveError('expected a list of points');
    // a bare [x, y] numeric pair is a single point, not a list
    if (list.length === 2 && typeof list[0] === 'number') return [this.point(list as Vec2)];
    return list.map((p) => this.point(p as PointExpr));
  }

  region(e: unknown): Region {
    const g = this.grid;
    if (e === 'all' || e === undefined || e === null) return { kind: 'all' };
    if (typeof e === 'string') {
      if (parseHexId(e)) return this.region({ hexes: [e] });
      if (isSide(e)) return this.region({ side: e });
      throw new ResolveError(`cannot resolve region "${e}"`);
    }
    if (Array.isArray(e)) {
      if (e.every((x) => typeof x === 'string' && parseHexId(x))) return this.region({ hexes: e });
      return { kind: 'polygon', points: this.points(e) };
    }
    const o = e as Record<string, unknown>;
    if (o.kind && typeof o.kind === 'string') return o as unknown as Region; // already resolved
    if (Array.isArray(o.hexes)) {
      const parts: Region[] = (o.hexes as string[]).map((id) => {
        const h = parseHexId(id);
        if (!h) throw new ResolveError(`bad hex "${id}"`);
        return { kind: 'polygon', points: hexPolygon(g, h.col, h.row) };
      });
      return parts.length === 1 ? parts[0] : { kind: 'union', parts };
    }
    if (typeof o.hex === 'string') {
      const h = parseHexId(o.hex);
      if (!h) throw new ResolveError(`bad hex "${o.hex}"`);
      const r = Number(o.radius ?? 0);
      if (r <= 0) return { kind: 'polygon', points: hexPolygon(g, h.col, h.row) };
      // A hex-ring area is closer to a circle than a union of hexes, and much cheaper to evaluate.
      return { kind: 'circle', center: hexCenter(g, h.col, h.row), radius: (r + 0.5) * g.flat };
    }
    if (Array.isArray(o.polygon)) return { kind: 'polygon', points: this.points(o.polygon) };
    if (Array.isArray(o.rect)) {
      const [a, b] = this.points(o.rect);
      return { kind: 'rect', min: a, max: b };
    }
    if (o.center !== undefined) {
      const r = Number(o.radiusKm ?? (o.radiusHexes !== undefined ? Number(o.radiusHexes) * g.flat : o.radius ?? 10));
      return { kind: 'circle', center: this.point(o.center as PointExpr), radius: r };
    }
    if (isSide(o.side)) {
      const f = Number(o.fraction ?? 0.3);
      const W = g.widthKm, H = g.heightKm;
      const s = (o.side as string).toUpperCase();
      const rects: Record<string, [Vec2, Vec2]> = {
        N: [[0, 0], [W, H * f]], S: [[0, H * (1 - f)], [W, H]], W: [[0, 0], [W * f, H]], E: [[W * (1 - f), 0], [W, H]],
        NW: [[0, 0], [W * f, H * f]], NE: [[W * (1 - f), 0], [W, H * f]], SW: [[0, H * (1 - f)], [W * f, H]], SE: [[W * (1 - f), H * (1 - f)], [W, H]],
      };
      const [a, b] = rects[s];
      return { kind: 'rect', min: a, max: b };
    }
    throw new ResolveError(`cannot resolve region ${JSON.stringify(e)}`);
  }

  hexesInRing(id: string, radius: number) {
    const h = parseHexId(id);
    if (!h) return [];
    return hexRing(this.grid, h.col, h.row, radius);
  }
}
