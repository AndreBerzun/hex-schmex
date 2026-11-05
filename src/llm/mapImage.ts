// A small top-down hillshade + surface-colour map with the hex grid and hex labels drawn on, so the model
// can see the map (BRIEF §5). Pure TS raster (works in the browser and the CLI); encode with core/png.

import { hexCenter, hexId, makeGrid, pointToHex } from '../core/hex';
import type { World } from '../core/types';
import type { TerrainProbe } from './probe';

export interface Raster { width: number; height: number; rgba: Uint8Array }

const SURFACE_RGB: Record<string, [number, number, number]> = {
  water: [46, 86, 130], snow: [236, 238, 242], rock: [128, 120, 112], forest: [62, 98, 56], grassland: [128, 150, 84],
  steppe: [168, 160, 104], desert: [212, 190, 140], badlands: [176, 120, 84], marsh: [88, 116, 84], river: [70, 120, 170],
  playa: [222, 214, 196], alpine: [140, 140, 110], 'lake basin': [90, 130, 150],
};

// 3x5 digit font
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001001010010', '111101111101111', '111101111001111'];

export function renderMapImage(world: World, probe: TerrainProbe, width = 800): Raster {
  const grid = makeGrid(world.grid);
  const kmPerPx = grid.widthKm / width;
  const height = Math.round(grid.heightKm / kmPerPx);
  const rgba = new Uint8Array(width * height * 4);
  const hex = new Int32Array(width * height);
  const cell = kmPerPx * 1000;
  // sun from the NW, 45° up
  const L = [-0.5, -0.5, 0.707];
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const x = (i + 0.5) * kmPerPx, y = (j + 0.5) * kmPerPx;
    const h = probe.heightAt(x, y);
    const gx = (probe.heightAt(x + kmPerPx, y) - probe.heightAt(x - kmPerPx, y)) / (2 * cell);
    const gy = (probe.heightAt(x, y + kmPerPx) - probe.heightAt(x, y - kmPerPx)) / (2 * cell);
    const s = probe.surfaceAt(x, y, h, Math.hypot(gx, gy));
    // exaggerate relief x3 so hills read at this scale
    const nx = -gx * 3, ny = -gy * 3, len = Math.hypot(nx, ny, 1);
    const shade = s.water ? 1 : Math.max(0.25, Math.min(1.35, ((nx * L[0] + ny * L[1] + L[2]) / len) * 1.25));
    const c = SURFACE_RGB[s.mat] ?? SURFACE_RGB.grassland;
    const k = (j * width + i) * 4;
    rgba[k] = Math.min(255, c[0] * shade); rgba[k + 1] = Math.min(255, c[1] * shade); rgba[k + 2] = Math.min(255, c[2] * shade); rgba[k + 3] = 255;
    const hx = pointToHex(grid, [x, y]);
    hex[j * width + i] = hx.col >= 1 && hx.col <= grid.cols && hx.row >= 1 && hx.row <= grid.rows ? hx.col * 1000 + hx.row : -1;
  }
  // hex outlines
  for (let j = 0; j < height - 1; j++) for (let i = 0; i < width - 1; i++) {
    const a = hex[j * width + i];
    if (a !== hex[j * width + i + 1] || a !== hex[(j + 1) * width + i]) {
      const k = (j * width + i) * 4;
      for (let c = 0; c < 3; c++) rgba[k + c] = Math.round(rgba[k + c] * 0.35 + 20);
    }
  }
  // labels: hex id at the top of each hex
  const scale = Math.max(1, Math.round(grid.flat / kmPerPx / 22));
  for (let r = 1; r <= grid.rows; r++) for (let c = 1; c <= grid.cols; c++) {
    const [cx, cy] = hexCenter(grid, c, r);
    const id = hexId(c, r);
    const tw = (id.length * 4 - 1) * scale;
    const x0 = Math.round(cx / kmPerPx - tw / 2), y0 = Math.round((cy - grid.flat * 0.36) / kmPerPx);
    drawText(rgba, width, height, id, x0, y0, scale);
  }
  return { width, height, rgba };
}

function drawText(rgba: Uint8Array, w: number, h: number, s: string, x0: number, y0: number, scale: number) {
  const put = (x: number, y: number, v: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const k = (y * w + x) * 4;
    rgba[k] = rgba[k + 1] = rgba[k + 2] = v;
  };
  // halo then glyph
  for (const pass of [0, 1]) {
    for (let n = 0; n < s.length; n++) {
      const g = DIGITS[s.charCodeAt(n) - 48];
      if (!g) continue;
      for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
        if (g[gy * 3 + gx] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
          const px = x0 + (n * 4 + gx) * scale + sx, py = y0 + gy * scale + sy;
          if (pass === 0) { for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) put(px + ox, py + oy, 250); }
          else put(px, py, 15);
        }
      }
    }
  }
}
