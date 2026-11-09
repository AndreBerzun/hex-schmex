import { computeHydrology, downsample, resample } from '../core/hydrology';
import { applySculpt, foundationKey, rasterPaint, type Field, type Foundation } from '../core/layers';
import { evaluate } from '../core/ops';
import type { World } from '../core/types';
import { fieldProbe, type TerrainProbe } from './probe';

export interface LayeredProbe {
  probe: TerrainProbe;
  source: 'bake' | 'design';
}

export function bakeMatches(world: World, bake: Foundation | null): boolean {
  return !!bake && bake.key === foundationKey(world);
}

export function layeredProbe(world: World, opts: { res?: number; bake?: Foundation | null } = {}): LayeredProbe {
  const hf = evaluate(world, { res: opts.res ?? 384 });
  const bake = bakeMatches(world, opts.bake ?? null) ? opts.bake! : null;
  const field: Field = bake
    ? { height: bake.height.slice(), nx: bake.nx, ny: bake.ny, kmPerPx: bake.kmPerPx }
    : { height: hf.height.slice(), nx: hf.nx, ny: hf.ny, kmPerPx: hf.kmPerPx };
  applySculpt(world, field);
  const paint = world.paint.length ? rasterPaint(world, 512) : null;
  if (!bake) return { probe: fieldProbe(world, hf, { height: field, paint, kind: 'design' }), source: 'design' };
  const f = Math.max(1, Math.round(Math.max(field.nx, field.ny) / 1024));
  const ds = downsample(field.height, field.nx, field.ny, f);
  const kmPerPx = field.kmPerPx * f;
  const out = computeHydrology({
    nx: ds.nx, ny: ds.ny, kmPerPx, height: ds.data, seaLevelM: world.terrain.seaLevelM, climate: world.climate,
    moistureBias: resample(hf.moisture, hf.nx, hf.ny, ds.nx, ds.ny),
    lakeIntent: resample(hf.lake, hf.nx, hf.ny, ds.nx, ds.ny),
  });
  const hydro = { nx: ds.nx, ny: ds.ny, kmPerPx, moisture: out.moisture, logArea: out.logArea, waterKind: out.waterKind };
  return { probe: fieldProbe(world, hf, { height: field, paint, hydro, kind: 'eroded' }), source: 'bake' };
}
