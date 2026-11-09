import type { World } from './types';

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
