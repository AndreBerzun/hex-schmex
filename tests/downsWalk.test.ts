import { expect, it } from 'vitest';
import { defaultWorld } from '../src/core/world';
import { Ground } from '../src/core/scenery/ground';
import { ScenerySource } from '../src/core/scenery/place';
import { DownsWalkSource, DOWNS_WALK_START, DOWNS_WALK_END } from '../src/core/scenery/downsWalk';
import { SceneryCells } from '../src/core/scenery/store';
import { clearLine, planRoute } from '../src/core/scenery/route';

function fixture() {
  const world = defaultWorld();
  const ground = new Ground({ height: () => 100, water: () => ({ kind: 0, level: 0 }),
    surface: () => ({ mat: 'black earth', water: false, moisture: .4 }) }, world, 130, 130);
  return { authored: new DownsWalkSource(ground, world.seed), normal: new ScenerySource(ground, world.seed) };
}

it('leaves scenery outside the authored area unchanged', () => {
  const { authored, normal } = fixture();
  for (const tier of ['near', 'mid', 'far'] as const) expect(authored.cell(tier, 2, 2)).toEqual(normal.cell(tier, 2, 2));
});

it('requires a bend but retains a clear route through the western passage', () => {
  const cells = new SceneryCells(fixture().authored);
  const blocked = (x: number, z: number) => cells.blocked(x, z);
  expect(clearLine(...DOWNS_WALK_START, ...DOWNS_WALK_END, blocked)).toBe(false);
  const passage: [number, number] = [40.802, 46.065];
  expect(blocked(...passage)).toBe(false);
  for (const [a, b] of [[DOWNS_WALK_START, passage], [passage, DOWNS_WALK_END]]) {
    const route = planRoute(...a, ...b, blocked);
    expect(route).not.toBeNull();
    let previous = a;
    for (const next of route!) {
      expect(clearLine(...previous, ...next, blocked)).toBe(true);
      previous = next;
    }
    expect(previous).toEqual(b);
  }
});
