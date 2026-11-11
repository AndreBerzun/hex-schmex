import type { Feature, World } from '../types';

export type Zone = 'coral' | 'tidal' | 'mire' | 'downs' | 'ash' | 'rock' | 'water' | 'none';

const ZONE_OF: Record<string, Zone> = {
  'crimson coral': 'coral', forest: 'coral',
  'tidal flats': 'tidal', 'tidal channel': 'tidal', river: 'tidal',
  'silt mire': 'mire', marsh: 'mire',
  'black earth': 'downs', grassland: 'downs', alpine: 'downs',
  ash: 'ash', 'ash-dusted earth': 'ash', 'ash ridges': 'ash', 'salt pan': 'ash', desert: 'ash', steppe: 'ash', badlands: 'ash', playa: 'ash',
  'mineral rock': 'rock', rock: 'rock', snow: 'rock',
};
const ZONES: Zone[] = ['coral', 'tidal', 'mire', 'downs', 'ash', 'rock', 'water', 'none'];

export function zoneOf(mat: string, water: boolean): Zone {
  if (water) return 'water';
  return ZONE_OF[mat] ?? 'none';
}

export interface GroundSampler {
  height(x: number, z: number): number;
  surface(x: number, z: number, h: number, slope: number): { mat: string; water: boolean; moisture: number };
  water(x: number, z: number): { kind: number; level: number };
}

export interface Spot {
  x: number;
  z: number;
  h: number;
  slope: number;
  mat: string;
  zone: Zone;
  core: number;
  moisture: number;
  depth: number;
  ridge: number;
  foot: number;
  bank: number;
  coast: number;
  excluded: boolean;
}

const COARSE_KM = 0.25;
const CORE_R = 3;

export class Ground {
  readonly seaLevelM: number;
  private zoneGrid: Int8Array;
  private gw: number;
  private gh: number;
  private exclusions: { x: number; z: number; r: number }[];

  constructor(readonly sampler: GroundSampler, readonly world: World, readonly widthKm: number, readonly heightKm: number) {
    this.seaLevelM = world.terrain.seaLevelM;
    this.gw = Math.ceil(widthKm / COARSE_KM);
    this.gh = Math.ceil(heightKm / COARSE_KM);
    this.zoneGrid = new Int8Array(this.gw * this.gh).fill(-1);
    this.exclusions = world.features.filter((f) => f.pos).map((f) => ({ x: f.pos![0], z: f.pos![1], r: exclusionKm(f) })).filter((e) => e.r > 0);
  }

  slopeAt(x: number, z: number, stepKm = 0.03): number {
    const s = this.sampler;
    const gx = (s.height(x + stepKm, z) - s.height(x - stepKm, z)) / (2000 * stepKm);
    const gz = (s.height(x, z + stepKm) - s.height(x, z - stepKm)) / (2000 * stepKm);
    return Math.hypot(gx, gz);
  }

  private coarseZone(i: number, j: number): number {
    i = Math.max(0, Math.min(this.gw - 1, i));
    j = Math.max(0, Math.min(this.gh - 1, j));
    const k = j * this.gw + i;
    let v = this.zoneGrid[k];
    if (v < 0) {
      const x = (i + 0.5) * COARSE_KM, z = (j + 0.5) * COARSE_KM;
      const h = this.sampler.height(x, z);
      const sl = this.slopeAt(x, z, 0.06);
      const s = this.sampler.surface(x, z, h, sl);
      const w = this.sampler.water(x, z);
      v = ZONES.indexOf(zoneOf(s.mat, s.water || (w.kind > 0 && w.level - h > 0.3)));
      this.zoneGrid[k] = v;
    }
    return v;
  }

  coreAt(x: number, z: number, zone: Zone): number {
    const zi = ZONES.indexOf(zone);
    const ci = Math.floor(x / COARSE_KM), cj = Math.floor(z / COARSE_KM);
    let same = 0, n = 0;
    for (let dj = -CORE_R; dj <= CORE_R; dj++) for (let di = -CORE_R; di <= CORE_R; di++) {
      if (di * di + dj * dj > CORE_R * CORE_R + 1) continue;
      n++;
      if (this.coarseZone(ci + di, cj + dj) === zi) same++;
    }
    return same / n;
  }

  private isWet(x: number, z: number): boolean {
    const h = this.sampler.height(x, z);
    const w = this.sampler.water(x, z);
    if (w.kind > 0 && w.level - h > 0.3) return true;
    const m = this.sampler.surface(x, z, h, this.slopeAt(x, z)).mat;
    return m === 'tidal channel' || m === 'river' || m === 'dark water' || m === 'water';
  }

  describe(x: number, z: number): Spot {
    const s = this.sampler;
    const h = s.height(x, z);
    const slope = this.slopeAt(x, z);
    const surf = s.surface(x, z, h, slope);
    const w = s.water(x, z);
    const depth = w.kind > 0 ? Math.max(0, w.level - h) : 0;
    const zone = zoneOf(surf.mat, surf.water || depth > 0.3);
    const r = 0.12;
    const ring = [s.height(x + r, z), s.height(x - r, z), s.height(x, z + r), s.height(x, z - r)];
    const avg = (ring[0] + ring[1] + ring[2] + ring[3]) / 4;
    const ridge = smooth(2, 14, h - avg);
    let steepAround = 0;
    for (const [dx, dz] of DIRS) steepAround = Math.max(steepAround, this.slopeAt(x + dx * 0.1, z + dz * 0.1, 0.04));
    const foot = smooth(0.35, 0.8, steepAround) * (1 - smooth(0.2, 0.4, slope));
    let bank = 0, coast = 0;
    if (zone !== 'water') {
      for (const d of [0.05, 0.12]) for (const [dx, dz] of DIRS) if (this.isWet(x + dx * d, z + dz * d)) bank = Math.max(bank, d < 0.1 ? 1 : 0.6);
    } else {
      for (const d of [0.12, 0.3]) for (const [dx, dz] of DIRS) {
        const hh = s.height(x + dx * d, z + dz * d);
        if (hh > w.level + 25 && this.slopeAt(x + dx * d, z + dz * d, 0.05) > 0.35) coast = Math.max(coast, d < 0.2 ? 1 : 0.6);
      }
    }
    let excluded = x < 0.05 || z < 0.05 || x > this.widthKm - 0.05 || z > this.heightKm - 0.05;
    for (const e of this.exclusions) if ((x - e.x) ** 2 + (z - e.z) ** 2 < e.r * e.r) excluded = true;
    return { x, z, h, slope, mat: surf.mat, zone, core: this.coreAt(x, z, zone), moisture: surf.moisture, depth, ridge, foot, bank, coast, excluded };
  }
}

const DIRS: [number, number][] = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];

export function smooth(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function exclusionKm(f: Feature): number {
  switch (f.kind) {
    case 'walled-city': return (f.radiusKm ?? 1.15) + 0.12;
    case 'crimson-spire': return (f.radiusKm ?? 0.22) * 2;
    case 'cursed-tree': return 0.12;
    case 'walking-statue': return 0.08;
    case 'leviathan-skeleton': return (f.radiusKm ?? 0.4) * 0.6;
    default: return 0;
  }
}
