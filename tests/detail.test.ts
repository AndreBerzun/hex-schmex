import { expect, it } from 'vitest';
import { buildDetailMask, coverFields, coverFrom, downsDetail } from '../src/core/detail';

it('reports the slope of the height it returns', () => {
  const e = 0.0001;
  for (const [x, z] of [[40.83, 45.9], [12.3456, 7.891], [88.01, 101.77], [40.9, 46.1]]) {
    const at = (a: number, b: number) => downsDetail(a, b, 0, 5150).h;
    const d = downsDetail(x, z, 0, 5150);
    expect(d.gx).toBeCloseTo((at(x + e, z) - at(x - e, z)) / (2 * e * 1000), 3);
    expect(d.gz).toBeCloseTo((at(x, z + e) - at(x, z - e)) / (2 * e * 1000), 3);
  }
});

it('reports the slope on knoll slabs too', () => {
  const e = 0.00002;
  let checked = 0;
  for (let i = 0; i < 4000 && checked < 20; i++) {
    const x = 40 + (i % 63) * 0.0137, z = 45 + Math.floor(i / 63) * 0.0137;
    const d = downsDetail(x, z, 0, 5150);
    if (d.knoll < 0.3) continue;
    const at = (a: number, b: number) => downsDetail(a, b, 0, 5150).h;
    const nx = (at(x + e, z) - at(x - e, z)) / (2 * e * 1000), nz = (at(x, z + e) - at(x, z - e)) / (2 * e * 1000);
    if (Math.abs(nx - d.gx) > 0.05 * (1 + Math.abs(nx))) expect([x, z, d.gx]).toEqual([x, z, nx]);
    if (Math.abs(nz - d.gz) > 0.05 * (1 + Math.abs(nz))) expect([x, z, d.gz]).toEqual([x, z, nz]);
    checked++;
  }
  expect(checked).toBe(20);
});

it('is seeded and fades fine relief with mesh spacing', () => {
  expect(downsDetail(40.83, 45.9, 3, 5150).h).toBe(downsDetail(40.83, 45.9, 3, 5150).h);
  expect(downsDetail(40.83, 45.9, 3, 5150).h).not.toBe(downsDetail(40.83, 45.9, 3, 5151).h);
  expect(Math.abs(downsDetail(40.83, 45.9, 1000, 5150).h)).toBe(0);
});

it('keeps detail off ground that is not downs, with a margin', () => {
  const mask = buildDetailMask(10, 10, 1, (x) => (x < 5 ? 1 : -1));
  expect(mask.at(2, 5)).toBeGreaterThan(0);
  expect(mask.at(4.9, 5)).toBe(0);
  expect(mask.at(7, 5)).toBe(0);
});

const cover = (x: number, z: number, mask = 1) => {
  const d = downsDetail(x, z, 5.3, 5150);
  return { d, c: coverFrom(coverFields(x, z, 5.3, 5150, d, mask, { rock: 0, apron: 0, hollow: 0, grass: 0 }), mask, d.gx, d.gz) };
};
const grid = (f: (x: number, z: number) => void) => {
  for (let j = 0; j < 80; j++) for (let i = 0; i < 80; i++) f(40.6 + i * 0.01, 45.9 + j * 0.01);
};

it('turns knoll crests to rock and their lower flanks to gravel, nothing else', () => {
  let rock = 0, apron = 0;
  grid((x, z) => {
    const { d, c } = cover(x, z);
    if (c.rock > 0.5) { rock++; expect(d.knoll).toBeGreaterThan(0.45); }
    if (c.apron > 0.5) { apron++; expect(d.knoll).toBeGreaterThan(0.03); expect(d.knoll).toBeLessThan(0.6); }
  });
  expect(rock).toBeGreaterThan(20);
  expect(apron).toBeGreaterThan(20);
});

it('grows grass in patches only where the detail ground is', () => {
  let grass = 0, n = 0;
  grid((x, z) => { n++; if (cover(x, z).c.grass > 0.5) grass++; expect(cover(x, z, 0).c.grass).toBe(0); });
  expect(grass / n).toBeGreaterThan(0.3);
  expect(grass / n).toBeLessThan(0.9);
});
