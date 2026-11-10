import { describe, expect, it } from 'vitest';
import { defaultWorld } from '../src/core/world';
import { Ground, type GroundSampler } from '../src/core/scenery/ground';
import { ScenerySource } from '../src/core/scenery/place';
import { SceneryCells } from '../src/core/scenery/store';
import { planRoute } from '../src/core/scenery/route';
import { KINDS, TIERS, type Kind, type Placed, type Tier } from '../src/core/scenery/kit';

const W = 40, H = 10;

function sampler(): GroundSampler {
  return {
    height: (x) => (x < 30 ? 50 : 50 - (x - 30) * 8),
    surface: (x, _z, h) => {
      if (h < 50 && x > 30) return { mat: 'water', water: true, moisture: 1 };
      return { mat: x < 10 ? 'crimson coral' : x < 20 ? 'tidal flats' : 'ash', water: false, moisture: 0.5 };
    },
    water: (x) => (x > 30 ? { kind: 2, level: 50 } : { kind: 0, level: 0 }),
  };
}

function source(features: { kind: string; pos: [number, number] }[] = []) {
  const w = defaultWorld('scenery');
  w.seed = 7;
  w.features = features.map((f, i) => ({ id: `f${i}`, ...f }));
  return new ScenerySource(new Ground(sampler(), w, W, H), w.seed);
}

function collect(src: ScenerySource, tier: Tier, x0: number, x1: number, z0 = 2, z1 = 8): Placed[] {
  const k = TIERS[tier].cellKm, out: Placed[] = [];
  for (let j = Math.floor(z0 / k); j < Math.ceil(z1 / k); j++) for (let i = Math.floor(x0 / k); i < Math.ceil(x1 / k); i++) out.push(...src.cell(tier, i, j).objects);
  return out;
}

const kinds = (list: Placed[]) => new Set(list.map((o) => o.kind));

describe('middle layer placement', () => {
  it('is the same whatever order the cells are generated in', () => {
    const a = source(), b = source();
    b.cell('mid', 3, 9); b.cell('near', 40, 40);
    expect(JSON.stringify(a.cell('mid', 10, 12))).toBe(JSON.stringify(b.cell('mid', 10, 12)));
    expect(JSON.stringify(a.cell('near', 30, 40))).toBe(JSON.stringify(b.cell('near', 30, 40)));
  });

  it('puts each biome kit in its biome', () => {
    const src = source();
    const coral = [...collect(src, 'mid', 2, 8), ...collect(src, 'near', 4, 6, 4, 6)];
    const ash = [...collect(src, 'mid', 22, 28), ...collect(src, 'far', 22, 28, 0, 10)];
    expect(kinds(coral)).toContain('coral-tree');
    expect(kinds(coral)).toContain('coral-wall');
    expect(kinds(coral)).toContain('coral-clump');
    expect(kinds(ash)).toContain('spiral-shell');
    for (const k of ['coral-tree', 'coral-wall', 'coral-clump', 'fan-coral'] as Kind[]) expect(kinds(ash)).not.toContain(k);
    for (const k of ['spiral-shell', 'skull', 'butte'] as Kind[]) expect(kinds(coral)).not.toContain(k);
  });

  it('thins out toward a biome edge', () => {
    const src = source();
    const count = (x0: number, x1: number) => collect(src, 'mid', x0, x1).filter((o) => o.kind === 'coral-tree' && o.x >= x0 && o.x < x1).length;
    expect(count(9.6, 10)).toBeLessThan(count(4, 4.4) * 0.6);
  });

  it('keeps land objects out of deep water and stands plateaus in the shallows', () => {
    const src = source();
    const lake = [...collect(src, 'mid', 30.5, 36), ...collect(src, 'far', 30, 40, 0, 10)];
    for (const o of lake) {
      const depth = 50 - (50 - (o.x - 30) * 8);
      if (o.kind === 'coral-plateau') {
        expect(depth).toBeLessThanOrEqual(30);
        expect(o.heightM).toBeGreaterThan(depth);
      } else expect(depth).toBeLessThan(2);
    }
    expect(kinds(lake)).toContain('coral-plateau');
  });

  it('keeps clear of landmarks', () => {
    const src = source([{ kind: 'walled-city', pos: [5, 5] }]);
    const near = collect(src, 'mid', 3, 7, 3, 7);
    for (const o of near) expect(Math.hypot(o.x - 5, o.z - 5)).toBeGreaterThan(1.15);
  });

  it('scales every object from its template', () => {
    for (const o of collect(source(), 'mid', 2, 8)) {
      if (o.kind !== 'coral-wall') expect(o.sy * KINDS[o.kind].nominalM).toBeCloseTo(o.heightM, 5);
    }
  });
});

describe('coral walls and travel', () => {
  it('blocks the march at a wall and plans a route through the passages', () => {
    const cells = new SceneryCells(source());
    const walls = collect(cells.source, 'mid', 3, 7, 3, 7).filter((o) => o.kind === 'coral-wall');
    expect(walls.length).toBeGreaterThan(20);
    const wall = walls[Math.floor(walls.length / 2)];
    expect(cells.blocked(wall.x, wall.z)).toBe(true);
    const n = [Math.sin(wall.yaw), Math.cos(wall.yaw)];
    const ax = wall.x - n[0] * 0.02, az = wall.z - n[1] * 0.02, bx = wall.x + n[0] * 0.02, bz = wall.z + n[1] * 0.02;
    const blocked = (x: number, z: number) => cells.blocked(x, z);
    const route = planRoute(ax, az, bx, bz, blocked);
    expect(route).not.toBeNull();
    let px = ax, pz = az;
    for (const [x, z] of route!) {
      for (let t = 0; t <= 1; t += 0.05) expect(blocked(px + (x - px) * t, pz + (z - pz) * t)).toBe(false);
      px = x; pz = z;
    }
    expect(Math.hypot(px - bx, pz - bz)).toBeLessThan(0.03);
  });
});
