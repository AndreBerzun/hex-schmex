// Exports: 16-bit heightmap PNG and screenshots.
import type { App } from '../app/app';
import { browserDeflate, encodeGray16 } from '../core/png';
import type { World } from '../core/types';
import { download } from './dom';
import { slug } from './toolbar';

export async function exportHeightPng(app: App, world: World) {
  const s = app.heightSrc;
  if (!s) return;
  // full range: -maxElev .. +maxElev mapped to 0..1 (sea level = 0.5 when seaLevel = 0)
  const lo = -world.terrain.maxElevationM, hi = world.terrain.maxElevationM;
  const vals = new Float32Array(s.cpu.length);
  for (let i = 0; i < vals.length; i++) vals[i] = (s.cpu[i] - lo) / (hi - lo);
  const png = await encodeGray16(s.nx, s.ny, vals, browserDeflate);
  download(`${slug(world.meta.name)}-height-${s.nx}x${s.ny}.png`, new Blob([png], { type: 'image/png' }));
  console.info(`heightmap: 0 = ${lo} m, 65535 = ${hi} m, ${s.kmPerPx * 1000} m/px`);
}

export async function exportScreenshot(app: App, world: World) {
  app.render();
  const blob = await new Promise<Blob | null>((res) => app.renderer.domElement.toBlob(res, 'image/png'));
  if (blob) download(`${slug(world.meta.name)}-shot.png`, blob);
}
