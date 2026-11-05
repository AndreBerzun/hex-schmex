// Hex grid maths. Ids are 1-based "CCRR" (0101 = top-left).
// Flat-top: even columns (1-based) are shifted down half a hex ("odd-q" in 0-based terms).
// Pointy-top: even rows (1-based) are shifted right half a hex ("odd-r" in 0-based terms).

import type { Vec2, World } from './types';

export const KM_PER_MILE = 1.609344;

export interface HexGrid {
  cols: number;
  rows: number;
  orientation: 'flat' | 'pointy';
  /** flat-to-flat distance, km */
  flat: number;
  /** centre-to-vertex distance, km */
  size: number;
  /** margin around the grid, km */
  margin: number;
  /** world extent, km */
  widthKm: number;
  heightKm: number;
  /** origin of hex 0101's centre, km */
  origin: Vec2;
}

export function makeGrid(g: World['grid']): HexGrid {
  const flat = g.hexMiles * KM_PER_MILE;
  const size = flat / Math.sqrt(3);
  const margin = flat / 2;
  let gw: number, gh: number, origin: Vec2;
  if (g.orientation === 'flat') {
    const w = 2 * size;
    gw = (g.cols - 1) * 0.75 * w + w;
    gh = g.rows * flat + (g.cols > 1 ? flat / 2 : 0);
    origin = [margin + size, margin + flat / 2];
  } else {
    const h = 2 * size;
    gw = g.cols * flat + (g.rows > 1 ? flat / 2 : 0);
    gh = (g.rows - 1) * 0.75 * h + h;
    origin = [margin + flat / 2, margin + size];
  }
  return {
    cols: g.cols, rows: g.rows, orientation: g.orientation, flat, size, margin,
    widthKm: gw + 2 * margin, heightKm: gh + 2 * margin, origin,
  };
}

export function hexId(col: number, row: number): string {
  return String(col).padStart(2, '0') + String(row).padStart(2, '0');
}

/** Parse "0507" -> {col:5,row:7}. Accepts 4 digits or "c,r" style "5,7". */
export function parseHexId(id: string): { col: number; row: number } | null {
  const s = id.trim();
  let m = /^(\d{2})(\d{2})$/.exec(s);
  if (m) return { col: +m[1], row: +m[2] };
  m = /^(\d{1,3})[,.:\s-](\d{1,3})$/.exec(s);
  if (m) return { col: +m[1], row: +m[2] };
  return null;
}

export function inGrid(grid: HexGrid, col: number, row: number): boolean {
  return col >= 1 && row >= 1 && col <= grid.cols && row <= grid.rows;
}

/** Centre of a hex in world km. */
export function hexCenter(grid: HexGrid, col: number, row: number): Vec2 {
  const c = col - 1, r = row - 1;
  if (grid.orientation === 'flat') {
    const x = grid.origin[0] + c * 1.5 * grid.size;
    const y = grid.origin[1] + r * grid.flat + ((c & 1) ? grid.flat / 2 : 0);
    return [x, y];
  }
  const x = grid.origin[0] + c * grid.flat + ((r & 1) ? grid.flat / 2 : 0);
  const y = grid.origin[1] + r * 1.5 * grid.size;
  return [x, y];
}

export function hexCenterById(grid: HexGrid, id: string): Vec2 | null {
  const p = parseHexId(id);
  return p ? hexCenter(grid, p.col, p.row) : null;
}

function cubeRound(q: number, r: number): [number, number] {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
}

const odd = (n: number) => ((n % 2) + 2) % 2;

/** World km -> 1-based col/row (may be outside the grid). */
export function pointToHex(grid: HexGrid, p: Vec2): { col: number; row: number } {
  const px = p[0] - grid.origin[0];
  const py = p[1] - grid.origin[1];
  const s = grid.size;
  if (grid.orientation === 'flat') {
    const q = ((2 / 3) * px) / s;
    const r = ((-1 / 3) * px + (Math.sqrt(3) / 3) * py) / s;
    const [aq, ar] = cubeRound(q, r);
    const col = aq;
    const row = ar + (aq - odd(aq)) / 2;
    return { col: col + 1, row: row + 1 };
  }
  const q = ((Math.sqrt(3) / 3) * px - (1 / 3) * py) / s;
  const r = ((2 / 3) * py) / s;
  const [aq, ar] = cubeRound(q, r);
  const col = aq + (ar - odd(ar)) / 2;
  return { col: col + 1, row: ar + 1 };
}

/** Hex polygon (6 vertices) in world km. */
export function hexPolygon(grid: HexGrid, col: number, row: number, scale = 1): Vec2[] {
  const [cx, cy] = hexCenter(grid, col, row);
  const start = grid.orientation === 'flat' ? 0 : 30;
  const pts: Vec2[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((start + 60 * i) * Math.PI) / 180;
    pts.push([cx + Math.cos(a) * grid.size * scale, cy + Math.sin(a) * grid.size * scale]);
  }
  return pts;
}

export function allHexes(grid: HexGrid): { col: number; row: number; id: string }[] {
  const out = [];
  for (let r = 1; r <= grid.rows; r++)
    for (let c = 1; c <= grid.cols; c++) out.push({ col: c, row: r, id: hexId(c, r) });
  return out;
}

/** Neighbouring hexes within `radius` steps (including the centre). */
export function hexRing(grid: HexGrid, col: number, row: number, radius: number): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = [];
  const [cx, cy] = hexCenter(grid, col, row);
  const reach = (radius + 0.5) * grid.flat;
  for (let r = 1; r <= grid.rows; r++)
    for (let c = 1; c <= grid.cols; c++) {
      const [x, y] = hexCenter(grid, c, r);
      if (Math.hypot(x - cx, y - cy) <= reach) out.push({ col: c, row: r });
    }
  return out;
}

/** Heightmap dimensions for a given resolution (longer side = res, square pixels). */
export function mapDims(grid: HexGrid, res: number): { nx: number; ny: number; kmPerPx: number } {
  const long = Math.max(grid.widthKm, grid.heightKm);
  const kmPerPx = long / res;
  return {
    nx: Math.max(2, Math.round(grid.widthKm / kmPerPx)),
    ny: Math.max(2, Math.round(grid.heightKm / kmPerPx)),
    kmPerPx,
  };
}

/** km -> continuous pixel coordinate (pixel centres at i+0.5). */
export function kmToPx(kmPerPx: number, p: Vec2): Vec2 {
  return [p[0] / kmPerPx, p[1] / kmPerPx];
}
export function pxToKm(kmPerPx: number, p: Vec2): Vec2 {
  return [p[0] * kmPerPx, p[1] * kmPerPx];
}
