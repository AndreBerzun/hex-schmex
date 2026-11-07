import { describe, expect, it } from 'vitest';
import raw from '../worlds/forgotten-shore.json';
import { loadWorld, serializeWorld } from '../src/core/world';
import { tideAt, tideLevel } from '../src/core/environment';
import { fieldProbe } from '../src/agent/probe';
import { evaluate } from '../src/core/ops';
import { normalizeOp } from '../src/core/opSchema';

const world = loadWorld(raw);
describe('Forgotten Shore geography', () => {
  it('preserves landmark dimensions, tide and camera presets across save/load', () => {
    const copy = loadWorld(JSON.parse(serializeWorld(world)));
    expect(copy.features).toEqual(world.features);
    expect(copy.environment).toEqual(world.environment);
    expect(copy.meta.views).toEqual(world.meta.views);
    expect(copy.meta.preview).toEqual(world.meta.preview);
  });
  it('keeps the inhabited wall circuit above high water, with an elevated castle', () => {
    const probe = fieldProbe(world, evaluate(world));
    const city = world.features.find((f) => f.id === 'dark-city')!;
    const [x, z] = city.pos!;
    const high = world.environment!.tide!.highM;
    for (let i = 0; i < 64; i++) {
      const a = i * Math.PI / 32;
      expect(probe.heightAt(x + Math.cos(a) * city.radiusKm!, z + Math.sin(a) * city.radiusKm!)).toBeGreaterThan(high + 150);
    }
    expect(probe.heightAt(x, z)).toBeGreaterThan(probe.heightAt(x + .8, z) + 60);
    expect(probe.heightAt(31, 35)).toBeLessThan(high);
    expect(probe.heightAt(31, 35)).toBeGreaterThan(world.environment!.tide!.lowM);
  });
  it('supports sub-kilometre terrain ridges without silently widening them', () => {
    const op = normalizeOp(world, { type: 'ridge', points: [[20, 30], [22, 31]], width: .25 });
    expect(op.type === 'ridge' && op.width).toBe(.25);
  });
  it('limits the flood to the crater and clamps preview inputs', () => {
    const e = world.environment;
    expect(tideAt(e, 1, 31, 35)).toBe(80);
    expect(tideAt(e, 1, 60, 60)).toBe(-100000);
    expect(tideLevel(e, -1)).toBe(-260);
    expect(tideLevel(e, 2)).toBe(80);
    expect(tideLevel(e, NaN)).toBe(-260);
    expect(tideLevel(undefined, 1)).toBe(-100000);
  });
});
