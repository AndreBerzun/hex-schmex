import { describe, expect, it } from 'vitest';
import raw from '../worlds/forgotten-shore.json';
import { loadWorld, serializeWorld } from '../src/core/world';
import { tideAt, tideLevel } from '../src/core/environment';
import { fieldProbe } from '../src/agent/probe';
import { evaluate } from '../src/core/ops';
import { normalizeOp } from '../src/core/opSchema';
import { surfaceName } from '../src/core/surfaces';

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
    expect(probe.heightAt(74.83, 114.83)).toBeLessThan(high);
    expect(probe.heightAt(74.83, 114.83)).toBeGreaterThan(world.environment!.tide!.lowM);
  });
  it('puts the city near the centre, below the mountains', () => {
    const hf = evaluate(world);
    const city = world.features.find((f) => f.id === 'dark-city')!;
    const w = hf.nx * hf.kmPerPx, h = hf.ny * hf.kmPerPx;
    expect(Math.hypot(city.pos![0] - w / 2, city.pos![1] - h / 2)).toBeLessThan(5);
    const castle = fieldProbe(world, hf).heightAt(city.pos![0], city.pos![1]);
    let max = -Infinity;
    for (const v of hf.height) max = Math.max(max, v);
    expect(max).toBeGreaterThan(castle + 1500);
  });
  it('supports sub-kilometre terrain ridges without silently widening them', () => {
    const op = normalizeOp(world, { type: 'ridge', points: [[20, 30], [22, 31]], width: .25 });
    expect(op.type === 'ridge' && op.width).toBe(.25);
  });
  it('floods the whole region at night and clamps preview inputs', () => {
    const e = world.environment;
    expect(tideAt(e, 1, 74.83, 114.83)).toBe(120);
    expect(tideAt(e, 1, 5, 5)).toBe(120);
    expect(tideLevel(e, -1)).toBe(0);
    expect(tideLevel(e, 2)).toBe(120);
    expect(tideLevel(e, NaN)).toBe(0);
    expect(tideLevel(undefined, 1)).toBe(-100000);
  });
  it('still limits a tide with a centre to its basin', () => {
    const basin = { tide: { center: [10, 10] as [number, number], radiusKm: 5, lowM: -10, highM: 20 } };
    expect(tideAt(basin, 1, 12, 10)).toBe(20);
    expect(tideAt(basin, 1, 20, 10)).toBe(-100000);
  });
  it('names surfaces in Shore terms', () => {
    expect(surfaceName(world, 'forest', 150, 0.2)).toBe('crimson coral');
    expect(surfaceName(world, 'grassland', 40, 0.02)).toBe('tidal flats');
    expect(surfaceName(world, 'grassland', 400, 0.02)).toBe('black earth');
    expect(surfaceName(world, 'desert', 300, 0.02)).toBe('ash');
    expect(surfaceName({ ...world, environment: undefined }, 'forest', 150, 0.2)).toBe('forest');
  });
});
