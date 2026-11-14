import type { Rect } from './field';

export type Rgb = [number, number, number];

export function medianColour(rgba: ArrayLike<number>): Rgb {
  const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const pixels = Math.floor(rgba.length / 4);
  for (let p = 0; p < pixels; p++) for (let c = 0; c < 3; c++) bins[c][rgba[p * 4 + c]]++;
  const half = pixels / 2;
  return bins.map((bin) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += bin[v];
      if (seen >= half) return v;
    }
    return 255;
  }) as Rgb;
}

export function paintDisc(cells: Uint8Array, nx: number, ny: number, kmPerPx: number, x: number, y: number, radiusKm: number, value: number): Rect {
  const r = radiusKm / kmPerPx, ci = x / kmPerPx, cj = y / kmPerPx;
  const rect: Rect = {
    i0: Math.max(0, Math.floor(ci - r)), i1: Math.min(nx - 1, Math.ceil(ci + r)),
    j0: Math.max(0, Math.floor(cj - r)), j1: Math.min(ny - 1, Math.ceil(cj + r)),
  };
  for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) {
    if (Math.hypot(i - ci, j - cj) <= r) cells[j * nx + i] = value;
  }
  return rect;
}

export function paintLine(cells: Uint8Array, nx: number, ny: number, kmPerPx: number, from: [number, number], to: [number, number], radiusKm: number, value: number): Rect {
  const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / (radiusKm * 0.4)));
  let rect = paintDisc(cells, nx, ny, kmPerPx, from[0], from[1], radiusKm, value);
  for (let n = 1; n <= steps; n++) {
    const t = n / steps;
    rect = union(rect, paintDisc(cells, nx, ny, kmPerPx, from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, radiusKm, value));
  }
  return rect;
}

export function fillRegion(cells: Uint8Array, nx: number, ny: number, i: number, j: number, value: number, open: (k: number) => boolean): Rect | null {
  const start = j * nx + i;
  const from = cells[start];
  if (from === value || !open(start)) return null;
  const rect: Rect = { i0: i, i1: i, j0: j, j1: j };
  const todo = [start];
  cells[start] = value;
  while (todo.length) {
    const k = todo.pop()!;
    const a = k % nx, b = (k - a) / nx;
    rect.i0 = Math.min(rect.i0, a); rect.i1 = Math.max(rect.i1, a);
    rect.j0 = Math.min(rect.j0, b); rect.j1 = Math.max(rect.j1, b);
    for (const next of [a > 0 ? k - 1 : -1, a < nx - 1 ? k + 1 : -1, b > 0 ? k - nx : -1, b < ny - 1 ? k + nx : -1]) {
      if (next < 0 || cells[next] !== from || !open(next)) continue;
      cells[next] = value;
      todo.push(next);
    }
  }
  return rect;
}

export function paintedShare(cells: Uint8Array, keys: string[]): Record<string, number> {
  const counts = new Uint32Array(256);
  for (let k = 0; k < cells.length; k++) counts[cells[k]]++;
  const out: Record<string, number> = {};
  keys.forEach((key, n) => { if (counts[n + 1]) out[key] = counts[n + 1] / cells.length; });
  return out;
}

function union(a: Rect, b: Rect): Rect {
  return { i0: Math.min(a.i0, b.i0), i1: Math.max(a.i1, b.i1), j0: Math.min(a.j0, b.j0), j1: Math.max(a.j1, b.j1) };
}
