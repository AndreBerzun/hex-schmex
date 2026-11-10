import { hashString, mulberry32, Simplex2 } from '../noise';
import { Ground, smooth, type Spot, type Zone } from './ground';
import { KINDS, TIERS, WALL_HALF_KM, WALL_TEMPLATE_M, type Blocker, type Kind, type Placed, type Tier } from './kit';

export class Fields {
  private cache = new Map<string, Simplex2>();
  constructor(private seed: number) {}
  at(name: string, x: number, z: number, wavelengthKm: number): number {
    let s = this.cache.get(name);
    if (!s) { s = new Simplex2(hashString(`${this.seed}:scenery:${name}`)); this.cache.set(name, s); }
    return s.noise(x / wavelengthKm, z / wavelengthKm);
  }
}

interface Rule {
  kind: Kind;
  spacingKm: number;
  sizeM: [number, number];
  skew?: number;
  weight: (s: Spot, f: Fields, x: number, z: number) => number;
  variants?: (s: Spot) => number[];
  lean?: number;
  tilt?: number;
  sink?: number;
  water?: 'dry' | 'shallow' | 'standing';
  standsInWater?: [number, number];
}

const dry = (s: Spot) => s.zone !== 'water' && s.depth < 0.3;
const core = (s: Spot) => smooth(0.35, 0.95, s.core);
const gentle = (s: Spot, max = 0.35) => 1 - smooth(max * 0.6, max, s.slope);
const by = (s: Spot, w: Partial<Record<Zone, number>>) => w[s.zone] ?? 0;

const RULES: Record<Tier, Rule[]> = {
  near: [
    { kind: 'slab', spacingKm: 0.009, sizeM: [0.7, 1.5], tilt: 1, sink: 0.4, water: 'shallow',
      weight: (s, f, x, z) => s.zone === 'tidal' || (s.zone === 'water' && s.depth < 1.2) ? (s.mat === 'tidal channel' || s.zone === 'water' ? 0.6 : 0.03 + 0.4 * s.bank) * smooth(-0.3, 0.1, f.at('slabs', x, z, 0.07)) : 0 },
    { kind: 'stone', spacingKm: 0.012, sizeM: [0.25, 1.7], skew: 2.2, tilt: 0.7, sink: 0.3,
      weight: (s) => by(s, { rock: 0.4, ash: 0.06, tidal: 0.1, mire: 0.04, downs: 0.05 + 0.3 * s.ridge, coral: 0.06 }) + 0.3 * s.foot },
    { kind: 'coral-clump', spacingKm: 0.0085, sizeM: [0.7, 2.6], lean: 0.12,
      weight: (s, f, x, z) => s.zone === 'coral' ? core(s) * (0.5 + 0.5 * smooth(-0.6, 0.4, f.at('clumps', x, z, 0.11))) * gentle(s, 0.6) : by(s, { tidal: 0.07 + 0.15 * s.bank * s.core, downs: 0.02 }) },
    { kind: 'tussock', spacingKm: 0.01, sizeM: [0.5, 1.3], tilt: 0.5,
      weight: (s, f, x, z) => by(s, { downs: 0.3 * (0.4 + 0.6 * smooth(-0.5, 0.5, f.at('grass', x, z, 0.18))), mire: 0.4, tidal: 0.12 * s.bank, ash: 0.03 }) },
    { kind: 'bone', spacingKm: 0.022, sizeM: [0.5, 2], tilt: 1, sink: 0.25, weight: (s) => by(s, { ash: 0.03, downs: 0.012, mire: 0.012 }) },
  ],
  mid: [
    { kind: 'wreck', spacingKm: 0.32, sizeM: [7, 13], tilt: 1, lean: 0.22, sink: 0.25, water: 'shallow',
      weight: (s) => (s.zone === 'tidal' || (s.zone === 'water' && s.depth < 3)) ? 0.32 * gentle(s, 0.12) : 0 },
    { kind: 'ruin-wall', spacingKm: 0.32, sizeM: [5, 12], sink: 0.1, weight: (s) => dry(s) && s.zone !== 'rock' && s.zone !== 'none' ? 0.03 * gentle(s, 0.25) : 0 },
    { kind: 'tor', spacingKm: 0.11, sizeM: [6, 22], skew: 1.6, sink: 0.12,
      weight: (s) => by(s, { downs: 0.03 + 0.55 * s.ridge, ash: 0.015 + 0.2 * s.ridge, rock: 0.06 * s.ridge }) * gentle(s, 0.6) },
    { kind: 'spiral-shell', spacingKm: 0.08, sizeM: [3, 16], skew: 1.8, sink: 0.32, lean: 0.55,
      weight: (s) => by(s, { ash: 0.08 + 0.12 * s.foot, downs: 0.004, tidal: 0.006 }) * gentle(s, 0.4) },
    { kind: 'skull', spacingKm: 0.12, sizeM: [2.5, 8], sink: 0.22, lean: 0.3, weight: (s) => by(s, { ash: 0.025, downs: 0.004 }) },
    { kind: 'ribs', spacingKm: 0.09, sizeM: [5, 13], sink: 0.18, weight: (s) => by(s, { mire: 0.035, ash: 0.03, tidal: 0.015 }) },
    { kind: 'fallen-block', spacingKm: 0.06, sizeM: [3, 14], skew: 1.7, tilt: 0.8, lean: 0.3, sink: 0.2,
      weight: (s) => by(s, { rock: 0.12 + 0.45 * s.foot, ash: 0.15 * s.foot, downs: 0.22 * s.foot, coral: 0.05 * s.foot }) },
    { kind: 'coral-tree', spacingKm: 0.036, sizeM: [9, 22], lean: 0.12,
      variants: (s) => (s.zone === 'coral' || s.zone === 'tidal' ? [0, 1, 2] : [3]),
      weight: (s, f, x, z) => s.zone === 'coral' ? 0.75 * core(s) * smooth(-0.2, 0.35, f.at('stands', x, z, 0.42)) * gentle(s, 0.55)
        : by(s, { tidal: 0.012 + 0.03 * s.bank, downs: 0.0025 * (1 + 3 * s.ridge) }) },
    { kind: 'coral-skeleton', spacingKm: 0.07, sizeM: [4, 11], lean: 0.2, sink: 0.05, weight: (s) => by(s, { ash: 0.05, downs: 0.005 }) },
    { kind: 'tube-sponge', spacingKm: 0.04, sizeM: [4, 13], water: 'shallow', lean: 0.08,
      weight: (s, f, x, z) => (s.zone === 'mire' || (s.zone === 'water' && s.depth < 2) ? 0.3 : by(s, { tidal: 0.03, coral: 0.02 })) * smooth(-0.1, 0.45, f.at('sponges', x, z, 0.35)) },
    { kind: 'dead-trunk', spacingKm: 0.04, sizeM: [5, 13], lean: 0.28, water: 'shallow',
      weight: (s) => by(s, { mire: 0.06 + 0.18 * s.bank, downs: 0.006, tidal: 0.012 }) },
    { kind: 'boulder', spacingKm: 0.035, sizeM: [1.8, 7], skew: 1.8, tilt: 0.7, sink: 0.25,
      weight: (s, f, x, z) => {
        const field = smooth(0, 0.5, f.at('boulders', x, z, 0.5));
        return by(s, { rock: 0.08 + 0.4 * field * (0.4 + s.foot), tidal: 0.04 + 0.12 * field, downs: 0.02 + 0.25 * s.ridge * field + 0.4 * s.foot * (0.3 + field), coral: 0.04, ash: 0.03 + 0.3 * s.foot, mire: 0.02 });
      } },
    { kind: 'fan-coral', spacingKm: 0.024, sizeM: [2.5, 7], lean: 0.15,
      weight: (s) => s.zone === 'coral' ? 0.28 * core(s) * gentle(s, 0.6) : by(s, { tidal: 0.04 }) },
    { kind: 'brain-mound', spacingKm: 0.035, sizeM: [1.5, 5], sink: 0.3, tilt: 0.6,
      weight: (s) => s.zone === 'coral' ? 0.12 * core(s) : by(s, { tidal: 0.06 }) },
    { kind: 'reed-bed', spacingKm: 0.045, sizeM: [0.7, 1.4], tilt: 1, sink: 0.35, water: 'shallow',
      weight: (s) => (s.zone === 'mire' ? 0.5 : s.zone === 'water' && s.depth < 1 ? 0.3 : by(s, { tidal: 0.08 * s.bank })) * gentle(s, 0.1) },
  ],
  far: [
    { kind: 'leaning-tower', spacingKm: 1.28, sizeM: [30, 75], lean: 0.2, sink: 0.08,
      weight: (s) => by(s, { tidal: 0.12, mire: 0.12 }) * gentle(s, 0.15) },
    { kind: 'ruin-tower', spacingKm: 1.28, sizeM: [15, 40], sink: 0.05,
      weight: (s) => dry(s) && s.zone !== 'rock' && s.zone !== 'none' ? 0.07 * core(s) * gentle(s, 0.3) : 0 },
    { kind: 'sea-stack', spacingKm: 0.22, sizeM: [30, 120], standsInWater: [1, 80], weight: (s) => s.zone === 'water' ? 0.45 * s.coast : 0 },
    { kind: 'sea-arch', spacingKm: 0.6, sizeM: [40, 70], standsInWater: [2, 40], weight: (s) => s.zone === 'water' ? 0.12 * s.coast : 0 },
    { kind: 'coral-plateau', spacingKm: 0.17, sizeM: [4, 18], standsInWater: [2, 30],
      weight: (s, f, x, z) => s.zone === 'water' && s.depth < 30 ? 0.4 * (1 - s.depth / 30) * smooth(-0.4, 0.1, f.at('plateaus', x, z, 1.1)) : 0 },
    { kind: 'butte', spacingKm: 0.45, sizeM: [25, 70], sink: 0.05, weight: (s, f, x, z) => by(s, { ash: 0.07 }) * gentle(s, 0.2) * smooth(-0.2, 0.3, f.at('buttes', x, z, 3)) },
    { kind: 'rock-needle', spacingKm: 0.22, sizeM: [15, 60], skew: 1.4, lean: 0.12, sink: 0.05,
      weight: (s) => by(s, { rock: 0.06 + 0.25 * s.foot + 0.15 * s.ridge }) + (s.mat === 'ash ridges' ? 0.05 : 0) },
    { kind: 'horn-spire', spacingKm: 0.2, sizeM: [25, 100], skew: 1.5, lean: 0.32, sink: 0.04, water: 'shallow',
      weight: (s, f, x, z) => (by(s, { tidal: 0.16, mire: 0.12, ash: 0.01 }) + (s.zone === 'water' && s.depth < 4 ? 0.08 : 0)) * smooth(0.15, 0.6, f.at('spires', x, z, 1.6)) * gentle(s, 0.2) },
  ],
};

export interface SceneryCell {
  objects: Placed[];
  blockers: Blocker[];
}

export function sceneryEnabled(world: { environment?: { palette?: string; scenery?: boolean } }): boolean {
  return world.environment?.scenery ?? world.environment?.palette === 'ashen';
}

export class ScenerySource {
  readonly fields: Fields;
  constructor(readonly ground: Ground, readonly seed: number) {
    this.fields = new Fields(seed);
  }

  cell(tier: Tier, cx: number, cz: number): SceneryCell {
    const t = TIERS[tier];
    const g = this.ground;
    const out: SceneryCell = { objects: [], blockers: [] };
    const x0 = cx * t.cellKm, z0 = cz * t.cellKm;
    if (x0 >= g.widthKm || z0 >= g.heightKm || x0 + t.cellKm <= 0 || z0 + t.cellKm <= 0) return out;
    const rng = mulberry32(hashString(`${this.seed}:scenery:${tier}:${cx}:${cz}`));
    const pn = t.probes, pk = t.cellKm / pn;
    const probes: Spot[] = [];
    for (let j = 0; j < pn; j++) for (let i = 0; i < pn; i++) probes.push(g.describe(x0 + (i + 0.5) * pk, z0 + (j + 0.5) * pk));
    const probeAt = (x: number, z: number) => probes[Math.min(pn - 1, Math.max(0, Math.floor((z - z0) / pk))) * pn + Math.min(pn - 1, Math.max(0, Math.floor((x - x0) / pk)))];
    const taken: { x: number; z: number; r: number }[] = [];
    if (tier === 'mid') this.walls(x0, z0, t.cellKm, probeAt, out, taken);
    if (tier === 'near') this.postRows(x0, z0, t.cellKm, rng, probeAt, out);
    for (const rule of RULES[tier]) this.scatter(rule, x0, z0, t.cellKm, rng, probeAt, out, taken, tier !== 'near');
    return out;
  }

  private scatter(rule: Rule, x0: number, z0: number, cell: number, rng: () => number, probeAt: (x: number, z: number) => Spot,
    out: SceneryCell, taken: { x: number; z: number; r: number }[], checkOverlap: boolean) {
    const meta = KINDS[rule.kind];
    const per = cell / rule.spacingKm;
    const n = Math.max(1, Math.round(per));
    const chance = per < 1 ? per * per : 1;
    const step = cell / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const rx = rng(), rz = rng(), roll = rng(), rs = rng(), ry = rng(), rv = rng(), rl = rng(), rt = rng();
      if (chance < 1 && rng() > chance) continue;
      const x = x0 + (i + rx) * step, z = z0 + (j + rz) * step;
      const p = probeAt(x, z);
      if (p.excluded) continue;
      const w = rule.weight(p, this.fields, x, z);
      if (roll >= w) continue;
      const h = this.ground.sampler.height(x, z);
      const water = this.ground.sampler.water(x, z);
      const depth = water.kind > 0 ? Math.max(0, water.level - h) : 0;
      if (rule.standsInWater) {
        if (depth < rule.standsInWater[0] || depth > rule.standsInWater[1]) continue;
      } else if (depth > (rule.water === 'shallow' ? 1.5 : 0.3)) continue;
      const above = rule.sizeM[0] + (rule.sizeM[1] - rule.sizeM[0]) * Math.pow(rs, rule.skew ?? 1);
      const heightM = rule.standsInWater ? depth + above : above;
      const r = meta.footRatio * heightM / 1000;
      if (checkOverlap && taken.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < ((o.r + r) * 0.75) ** 2)) continue;
      const variants = rule.variants?.(p);
      const variant = variants ? variants[Math.floor(rv * variants.length)] : Math.floor(rv * meta.variants);
      let leanX = 0, leanZ = 0;
      if (rule.tilt) {
        const sk = Math.max(0.004, r * 0.6);
        leanX = -Math.atan((this.ground.sampler.height(x + sk, z) - this.ground.sampler.height(x - sk, z)) / (2000 * sk)) * rule.tilt;
        leanZ = -Math.atan((this.ground.sampler.height(x, z + sk) - this.ground.sampler.height(x, z - sk)) / (2000 * sk)) * rule.tilt;
      }
      if (rule.lean) {
        const a = rl * Math.PI * 2, m = rule.lean * Math.sqrt(rt);
        leanX += Math.cos(a) * m; leanZ += Math.sin(a) * m;
      }
      const s = heightM / meta.nominalM;
      const sink = (rule.sink ?? 0.04) * above + 0.15;
      out.objects.push({ kind: rule.kind, variant, x, z, y: h - sink, yaw: ry * Math.PI * 2, sx: s, sy: s, sz: s, leanX, leanZ, tint: 0.85 + rt * 0.3, heightM });
      if (checkOverlap) taken.push({ x, z, r });
      if (meta.blockRatio > 0) out.blockers.push({ x, z, r: meta.blockRatio * heightM / 1000 });
    }
  }

  private walls(x0: number, z0: number, cell: number, probeAt: (x: number, z: number) => Spot, out: SceneryCell, taken: { x: number; z: number; r: number }[]) {
    const f = this.fields;
    const step = 0.012;
    const n = Math.round(cell / step);
    const F = (x: number, z: number) => f.at('walls', x, z, 0.1) + 0.35 * f.at('walls2', x, z, 0.037);
    const grid = new Float32Array((n + 1) * (n + 1));
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) grid[j * (n + 1) + i] = F(x0 + i * step, z0 + j * step);
    const lerp = (a: number, b: number) => a / (a - b);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = grid[j * (n + 1) + i], b = grid[j * (n + 1) + i + 1], c = grid[(j + 1) * (n + 1) + i + 1], d = grid[(j + 1) * (n + 1) + i];
      const pts: [number, number][] = [];
      if ((a > 0) !== (b > 0)) pts.push([i + lerp(a, b), j]);
      if ((b > 0) !== (c > 0)) pts.push([i + 1, j + lerp(b, c)]);
      if ((d > 0) !== (c > 0)) pts.push([i + lerp(d, c), j + 1]);
      if ((a > 0) !== (d > 0)) pts.push([i, j + lerp(a, d)]);
      for (let k = 0; k + 1 < pts.length; k += 2) {
        const ax = x0 + pts[k][0] * step, az = z0 + pts[k][1] * step, bx = x0 + pts[k + 1][0] * step, bz = z0 + pts[k + 1][1] * step;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (f.at('wallgap', mx, mz, 0.045) > 0.42) continue;
        const p = probeAt(mx, mz);
        if (p.excluded || p.zone !== 'coral' || p.core < 0.45 || p.slope > 0.45) continue;
        if (f.at('maze', mx, mz, 1.3) < -0.05) continue;
        const h = this.ground.sampler.height(mx, mz);
        const w = this.ground.sampler.water(mx, mz);
        if (w.kind > 0 && w.level - h > 0.3) continue;
        const len = Math.hypot(bx - ax, bz - az) * 1000 + 3;
        const heightM = 4.5 + 7 * (0.5 + 0.5 * f.at('wallh', mx, mz, 0.16));
        const sy = heightM / KINDS['coral-wall'].nominalM;
        const variant = Math.floor((f.at('wallv', mx, mz, 0.03) * 0.5 + 0.5) * 2.999);
        out.objects.push({ kind: 'coral-wall', variant, x: mx, z: mz, y: h - 0.4, yaw: -Math.atan2(bz - az, bx - ax), sx: len / WALL_TEMPLATE_M, sy, sz: 0.8 + 0.4 * sy, leanX: 0, leanZ: 0, tint: 0.85 + 0.3 * (0.5 + 0.5 * f.at('wallt', mx, mz, 0.05)), heightM });
        out.blockers.push({ x: mx, z: mz, r: WALL_HALF_KM, ax, az, bx, bz });
        taken.push({ x: mx, z: mz, r: len / 2000 });
      }
    }
  }

  private postRows(x0: number, z0: number, cell: number, rng: () => number, probeAt: (x: number, z: number) => Spot, out: SceneryCell) {
    const roll = rng(), sx = x0 + rng() * cell, sz = z0 + rng() * cell, dir = rng() * Math.PI * 2, count = 5 + Math.floor(rng() * 9);
    const p = probeAt(sx, sz);
    if (p.excluded || roll > (p.zone === 'tidal' ? 0.07 * (0.3 + p.core) : p.zone === 'mire' ? 0.02 : 0)) return;
    for (let k = 0; k < count; k++) {
      const gap = rng(), hr = rng(), la = rng(), lm = rng(), v = rng();
      if (gap < 0.2) continue;
      const d = k * 0.0036;
      const x = sx + Math.cos(dir) * d, z = sz + Math.sin(dir) * d;
      const h = this.ground.sampler.height(x, z);
      const w = this.ground.sampler.water(x, z);
      if (w.kind > 0 && w.level - h > 2) continue;
      const heightM = 1.6 + hr * 3.4;
      const s = heightM / KINDS.post.nominalM;
      out.objects.push({ kind: 'post', variant: Math.floor(v * 3), x, z, y: h - 0.5, yaw: dir + la * 2, sx: s, sy: s, sz: s, leanX: Math.cos(la * 6.28) * lm * 0.25, leanZ: Math.sin(la * 6.28) * lm * 0.25, tint: 0.8 + v * 0.4, heightM });
    }
  }
}

export function segmentDistance(px: number, pz: number, b: Blocker): number {
  if (b.ax === undefined) return Math.hypot(px - b.x, pz - b.z) - b.r;
  const dx = b.bx! - b.ax, dz = b.bz! - b.az!;
  const t = Math.max(0, Math.min(1, ((px - b.ax) * dx + (pz - b.az!) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (b.ax + dx * t), pz - (b.az! + dz * t)) - b.r;
}
