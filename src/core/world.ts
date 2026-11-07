// World defaults, validation/migration and (de)serialisation.

import { normalizeOp } from './opSchema';
import type { ErosionSettings, World } from './types';

export const EROSION_PRESETS: Record<ErosionSettings['preset'], Pick<ErosionSettings, 'iterations' | 'strength' | 'rain' | 'thermal'>> = {
  light: { iterations: 160, strength: 0.6, rain: 1.0, thermal: 0.5 },
  medium: { iterations: 320, strength: 1.0, rain: 1.0, thermal: 0.7 },
  heavy: { iterations: 600, strength: 1.4, rain: 1.2, thermal: 0.9 },
};

export function defaultWorld(name = 'Untitled marches'): World {
  const now = new Date().toISOString();
  return {
    version: 1,
    seed: 1337,
    grid: { cols: 10, rows: 10, hexMiles: 6, orientation: 'flat' },
    terrain: { seaLevelM: 0, maxElevationM: 4500, designRes: 640, erodedRes: 1280 },
    base: { type: 'mixed', elevation: 260, amplitude: 260, wavelengthKm: 48, octaves: 7, warpKm: 18 },
    ops: [],
    erosion: { enabled: true, preset: 'medium', ...EROSION_PRESETS.medium, talusDeg: 34 },
    climate: { windFromDeg: 260, baseMoisture: 0.55, snowlineM: 2700, treelineM: 2100, temperature: 0 },
    features: [],
    meta: { name, createdAt: now, updatedAt: now },
  };
}

/** Fill in missing fields (older/hand-written files) and normalise ops. */
export function loadWorld(raw: unknown): World {
  if (!raw || typeof raw !== 'object') throw new Error('world JSON must be an object');
  const r = raw as Partial<World> & { ops?: unknown[] };
  const d = defaultWorld(r.meta?.name);
  const w: World = {
    version: 1,
    seed: Number.isFinite(r.seed) ? (r.seed as number) : d.seed,
    grid: { ...d.grid, ...(r.grid ?? {}) },
    terrain: { ...d.terrain, ...(r.terrain ?? {}) },
    base: { ...d.base, ...(r.base ?? {}) },
    ops: [],
    erosion: { ...d.erosion, ...(r.erosion ?? {}) },
    climate: { ...d.climate, ...(r.climate ?? {}) },
    features: Array.isArray(r.features) ? r.features : [],
    environment: r.environment,
    meta: { ...d.meta, ...(r.meta ?? {}) },
  };
  const re = r.erosion as Partial<ErosionSettings> | undefined;
  if (re?.preset && EROSION_PRESETS[re.preset] && re.iterations === undefined) Object.assign(w.erosion, EROSION_PRESETS[re.preset], re, EROSION_PRESETS[re.preset]);
  for (const o of r.ops ?? []) w.ops.push(normalizeOp(w, o as unknown as Record<string, unknown>));
  return w;
}

export function serializeWorld(w: World): string {
  return JSON.stringify({ ...w, meta: { ...w.meta, updatedAt: new Date().toISOString() } }, null, 2);
}

export function cloneWorld(w: World): World {
  return JSON.parse(JSON.stringify(w));
}

/** Set a nested world param by dotted path, e.g. "climate.snowlineM". Returns the old value. */
export function setWorldParam(w: World, path: string, value: unknown): unknown {
  const allowed = /^(seed|grid\.(cols|rows|hexMiles|orientation)|terrain\.(seaLevelM|maxElevationM|designRes|erodedRes)|base\.\w+|erosion\.\w+|climate\.\w+|meta\.(name|notes))$/;
  if (!allowed.test(path)) throw new Error(`cannot set "${path}"`);
  const keys = path.split('.');
  let o = w as unknown as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] as Record<string, unknown>;
  const k = keys[keys.length - 1];
  const old = o[k];
  if (typeof old === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`${path} must be a number`);
    o[k] = n;
  } else if (typeof old === 'boolean') o[k] = !!value;
  else o[k] = value;
  if (path === 'erosion.preset') {
    const p = EROSION_PRESETS[value as ErosionSettings['preset']];
    if (p) Object.assign(w.erosion, p);
  }
  return old;
}
