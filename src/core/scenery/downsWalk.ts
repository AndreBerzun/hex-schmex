// Authored step-2 fixture, deliberately separate from procedural biome rules.
import type { Ground } from './ground';
import { ScenerySource, type SceneryCell } from './place';
import { KINDS, TIERS, type Kind, type Tier } from './kit';

export const DOWNS_WALK_START: [number, number] = [40.83, 45.83];
export const DOWNS_WALK_END: [number, number] = [40.83, 46.23];
// Metres east/south of start, height, variant, yaw. No random placement.
const MASSES: [Kind, number, number, number, number, number][] = [
  ['tor', -38, 105, 40, 0, .3],
  ['tor', -31, 130, 19, 1, .6],
  ['boulder', -22, 148, 9, 2, .4],
  ['tor', 34, 173, 24, 2, -.4],
  ['tor', 27, 199, 19, 0, -.2],
  // The central mass conceals the clearing; the west shoulder frames a passage.
  ['tor', 0, 235, 30, 1, .2],
  ['tor', 19, 248, 24, 0, .4],
  ['boulder', 29, 267, 12, 1, .7],
  ['tor', -49, 222, 21, 2, .8],
  ['boulder', -46, 247, 14, 3, .2],
  ['tor', -42, 273, 17, 0, .5],
  // A quiet clearing beyond the squeeze, with a distinct architectural destination.
  ['boulder', -49, 335, 9, 2, .5],
  ['tor', 50, 352, 17, 2, -.2],
  ['ruin-tower', 8, 463, 30, 1, .3],
  ['tor', -23, 465, 15, 0, .3],
  ['boulder', 23, 474, 8, 3, .8],
];

function inside(x: number, z: number): boolean {
  const dx = (x - DOWNS_WALK_START[0]) * 1000, dz = (z - DOWNS_WALK_START[1]) * 1000;
  return Math.abs(dx) < 85 && dz > 75 && dz < 500;
}

export class DownsWalkSource extends ScenerySource {
  constructor(ground: Ground, seed: number, private supportHeight = ground.sampler.height) {
    super(ground, seed);
  }
  override cell(tier: Tier, cx: number, cz: number): SceneryCell {
    const cell = super.cell(tier, cx, cz);
    // Clear only this authored stage. The rest of the region is exactly the usual scenery.
    cell.objects = cell.objects.filter(o => !inside(o.x, o.z));
    cell.blockers = cell.blockers.filter(o => !inside(o.x, o.z));
    const width = TIERS[tier].cellKm;
    for (const [kind, east, south, heightM, variant, yaw] of MASSES) {
      const meta = KINDS[kind];
      const x = DOWNS_WALK_START[0] + east / 1000, z = DOWNS_WALK_START[1] + south / 1000;
      if (meta.tier !== tier || Math.floor(x / width) !== cx || Math.floor(z / width) !== cz) continue;
      const s = heightM / meta.nominalM;
      const radius = meta.blockRatio * heightM / 1000;
      // Seat the blockout on the low side of its support footprint, avoiding a floating base.
      const h = this.supportHeight;
      const y = Math.min(h(x, z), h(x-radius, z), h(x+radius, z), h(x, z-radius), h(x, z+radius)) - .8;
      cell.objects.push({ kind, variant, x, z, y, yaw, sx: s, sy: s, sz: s,
        leanX: 0, leanZ: 0, tint: 1, heightM });
      if (radius > 0) cell.blockers.push({ x, z, r: radius });
    }
    return cell;
  }
}
