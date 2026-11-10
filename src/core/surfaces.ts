import type { Biome, World } from './types';

const SHORE_NAMES: Record<string, string> = {
  grassland: 'black earth',
  alpine: 'black earth',
  steppe: 'ash-dusted earth',
  desert: 'ash',
  badlands: 'ash ridges',
  marsh: 'silt mire',
  forest: 'crimson coral',
  river: 'tidal channel',
  water: 'dark water',
  rock: 'mineral rock',
  playa: 'salt pan',
  'lake basin': 'dark pool',
};
const OPEN_GROUND = new Set(['grassland', 'alpine', 'steppe', 'desert']);

export function surfaceName(world: World, mat: string, elevAboveSea: number, slope: number): string {
  if (world.environment?.palette !== 'ashen') return mat;
  const tide = world.environment.tide;
  const tidal = tide ? tide.highM - world.terrain.seaLevelM : 0;
  if (OPEN_GROUND.has(mat) && elevAboveSea >= 0 && elevAboveSea < tidal && slope < 0.1) return 'tidal flats';
  return SHORE_NAMES[mat] ?? mat;
}

const BIOME_MAT: Record<Exclude<Biome, 'open' | 'erase'>, string> = {
  forest: 'forest', marsh: 'marsh', desert: 'desert', badlands: 'badlands', rock: 'rock', snow: 'snow', tidal: 'tidal flats',
};
const GENERIC_BIOME_LABEL: Record<Biome, string> = {
  open: 'open ground', forest: 'forest', marsh: 'marsh', desert: 'desert', badlands: 'badlands', rock: 'rock', snow: 'snow', tidal: 'tidal flats', erase: 'erase paint',
};

export function biomeLabel(world: World, biome: Biome): string {
  if (world.environment?.palette !== 'ashen' || biome === 'erase' || biome === 'tidal' || biome === 'snow') return GENERIC_BIOME_LABEL[biome];
  return SHORE_NAMES[biome === 'open' ? 'grassland' : BIOME_MAT[biome]] ?? GENERIC_BIOME_LABEL[biome];
}

export interface SurfaceInputs {
  moisture: number;
  logArea: number;
  water: boolean;
  playa: boolean;
}

export function classifySurface(world: World, s: SurfaceInputs, h: number, slope: number, painted: Biome | null): { mat: string; water: boolean; moisture: number } {
  const c = world.climate;
  const moisture = s.moisture;
  const elev = h - world.terrain.seaLevelM;
  if (s.water) return { mat: surfaceName(world, 'water', elev, slope), water: true, moisture };
  if (s.playa) return { mat: surfaceName(world, 'playa', elev, slope), water: false, moisture };
  const dry = 1 - moisture * 1.6 + c.temperature * 0.3;
  if (painted && painted !== 'erase') {
    const mat = painted === 'open' ? (dry > 0.55 ? 'steppe' : 'grassland') : BIOME_MAT[painted];
    const name = world.environment?.palette === 'ashen' ? SHORE_NAMES[mat] ?? mat : mat;
    return { mat: name, water: false, moisture };
  }
  let mat = 'grassland';
  if (elev > c.snowlineM && slope < 1.1) mat = 'snow';
  else if (slope > 0.75) mat = 'rock';
  else if (s.logArea > 2.6 && slope < 0.1) mat = 'river';
  else if (moisture > 0.78 && slope < 0.035 && elev < 400) mat = 'marsh';
  else if (moisture > 0.48 && elev < c.treelineM && slope < 0.7) mat = 'forest';
  else if (dry > 0.85) mat = slope > 0.3 ? 'badlands' : 'desert';
  else if (dry > 0.55) mat = 'steppe';
  return { mat: surfaceName(world, mat, elev, slope), water: false, moisture };
}
