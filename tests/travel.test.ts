import { describe, expect, it } from 'vitest';
import { advanceClock, clockTide, MARCH_KMH } from '../src/core/travel';
import { Terrain } from '../src/render/terrain';

describe('campaign travel',()=>{
  it('converts a kilometre march to 15 minutes and wraps midnight',()=>{
    const seconds=1/MARCH_KMH*3600;
    expect(seconds).toBe(900);
    expect(advanceClock(23.9,seconds)).toBeCloseTo(.15);
  });
  it('floods at night and exposes the basin during the day',()=>{
    expect(clockTide(12)).toBe(0);expect(clockTide(23)).toBe(1);
    expect(clockTide(6)).toBeCloseTo(.5);expect(clockTide(18)).toBeCloseTo(.5);
    expect(clockTide(47)).toBe(clockTide(23));
  });
  it('places ground viewpoints on terrain triangles rather than the bilinear saddle',()=>{
    const terrain=new Terrain({});
    terrain.leafKm=32;
    const saddle=(x:number,z:number)=>x*z*100;
    expect(terrain.surfaceHeightAt(.25,.75,saddle)).toBeCloseTo(25);
    expect(terrain.surfaceHeightAt(1.25,.25,saddle)).toBeCloseTo(25);
  });
});
