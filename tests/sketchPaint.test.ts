import { describe, expect, it } from 'vitest';
import { fillRegion, medianColour, paintDisc, paintLine, paintedShare } from '../src/sketch/paint';
import { swatchName } from '../src/sketch/palette';

describe('sketch paint', () => {
  it('takes the median of each channel, not the mean', () => {
    const px = [[10, 200, 0], [20, 210, 0], [30, 220, 0], [250, 0, 255], [40, 230, 0]];
    expect(medianColour(px.flatMap((p) => [...p, 255]))).toEqual([30, 210, 0]);
  });

  it('colours a disc and leaves the ground outside it alone', () => {
    const cells = new Uint8Array(101 * 101);
    paintDisc(cells, 101, 101, 1, 50, 50, 10, 3);
    expect(cells[50 * 101 + 50]).toBe(3);
    expect(cells[50 * 101 + 60]).toBe(3);
    expect(cells[50 * 101 + 61]).toBe(0);
    expect(cells[58 * 101 + 58]).toBe(0);
  });

  it('leaves no gaps when the pointer jumps', () => {
    const cells = new Uint8Array(101 * 101);
    paintLine(cells, 101, 101, 1, [10, 50], [90, 50], 2, 1);
    for (let i = 10; i <= 90; i++) expect(cells[50 * 101 + i]).toBe(1);
  });

  it('fills up to an outline and to the shoreline, not past them', () => {
    const cells = new Uint8Array(21 * 21);
    for (let n = 5; n <= 15; n++) cells[5 * 21 + n] = cells[15 * 21 + n] = cells[n * 21 + 5] = cells[n * 21 + 15] = 1;
    const dry = (k: number) => k % 21 < 12;
    fillRegion(cells, 21, 21, 10, 10, 2, (k) => dry(k) === dry(10 * 21 + 10));
    expect(cells[10 * 21 + 10]).toBe(2);
    expect(cells[10 * 21 + 11]).toBe(2);
    expect(cells[10 * 21 + 12]).toBe(0);
    expect(cells[5 * 21 + 10]).toBe(1);
    expect(cells[2 * 21 + 2]).toBe(0);
    expect(fillRegion(cells, 21, 21, 10, 10, 2, () => true)).toBeNull();
  });

  it('reports how much of the map each texture covers', () => {
    const cells = new Uint8Array([0, 2, 2, 1]);
    expect(paintedShare(cells, ['ash-dust', 'coral-turf'])).toEqual({ 'ash-dust': 0.25, 'coral-turf': 0.5 });
  });

  it('names a texture after its Shore biome', () => {
    expect(swatchName('../render/textures/mire-reed.jpg')).toMatchObject({ key: 'mire-reed', biome: 'Silt Mires', label: 'reed' });
    expect(swatchName('../render/textures/lava-crust.jpg')).toMatchObject({ key: 'lava-crust', biome: 'lava', label: 'crust' });
  });
});
