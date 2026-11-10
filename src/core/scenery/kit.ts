export type Tier = 'near' | 'mid' | 'far';

export interface KindMeta {
  tier: Tier;
  nominalM: number;
  footRatio: number;
  blockRatio: number;
  variants: number;
}

export const TIERS: Record<Tier, { cellKm: number; rangeKm: number; probes: number }> = {
  near: { cellKm: 0.08, rangeKm: 0.42, probes: 4 },
  mid: { cellKm: 0.32, rangeKm: 3.2, probes: 5 },
  far: { cellKm: 1.28, rangeKm: 20, probes: 5 },
};

export const KINDS = {
  'coral-clump': { tier: 'near', nominalM: 1.6, footRatio: 0.7, blockRatio: 0, variants: 4 },
  tussock: { tier: 'near', nominalM: 1, footRatio: 0.6, blockRatio: 0, variants: 3 },
  stone: { tier: 'near', nominalM: 1, footRatio: 0.7, blockRatio: 0, variants: 4 },
  slab: { tier: 'near', nominalM: 0.35, footRatio: 6, blockRatio: 0, variants: 3 },
  bone: { tier: 'near', nominalM: 1, footRatio: 1.5, blockRatio: 0, variants: 3 },
  post: { tier: 'near', nominalM: 3.5, footRatio: 0.1, blockRatio: 0, variants: 3 },
  'coral-tree': { tier: 'mid', nominalM: 16, footRatio: 0.55, blockRatio: 0.05, variants: 4 },
  'fan-coral': { tier: 'mid', nominalM: 5, footRatio: 0.5, blockRatio: 0, variants: 3 },
  'brain-mound': { tier: 'mid', nominalM: 3.5, footRatio: 1.3, blockRatio: 1.1, variants: 3 },
  'coral-wall': { tier: 'mid', nominalM: 8, footRatio: 1, blockRatio: 0, variants: 3 },
  wreck: { tier: 'mid', nominalM: 10, footRatio: 1.9, blockRatio: 1.2, variants: 3 },
  boulder: { tier: 'mid', nominalM: 4, footRatio: 0.75, blockRatio: 0.65, variants: 4 },
  'tube-sponge': { tier: 'mid', nominalM: 9, footRatio: 0.45, blockRatio: 0.35, variants: 3 },
  ribs: { tier: 'mid', nominalM: 9, footRatio: 1.2, blockRatio: 0, variants: 2 },
  'dead-trunk': { tier: 'mid', nominalM: 10, footRatio: 0.35, blockRatio: 0.04, variants: 3 },
  'reed-bed': { tier: 'mid', nominalM: 1.1, footRatio: 14, blockRatio: 0, variants: 3 },
  tor: { tier: 'mid', nominalM: 14, footRatio: 0.9, blockRatio: 0.7, variants: 3 },
  'spiral-shell': { tier: 'mid', nominalM: 10, footRatio: 0.7, blockRatio: 0.6, variants: 2 },
  'coral-skeleton': { tier: 'mid', nominalM: 9, footRatio: 0.5, blockRatio: 0.04, variants: 3 },
  skull: { tier: 'mid', nominalM: 6, footRatio: 1, blockRatio: 0.8, variants: 2 },
  'fallen-block': { tier: 'mid', nominalM: 8, footRatio: 0.8, blockRatio: 0.7, variants: 3 },
  'ruin-wall': { tier: 'mid', nominalM: 9, footRatio: 1.6, blockRatio: 0, variants: 2 },
  'horn-spire': { tier: 'far', nominalM: 60, footRatio: 0.16, blockRatio: 0.14, variants: 3 },
  'leaning-tower': { tier: 'far', nominalM: 55, footRatio: 0.16, blockRatio: 0.14, variants: 2 },
  'coral-plateau': { tier: 'far', nominalM: 20, footRatio: 3, blockRatio: 2.4, variants: 3 },
  butte: { tier: 'far', nominalM: 50, footRatio: 1.1, blockRatio: 0.9, variants: 3 },
  'rock-needle': { tier: 'far', nominalM: 45, footRatio: 0.2, blockRatio: 0.18, variants: 3 },
  'sea-stack': { tier: 'far', nominalM: 80, footRatio: 0.3, blockRatio: 0.28, variants: 3 },
  'sea-arch': { tier: 'far', nominalM: 60, footRatio: 1, blockRatio: 0, variants: 1 },
  'ruin-tower': { tier: 'far', nominalM: 30, footRatio: 0.3, blockRatio: 0.28, variants: 3 },
} satisfies Record<string, KindMeta>;

export type Kind = keyof typeof KINDS;
export const KIND_NAMES = Object.keys(KINDS) as Kind[];
export const WALL_TEMPLATE_M = 16;
export const WALL_HALF_KM = 0.0018;

export interface Placed {
  kind: Kind;
  variant: number;
  x: number;
  z: number;
  y: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
  leanX: number;
  leanZ: number;
  tint: number;
  heightM: number;
}

export interface Blocker {
  x: number;
  z: number;
  r: number;
  ax?: number;
  az?: number;
  bx?: number;
  bz?: number;
}
