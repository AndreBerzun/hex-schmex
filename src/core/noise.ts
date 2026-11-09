// Seeded PRNG and 2D simplex noise. Deterministic: same seed -> same values.

/** mulberry32: small, fast, good enough for terrain. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string (e.g. an op id) into a 32-bit seed. */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071],
  [0.9239, 0.3827], [-0.9239, 0.3827], [0.9239, -0.3827], [-0.9239, -0.3827],
  [0.3827, 0.9239], [-0.3827, 0.9239], [0.3827, -0.9239], [-0.3827, -0.9239],
];

export class Simplex2 {
  private perm = new Uint8Array(512);
  private gx = new Float32Array(512);
  private gy = new Float32Array(512);

  constructor(seed: number) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      const g = GRAD[this.perm[i] & 15];
      this.gx[i] = g[0];
      this.gy[i] = g[1];
    }
  }

  /** Returns roughly [-1, 1]. */
  noise(xin: number, yin: number): number {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    const perm = this.perm;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const gi = ii + perm[jj];
      t0 *= t0;
      n += t0 * t0 * (this.gx[gi] * x0 + this.gy[gi] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const gi = ii + i1 + perm[jj + j1];
      t1 *= t1;
      n += t1 * t1 * (this.gx[gi] * x1 + this.gy[gi] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const gi = ii + 1 + perm[jj + 1];
      t2 *= t2;
      n += t2 * t2 * (this.gx[gi] * x2 + this.gy[gi] * y2);
    }
    return 70 * n;
  }

  /** Fractional Brownian motion, roughly [-1, 1]. */
  fbm(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * f + o * 17.13, y * f - o * 9.71);
      norm += amp;
      amp *= gain;
      f *= lacunarity;
    }
    return sum / norm;
  }

  /**
   * Ridged multifractal, [0, 1]. Sharp crests, feeds detail into valleys less
   * than onto ridges (weighting by the previous octave), which reads as eroded.
   */
  ridged(x: number, y: number, octaves: number, lacunarity = 2.1, gain = 0.5): number {
    let sum = 0, amp = 1, norm = 0, f = 1, w = 1;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(this.noise(x * f + o * 31.7, y * f + o * 47.3));
      n *= n;
      const v = n * w;
      sum += v * amp;
      norm += amp;
      w = Math.min(1, Math.max(0, n * 1.6));
      amp *= gain;
      f *= lacunarity;
    }
    return sum / norm;
  }
}

export interface CellHit { d: number; px: number; py: number; a: number; b: number }

export class Cells2 {
  constructor(private seed: number) {}

  private hash(ix: number, iy: number, salt: number): number {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(salt + 1, 2246822519)) ^ this.seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  nearest(x: number, y: number, out: CellHit): CellHit {
    const cx = Math.floor(x), cy = Math.floor(y);
    out.d = Infinity;
    for (let j = cy - 1; j <= cy + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
      const px = i + 0.15 + 0.7 * this.hash(i, j, 0), py = j + 0.15 + 0.7 * this.hash(i, j, 1);
      const d = Math.hypot(x - px, y - py);
      if (d < out.d) { out.d = d; out.px = px; out.py = py; out.a = this.hash(i, j, 2); out.b = this.hash(i, j, 3); }
    }
    return out;
  }
}
