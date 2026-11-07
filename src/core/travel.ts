/** Prototype campaign assumptions; simulation time, not animation speed, determines travel. */
export const MARCH_KMH = 4;
export const EYE_M = 1.7;
export function wrapHour(hour: number) { return ((hour % 24) + 24) % 24; }
export function advanceClock(hour: number, seconds: number) { return wrapHour(hour + seconds / 3600); }
export function clockTide(hour: number) {
  const h = wrapHour(hour);
  const smooth = (v: number) => { const k = Math.max(0, Math.min(1, v)); return k*k*(3-2*k); };
  return h < 12 ? 1-smooth((h-5)/2) : smooth((h-17)/2);
}
