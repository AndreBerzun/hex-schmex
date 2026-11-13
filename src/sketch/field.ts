export interface Field {
  nx: number;
  ny: number;
  kmPerPx: number;
  h: Float32Array;
}

export type BrushTool = 'raise' | 'lower' | 'flatten' | 'smooth';

export interface Stamp {
  tool: BrushTool;
  x: number;
  y: number;
  radiusKm: number;
  amountM: number;
  targetM: number;
}

export interface Rect { i0: number; i1: number; j0: number; j1: number }

export function flatField(nx: number, ny: number, kmPerPx: number, heightM: number): Field {
  return { nx, ny, kmPerPx, h: new Float32Array(nx * ny).fill(heightM) };
}

export function heightAt(f: Field, x: number, y: number): number {
  const fx = Math.min(f.nx - 1.001, Math.max(0, x / f.kmPerPx));
  const fy = Math.min(f.ny - 1.001, Math.max(0, y / f.kmPerPx));
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, k = j * f.nx + i;
  return (f.h[k] * (1 - u) + f.h[k + 1] * u) * (1 - v) + (f.h[k + f.nx] * (1 - u) + f.h[k + f.nx + 1] * u) * v;
}

export function stamp(f: Field, s: Stamp): Rect {
  const r = s.radiusKm / f.kmPerPx, ci = s.x / f.kmPerPx, cj = s.y / f.kmPerPx;
  const rect: Rect = {
    i0: Math.max(0, Math.floor(ci - r)), i1: Math.min(f.nx - 1, Math.ceil(ci + r)),
    j0: Math.max(0, Math.floor(cj - r)), j1: Math.min(f.ny - 1, Math.ceil(cj + r)),
  };
  const before = s.tool === 'smooth' ? f.h.slice() : f.h;
  const share = Math.min(1, s.amountM / 400);
  for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) {
    const d = Math.hypot(i - ci, j - cj) / r;
    if (d >= 1) continue;
    const w = 0.5 + 0.5 * Math.cos(Math.PI * d);
    const k = j * f.nx + i;
    if (s.tool === 'raise') f.h[k] += s.amountM * w;
    else if (s.tool === 'lower') f.h[k] -= s.amountM * w;
    else if (s.tool === 'flatten') f.h[k] += (s.targetM - f.h[k]) * w * share;
    else f.h[k] += (neighbourMean(before, f.nx, f.ny, i, j) - f.h[k]) * w * share;
  }
  return rect;
}

function neighbourMean(h: Float32Array, nx: number, ny: number, i: number, j: number): number {
  let sum = 0, n = 0;
  for (let b = Math.max(0, j - 2); b <= Math.min(ny - 1, j + 2); b++) for (let a = Math.max(0, i - 2); a <= Math.min(nx - 1, i + 2); a++) {
    sum += h[b * nx + a];
    n++;
  }
  return sum / n;
}

export function groundHit(f: Field, origin: [number, number, number], dir: [number, number, number], seaLevelM: number): [number, number] | null {
  const maxKm = (f.nx + f.ny) * f.kmPerPx * 2;
  const step = f.kmPerPx * 0.5;
  let prev = 0;
  for (let t = 0; t < maxKm; t += step) {
    const x = origin[0] + dir[0] * t, y = origin[2] + dir[2] * t, z = origin[1] + dir[1] * t;
    const inside = x >= 0 && y >= 0 && x <= (f.nx - 1) * f.kmPerPx && y <= (f.ny - 1) * f.kmPerPx;
    if (inside && z * 1000 <= Math.max(seaLevelM, heightAt(f, x, y))) {
      let lo = prev, hi = t;
      for (let n = 0; n < 8; n++) {
        const m = (lo + hi) / 2;
        const mx = origin[0] + dir[0] * m, my = origin[2] + dir[2] * m;
        if ((origin[1] + dir[1] * m) * 1000 <= Math.max(seaLevelM, heightAt(f, mx, my))) hi = m; else lo = m;
      }
      return [origin[0] + dir[0] * hi, origin[2] + dir[2] * hi];
    }
    prev = t;
  }
  return null;
}
