// Op parameter descriptors: shared by the ops panel form, the LLM tool schema and the loose-op normaliser.

import { Resolver } from './resolve';
import type { BlendMode, Op, OpType, World } from './types';

export type ParamKind = 'number' | 'enum' | 'bool' | 'points' | 'point' | 'region' | 'side';

export interface ParamDesc {
  key: string;
  kind: ParamKind;
  help: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  optional?: boolean;
  default?: unknown;
}

export interface OpDesc {
  type: OpType;
  summary: string;
  params: ParamDesc[];
}

const num = (key: string, def: number, min: number, max: number, step: number, help: string, optional = false): ParamDesc =>
  ({ key, kind: 'number', default: def, min, max, step, help, optional });

export const OP_DESCS: OpDesc[] = [
  {
    type: 'ridge', summary: 'Mountain range / spine along a polyline. Ridged noise, peaks and saddles along the crest.',
    params: [
      { key: 'points', kind: 'points', help: 'crest line, 2+ points' },
      num('height', 2200, 0, 6000, 50, 'metres added at the crest'),
      num('width', 18, 0.1, 80, 0.1, 'half-width of the range base, km'),
      num('sharpness', 0.6, 0, 1, 0.05, '0 rounded .. 1 knife-edge'),
      num('roughness', 0.6, 0, 1, 0.05, '0 smooth .. 1 broken crest with spurs'),
      num('asymmetry', 0, -1, 1, 0.05, '>0 right side (of line direction) steeper'),
    ],
  },
  {
    type: 'peak', summary: 'Single mountain or volcano.',
    params: [
      { key: 'center', kind: 'point', help: 'summit position' },
      num('height', 2000, 0, 6000, 50, 'metres added at the summit'),
      num('radius', 10, 0.5, 60, 0.5, 'base radius, km'),
      { key: 'shape', kind: 'enum', options: ['cone', 'dome', 'massif', 'volcano'], default: 'massif', help: 'volcano adds a crater' },
    ],
  },
  {
    type: 'plateau', summary: 'Mesa / tableland with an escarpment edge; optional terraces.',
    params: [
      { key: 'region', kind: 'region', help: 'top of the plateau' },
      num('height', 1200, -500, 5000, 25, 'absolute elevation of the top, m'),
      num('edgeSteepness', 0.7, 0, 1, 0.05, '0 ramp .. 1 cliff'),
      num('terraces', 0, 0, 8, 1, 'terrace steps on the edge'),
    ],
  },
  {
    type: 'basin', summary: 'Depression (lake basin, sink).',
    params: [
      { key: 'region', kind: 'region', help: 'area of the basin' },
      num('depth', 300, 0, 2000, 10, 'metres lowered at the centre'),
      num('falloffKm', 8, 0.5, 40, 0.5, 'rim width, km'),
    ],
  },
  {
    type: 'valley', summary: 'Valley along a polyline. Floor always descends from source to mouth. U = glacial.',
    params: [
      { key: 'points', kind: 'points', help: 'valley axis from head to mouth' },
      num('depth', 400, 0, 3000, 10, 'metres below the line terrain'),
      num('width', 6, 0.5, 40, 0.5, 'half-width at the rim, km'),
      { key: 'profile', kind: 'enum', options: ['V', 'U'], default: 'V', help: 'U = glacial trough' },
    ],
  },
  {
    type: 'river', summary: 'River channel that always flows downhill, with a floodplain. Marks the river mask.',
    params: [
      { key: 'points', kind: 'points', help: 'river course from source to mouth' },
      num('width', 0.4, 0.05, 5, 0.05, 'channel width, km'),
      num('depth', 25, 1, 300, 1, 'channel depth below the banks, m'),
      num('floodplainKm', 3, 0, 30, 0.5, 'gentle floodplain on each side, km', true),
    ],
  },
  {
    type: 'canyon', summary: 'Steep-walled cut with stepped walls.',
    params: [
      { key: 'points', kind: 'points', help: 'canyon course' },
      num('depth', 600, 10, 3000, 10, 'metres'),
      num('width', 4, 0.3, 30, 0.1, 'full width at the rim, km'),
      num('wallSteepness', 0.8, 0, 1, 0.05, '0..1'),
    ],
  },
  {
    type: 'coast', summary: 'Pushes an area below sea level: sea, bay, fjord. Use side+extentKm for a coast along a map edge, or region.',
    params: [
      { key: 'side', kind: 'side', help: 'map side the sea is on', optional: true },
      num('extentKm', 25, 0, 200, 1, 'how far the sea reaches in from that side, km', true),
      { key: 'region', kind: 'region', help: 'area that becomes sea (instead of side)', optional: true },
      num('targetElevation', -250, -3000, 0, 10, 'sea floor elevation, m'),
      num('falloffKm', 12, 0.5, 60, 0.5, 'shelf width, km'),
      num('roughness', 0.6, 0, 1, 0.05, 'coastline irregularity', true),
    ],
  },
  {
    type: 'hills', summary: 'Noise field over an area: rolling hills, rugged hills or dunes.',
    params: [
      { key: 'region', kind: 'region', help: 'area' },
      num('amplitude', 250, 0, 2000, 10, 'metres'),
      num('wavelengthKm', 6, 0.5, 60, 0.5, 'size of a hill, km'),
      { key: 'style', kind: 'enum', options: ['rolling', 'rugged', 'dunes'], default: 'rolling', help: '' },
      num('falloffKm', 6, 0, 40, 0.5, 'edge falloff, km', true),
    ],
  },
  {
    type: 'lowlands', summary: 'Flattens an area toward a target elevation: plains, marsh.',
    params: [
      { key: 'region', kind: 'region', help: 'area' },
      num('targetElevation', 120, -200, 3000, 5, 'metres'),
      num('flatness', 0.8, 0, 1, 0.05, 'how much relief is removed'),
      num('falloffKm', 8, 0, 40, 0.5, 'edge falloff, km', true),
    ],
  },
  {
    type: 'escarpment', summary: 'Cliff line with high ground on one side.',
    params: [
      { key: 'points', kind: 'points', help: 'cliff line' },
      num('heightDelta', 400, -3000, 3000, 10, 'metres the high side is raised'),
      { key: 'side', kind: 'enum', options: ['left', 'right'], default: 'right', help: 'high side relative to line direction' },
      num('width', 1.5, 0.1, 20, 0.1, 'cliff transition, km'),
      num('reachKm', 25, 1, 120, 1, 'how far the raised ground extends, km', true),
    ],
  },
  {
    type: 'smooth', summary: 'Softens relief in an area.',
    params: [
      { key: 'region', kind: 'region', help: 'area' },
      num('strength', 0.5, 0, 1, 0.05, '0..1'),
      num('falloffKm', 3, 0, 30, 0.5, 'edge falloff, km', true),
    ],
  },
  {
    type: 'roughen', summary: 'Adds broken, rocky relief in an area.',
    params: [
      { key: 'region', kind: 'region', help: 'area' },
      num('strength', 0.5, 0, 1, 0.05, '0..1'),
      num('falloffKm', 3, 0, 30, 0.5, 'edge falloff, km', true),
    ],
  },
  {
    type: 'moisture', summary: 'Biases surface moisture (not height): + forest/swamp, - steppe/desert.',
    params: [
      { key: 'region', kind: 'region', help: 'area' },
      num('delta', 0.4, -1, 1, 0.05, '-1 dry .. +1 wet'),
      num('falloffKm', 6, 0, 40, 0.5, 'edge falloff, km', true),
    ],
  },
  {
    type: 'stroke', summary: 'A recorded brush stroke.',
    params: [
      { key: 'brush', kind: 'enum', options: ['raise', 'lower', 'smooth', 'flatten', 'ridge', 'carve', 'roughen', 'erode', 'moisture'], default: 'raise', help: '' },
      { key: 'points', kind: 'points', help: 'stroke path' },
      num('radius', 5, 0.1, 60, 0.1, 'km'),
      num('strength', 0.5, 0, 1, 0.05, '0..1'),
      num('falloff', 0.7, 0, 1, 0.05, '0 hard .. 1 soft'),
      num('targetHeight', 500, -1000, 6000, 10, 'flatten target, m', true),
      { key: 'river', kind: 'bool', default: false, help: 'carve: mark as river', optional: true },
      { key: 'invert', kind: 'bool', default: false, help: 'invert effect', optional: true },
    ],
  },
];

export const OP_DESC_BY_TYPE = Object.fromEntries(OP_DESCS.map((d) => [d.type, d])) as Record<OpType, OpDesc>;

export const BLEND_MODES: BlendMode[] = ['add', 'max', 'min', 'replace', 'multiply'];

let idCounter = 0;
export function newOpId(type: string, existing: Iterable<string> = []): string {
  const taken = new Set(existing);
  for (;;) {
    idCounter++;
    const id = `${type}-${Date.now().toString(36).slice(-4)}${idCounter.toString(36)}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * Turn a loose op (from the LLM, the UI, or a hand-written JSON) into a stored Op:
 * fills defaults, resolves hex ids / compass words into km, keeps the original expressions in `expr`.
 */
export function normalizeOp(world: World, loose: Record<string, unknown>, opts: { id?: string; source?: Op['source'] } = {}): Op {
  const type = loose.type as OpType;
  const desc = OP_DESC_BY_TYPE[type];
  if (!desc) throw new Error(`unknown op type "${String(loose.type)}"`);
  const res = new Resolver(world);
  const out: Record<string, unknown> = {
    id: (loose.id as string) || opts.id || newOpId(type, world.ops.map((o) => o.id)),
    type,
    enabled: loose.enabled !== false,
    label: (loose.label as string) || `${type}`,
    source: (loose.source as string) || opts.source || 'manual',
  };
  if (loose.blend) out.blend = loose.blend;
  const expr: Record<string, unknown> = { ...((loose.expr as Record<string, unknown>) ?? {}) };
  for (const p of desc.params) {
    const v = loose[p.key];
    if (v === undefined || v === null) {
      if (!p.optional && p.default !== undefined) out[p.key] = p.default;
      continue;
    }
    switch (p.kind) {
      case 'number': {
        let n = Number(v);
        if (!Number.isFinite(n)) throw new Error(`${type}.${p.key} must be a number`);
        if (p.min !== undefined) n = Math.max(n, p.min);
        if (p.max !== undefined) n = Math.min(n, p.max);
        out[p.key] = n;
        break;
      }
      case 'points':
        if (!isResolvedPoints(v)) expr[p.key] = v;
        out[p.key] = res.points(v);
        break;
      case 'point':
        if (!isResolvedPoint(v)) expr[p.key] = v;
        out[p.key] = res.point(v as never);
        break;
      case 'region':
        if (!(typeof v === 'object' && v && 'kind' in v)) expr[p.key] = v;
        out[p.key] = res.region(v);
        break;
      case 'side':
        out[p.key] = String(v).toUpperCase();
        break;
      default:
        out[p.key] = v;
    }
  }
  if (loose.mask) {
    const m = loose.mask as Record<string, unknown>;
    out.mask = { region: res.region(m.region), falloffKm: Number(m.falloffKm ?? 5), invert: !!m.invert };
  }
  if (Object.keys(expr).length) out.expr = expr;
  // type-specific sanity
  if (type === 'coast' && !out.side && !out.region) out.side = 'W';
  return out as unknown as Op;
}

function isResolvedPoint(v: unknown): boolean {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number';
}
function isResolvedPoints(v: unknown): boolean {
  return Array.isArray(v) && v.every(isResolvedPoint);
}
