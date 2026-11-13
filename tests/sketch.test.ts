import { describe, expect, it } from 'vitest';
import { flatField, groundHit, heightAt, stamp } from '../src/sketch/field';

describe('sketch field', () => {
  it('raises most at the brush centre and nothing outside the radius', () => {
    const f = flatField(101, 101, 1, 100);
    stamp(f, { tool: 'raise', x: 50, y: 50, radiusKm: 10, amountM: 300, targetM: 0 });
    expect(heightAt(f, 50, 50)).toBeCloseTo(400, 3);
    expect(heightAt(f, 55, 50)).toBeGreaterThan(100);
    expect(heightAt(f, 55, 50)).toBeLessThan(400);
    expect(heightAt(f, 61, 50)).toBe(100);
  });

  it('flattens toward the height where the stroke started', () => {
    const f = flatField(101, 101, 1, 100);
    stamp(f, { tool: 'raise', x: 50, y: 50, radiusKm: 10, amountM: 500, targetM: 0 });
    for (let n = 0; n < 40; n++) stamp(f, { tool: 'flatten', x: 50, y: 50, radiusKm: 8, amountM: 400, targetM: 250 });
    expect(heightAt(f, 50, 50)).toBeCloseTo(250, 0);
  });

  it('smooths a spike down without moving the ground around it', () => {
    const f = flatField(101, 101, 1, 100);
    f.h[50 * 101 + 50] = 900;
    stamp(f, { tool: 'smooth', x: 50, y: 50, radiusKm: 6, amountM: 400, targetM: 0 });
    expect(heightAt(f, 50, 50)).toBeLessThan(200);
    expect(heightAt(f, 80, 80)).toBe(100);
  });

  it('finds the ground under a ray from above', () => {
    const f = flatField(101, 101, 1, 500);
    const hit = groundHit(f, [20, 10.5, 20], [0.6, -0.8, 0], 0);
    expect(hit![0]).toBeCloseTo(27.5, 0);
    expect(hit![1]).toBeCloseTo(20, 3);
  });
});
