import type { WorldEnvironment } from './types';

/** Preview fraction is independent of the clock until campaign time is implemented. */
export function tideLevel(environment: WorldEnvironment | undefined, fraction: number): number {
  const t = environment?.tide;
  if (!t) return -100000;
  const k = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  return t.lowM + (t.highM - t.lowM) * k;
}
export function tideAt(environment: WorldEnvironment | undefined, fraction: number, x: number, z: number): number {
  const t = environment?.tide;
  if (!t) return -100000;
  return !t.center || Math.hypot(x - t.center[0], z - t.center[1]) < (t.radiusKm ?? Infinity) ? tideLevel(environment, fraction) : -100000;
}
