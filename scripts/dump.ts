// Debug: evaluate a world on the CPU and write a hillshade PNG. Usage: tsx scripts/dump.ts worlds/x.json out.png [res]
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { evaluate } from '../src/core/ops';
import { encodeRGB8 } from '../src/core/png';
import { loadWorld } from '../src/core/world';

const [file, out = 'shots/_tmp/dump.png', resArg] = process.argv.slice(2);
const world = loadWorld(JSON.parse(readFileSync(file, 'utf8')));
const t0 = performance.now();
const hf = evaluate(world, { res: resArg ? +resArg : undefined });
console.log(`evaluate ${hf.nx}x${hf.ny} ${world.ops.length} ops: ${(performance.now() - t0).toFixed(0)} ms`);
let lo = Infinity, hi = -Infinity;
for (const v of hf.height) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
console.log(`height range ${lo.toFixed(0)}..${hi.toFixed(0)} m`);
const rgba = new Uint8Array(hf.nx * hf.ny * 4);
const cell = hf.kmPerPx * 1000;
for (let j = 0; j < hf.ny; j++) for (let i = 0; i < hf.nx; i++) {
  const k = j * hf.nx + i;
  const h = hf.height[k];
  const hx = hf.height[j * hf.nx + Math.min(hf.nx - 1, i + 1)] - hf.height[j * hf.nx + Math.max(0, i - 1)];
  const hy = hf.height[Math.min(hf.ny - 1, j + 1) * hf.nx + i] - hf.height[Math.max(0, j - 1) * hf.nx + i];
  const nx = -hx / (2 * cell) * 2, ny = -hy / (2 * cell) * 2;
  const len = Math.hypot(nx, ny, 1);
  const shade = Math.max(0, (nx * -0.6 + ny * -0.6 + 0.55) / len);
  let r: number, g: number, b: number;
  if (h < world.terrain.seaLevelM) { r = 40; g = 80; b = 140; }
  else { const t = Math.min(1, h / 3500); r = 90 + 150 * t; g = 120 + 110 * t; b = 70 + 170 * t; }
  if (hf.river[k] > 0.5) { r = 50; g = 110; b = 200; }
  rgba[k * 4] = Math.min(255, r * shade * 1.3);
  rgba[k * 4 + 1] = Math.min(255, g * shade * 1.3);
  rgba[k * 4 + 2] = Math.min(255, b * shade * 1.3);
}
encodeRGB8(hf.nx, hf.ny, rgba, async (d) => deflateSync(d)).then((png) => writeFileSync(out, png));
