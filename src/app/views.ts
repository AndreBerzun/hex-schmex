// Default camera presets (BRIEF §11). Worlds can override any of them in meta.views.
import type { App } from './app';
import type { ViewSpec, Vec2 } from '../core/types';

export const viewNames = ['region-oblique', 'region-topdown', 'range-mid', 'valley-low', 'hex-closeup'];

export function defaultViews(app: App): Record<string, ViewSpec> {
  const s = app.heightSrc;
  const W = app.worldW, H = app.worldH;
  let peak: Vec2 = [W / 2, H / 2];
  if (s) {
    let best = -Infinity;
    for (let j = 0; j < s.ny; j += 2) for (let i = 0; i < s.nx; i += 2) {
      const v = s.cpu[j * s.nx + i];
      if (v > best) { best = v; peak = [(i + 0.5) * s.kmPerPx, (j + 0.5) * s.kmPerPx]; }
    }
  }
  const south = peak[1] < H * 0.7 ? 1 : -1;
  return {
    'range-mid': { from: [peak[0] - 12, Math.min(H, Math.max(0, peak[1] + south * 42))], fromAbsM: 7000, to: peak, toAglM: -800 },
    'valley-low': { from: [peak[0] + 4, Math.min(H - 1, Math.max(1, peak[1] + south * 28))], fromAglM: 220, to: peak, toAglM: -400 },
    'hex-closeup': { from: [peak[0], peak[1] + south * 11], fromAglM: 5200, to: [peak[0], peak[1] + south * 1.5] },
  };
}
