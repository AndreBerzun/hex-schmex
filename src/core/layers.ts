import { bboxOfPoints, clamp, lerp, polylineClosest, polylineInfo, regionBBox, regionMask, smoothstep, type BBox, type PolylineHit } from './geom';
import { mapDims, makeGrid } from './hex';
import { hashString } from './noise';
import { blurRect } from './ops';
import { newOpId } from './opSchema';
import { Resolver, type PointExpr } from './resolve';
import type { Biome, EditArea, OpSource, PaintEdit, SculptEdit, SculptTool, World } from './types';

export interface Field {
  height: Float32Array;
  nx: number;
  ny: number;
  kmPerPx: number;
}

export interface PaintRaster {
  nx: number;
  ny: number;
  kmPerPx: number;
  data: Float32Array;
}

export const SCULPT_TOOLS: SculptTool[] = ['raise', 'lower', 'flatten', 'smooth'];
export const BIOMES: Biome[] = ['open', 'forest', 'marsh', 'desert', 'badlands', 'rock', 'snow', 'tidal', 'erase'];
export const PAINT_CHANNELS = 8;
export const PAINT_COVERAGE = 7;
export const BIOME_CHANNEL: Partial<Record<Biome, number>> = { forest: 0, marsh: 1, desert: 2, badlands: 3, rock: 4, snow: 5, tidal: 6 };
const CHANNEL_BIOME: Biome[] = ['forest', 'marsh', 'desert', 'badlands', 'rock', 'snow', 'tidal'];

const BIOME_ALIASES: Record<string, Biome> = {
  open: 'open', 'open ground': 'open', grassland: 'open', grass: 'open', 'black earth': 'open', steppe: 'open',
  forest: 'forest', coral: 'forest', 'crimson coral': 'forest', 'coral labyrinth': 'forest',
  marsh: 'marsh', mire: 'marsh', 'silt mire': 'marsh', swamp: 'marsh',
  desert: 'desert', ash: 'desert', sand: 'desert',
  badlands: 'badlands', 'ash ridges': 'badlands',
  rock: 'rock', 'mineral rock': 'rock',
  snow: 'snow',
  tidal: 'tidal', 'tidal flats': 'tidal',
  erase: 'erase', clear: 'erase', none: 'erase', auto: 'erase',
};

export function parseBiome(v: unknown): Biome {
  const b = BIOME_ALIASES[String(v ?? '').trim().toLowerCase()];
  if (!b) throw new Error(`unknown biome "${String(v)}"; use one of ${BIOMES.join(', ')} (Shore names like "crimson coral" work too)`);
  return b;
}

interface Prepared {
  box: BBox | null;
  weight(x: number, y: number): number;
}

export function prepareArea(area: EditArea, falloffKm: number): Prepared {
  if (area.kind === 'stroke') {
    const r = Math.max(1e-3, area.radiusKm);
    const core = Math.max(0, r - Math.min(falloffKm, r));
    const info = polylineInfo(area.points);
    const hit: PolylineHit = { d: 0, s: 0, side: 1 };
    return {
      box: bboxOfPoints(area.points, r),
      weight(x, y) {
        const d = polylineClosest(info, x, y, hit, r).d;
        if (d <= core) return 1;
        if (d >= r) return 0;
        return 1 - smoothstep(core, r, d);
      },
    };
  }
  const reg = area.region;
  return { box: regionBBox(reg, falloffKm), weight: (x, y) => regionMask(reg, x, y, falloffKm) };
}

function pxBox(f: { nx: number; ny: number; kmPerPx: number }, b: BBox | null): [number, number, number, number] | null {
  if (!b) return [0, 0, f.nx - 1, f.ny - 1];
  const i0 = clamp(Math.floor(b.minX / f.kmPerPx), 0, f.nx - 1);
  const j0 = clamp(Math.floor(b.minY / f.kmPerPx), 0, f.ny - 1);
  const i1 = clamp(Math.ceil(b.maxX / f.kmPerPx), 0, f.nx - 1);
  const j1 = clamp(Math.ceil(b.maxY / f.kmPerPx), 0, f.ny - 1);
  if (b.maxX < 0 || b.maxY < 0 || b.minX > f.nx * f.kmPerPx || b.minY > f.ny * f.kmPerPx) return null;
  return [i0, j0, i1, j1];
}

export function editPixelBox(edit: SculptEdit | PaintEdit, f: { nx: number; ny: number; kmPerPx: number }): [number, number, number, number] | null {
  return pxBox(f, prepareArea(edit.area, edit.falloffKm).box);
}

export function applySculptEdit(f: Field, e: SculptEdit) {
  const p = prepareArea(e.area, e.falloffKm);
  const box = pxBox(f, p.box);
  if (!box) return;
  const [i0, j0, i1, j1] = box;
  const H = f.height;
  const s = clamp(e.strength, 0, 1);
  const blurred = e.tool === 'smooth' ? blurRect(H, f.nx, f.ny, box, Math.max(1, (e.scaleKm ?? 1) / f.kmPerPx)) : null;
  for (let j = j0; j <= j1; j++) {
    const y = (j + 0.5) * f.kmPerPx;
    for (let i = i0; i <= i1; i++) {
      const w = p.weight((i + 0.5) * f.kmPerPx, y) * s;
      if (w <= 0) continue;
      const k = j * f.nx + i;
      switch (e.tool) {
        case 'raise': H[k] += (e.amountM ?? 0) * w; break;
        case 'lower': H[k] -= (e.amountM ?? 0) * w; break;
        case 'flatten': H[k] = lerp(H[k], e.targetM ?? H[k], w); break;
        case 'smooth': H[k] = lerp(H[k], blurred!.data[(j - j0) * blurred!.w + (i - i0)], w); break;
      }
    }
  }
}

export function applySculpt(world: World, f: Field, edits: SculptEdit[] = world.sculpt) {
  for (const e of edits) applySculptEdit(f, e);
}

export function emptyPaint(nx: number, ny: number, kmPerPx: number): PaintRaster {
  return { nx, ny, kmPerPx, data: new Float32Array(nx * ny * PAINT_CHANNELS) };
}

export function paintDims(world: World, maxRes = 1024) {
  return mapDims(makeGrid(world.grid), maxRes);
}

export function applyPaintEdit(r: PaintRaster, e: PaintEdit) {
  const p = prepareArea(e.area, e.falloffKm);
  const box = pxBox(r, p.box);
  if (!box) return;
  const [i0, j0, i1, j1] = box;
  const target = new Float32Array(PAINT_CHANNELS);
  const ch = BIOME_CHANNEL[e.biome];
  if (ch !== undefined) target[ch] = 1;
  if (e.biome !== 'erase') target[PAINT_COVERAGE] = 1;
  const s = clamp(e.strength, 0, 1);
  const D = r.data;
  for (let j = j0; j <= j1; j++) {
    const y = (j + 0.5) * r.kmPerPx;
    for (let i = i0; i <= i1; i++) {
      const w = p.weight((i + 0.5) * r.kmPerPx, y) * s;
      if (w <= 0) continue;
      const k = (j * r.nx + i) * PAINT_CHANNELS;
      for (let c = 0; c < PAINT_CHANNELS; c++) D[k + c] += (target[c] - D[k + c]) * w;
    }
  }
}

export function rasterPaint(world: World, maxRes = 1024, edits: PaintEdit[] = world.paint): PaintRaster {
  const d = paintDims(world, maxRes);
  const r = emptyPaint(d.nx, d.ny, d.kmPerPx);
  for (const e of edits) applyPaintEdit(r, e);
  return r;
}

export function packPaint(r: PaintRaster): [Uint8Array, Uint8Array] {
  const n = r.nx * r.ny;
  const a = new Uint8Array(n * 4), b = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 4; c++) {
      a[i * 4 + c] = Math.round(clamp(r.data[i * PAINT_CHANNELS + c], 0, 1) * 255);
      b[i * 4 + c] = Math.round(clamp(r.data[i * PAINT_CHANNELS + 4 + c], 0, 1) * 255);
    }
  }
  return [a, b];
}

export function paintAt(r: PaintRaster | null, x: number, y: number): Biome | null {
  if (!r) return null;
  const i = clamp(Math.floor(x / r.kmPerPx), 0, r.nx - 1), j = clamp(Math.floor(y / r.kmPerPx), 0, r.ny - 1);
  const k = (j * r.nx + i) * PAINT_CHANNELS;
  const cov = r.data[k + PAINT_COVERAGE];
  if (cov < 0.5) return null;
  let best = -1, bestV = 0;
  for (let c = 0; c < CHANNEL_BIOME.length; c++) if (r.data[k + c] > bestV) { bestV = r.data[k + c]; best = c; }
  return best >= 0 && bestV / cov > 0.5 ? CHANNEL_BIOME[best] : 'open';
}

export interface Foundation {
  key: string;
  nx: number;
  ny: number;
  kmPerPx: number;
  height: Float32Array;
  deposit: Float32Array | null;
}

export function encodeFoundation(f: Foundation): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify({ key: f.key, nx: f.nx, ny: f.ny, kmPerPx: f.kmPerPx, deposit: !!f.deposit }));
  const headLen = Math.ceil((head.length + 4) / 4) * 4;
  const n = f.nx * f.ny;
  const out = new Uint8Array(headLen + n * 4 * (f.deposit ? 2 : 1));
  new DataView(out.buffer).setUint32(0, head.length, true);
  out.set(head, 4);
  out.set(new Uint8Array(f.height.buffer, f.height.byteOffset, n * 4), headLen);
  if (f.deposit) out.set(new Uint8Array(f.deposit.buffer, f.deposit.byteOffset, n * 4), headLen + n * 4);
  return out;
}

export function foundationHeader(buf: Uint8Array): { key: string; nx: number; ny: number; kmPerPx: number; deposit: boolean; headLen: number } {
  const len = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + len)));
  return { ...head, headLen: Math.ceil((len + 4) / 4) * 4 };
}

export function decodeFoundation(buf: Uint8Array): Foundation {
  const h = foundationHeader(buf);
  const n = h.nx * h.ny;
  const copy = (off: number) => new Float32Array(buf.slice(off, off + n * 4).buffer);
  if (buf.byteLength < h.headLen + n * 4 * (h.deposit ? 2 : 1)) throw new Error('truncated bake file');
  return { key: h.key, nx: h.nx, ny: h.ny, kmPerPx: h.kmPerPx, height: copy(h.headLen), deposit: h.deposit ? copy(h.headLen + n * 4) : null };
}

export interface FoundationOverrides {
  erosion?: boolean;
  erodedRes?: number;
  iterations?: number;
}

export function foundationKey(world: World, o: FoundationOverrides = {}): string {
  const s = JSON.stringify({ seed: world.seed, grid: world.grid, terrain: world.terrain, base: world.base, ops: world.ops, erosion: world.erosion, o });
  const a = hashString(s), b = hashString(`${s.length}:${s}`);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function layerIds(world: World): string[] {
  return [...world.ops.map((o) => o.id), ...world.sculpt.map((e) => e.id), ...world.paint.map((e) => e.id)];
}

function num(v: unknown, what: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${what} must be a number`);
  return n;
}

function resolveArea(world: World, loose: Record<string, unknown>, expr: Record<string, unknown>): { area: EditArea; defaultFalloff: number } {
  const res = new Resolver(world);
  const a = loose.area as EditArea | undefined;
  if (a && typeof a === 'object' && (a.kind === 'stroke' || a.kind === 'region')) {
    return { area: a, defaultFalloff: a.kind === 'stroke' ? a.radiusKm * 0.5 : 1.5 };
  }
  if (loose.points !== undefined || loose.point !== undefined || loose.at !== undefined) {
    const raw = loose.points ?? [loose.point ?? loose.at];
    const pts = Array.isArray(raw) && !(raw.length === 2 && typeof raw[0] === 'number') ? res.points(raw) : [res.point(raw as PointExpr)];
    const r = num(loose.radiusKm, 'radiusKm') ?? 3;
    if (r <= 0) throw new Error('radiusKm must be > 0');
    expr.points = loose.points ?? loose.point ?? loose.at;
    return { area: { kind: 'stroke', points: pts, radiusKm: r }, defaultFalloff: r * 0.5 };
  }
  const regionExpr = loose.region ?? (loose.hexes !== undefined ? { hexes: loose.hexes } : undefined);
  if (regionExpr === undefined) throw new Error('give the area as "region" (hexes, circle, polygon, rect, side) or "hexes", or a brush path as "points" + "radiusKm"');
  expr.region = regionExpr;
  return { area: { kind: 'region', region: res.region(regionExpr) }, defaultFalloff: 1.5 };
}

export function normalizeSculpt(world: World, loose: Record<string, unknown>, opts: { id?: string; source?: OpSource } = {}): SculptEdit {
  const tool = String(loose.tool ?? '') as SculptTool;
  if (!SCULPT_TOOLS.includes(tool)) throw new Error(`sculpt tool must be one of ${SCULPT_TOOLS.join(', ')}`);
  const expr: Record<string, unknown> = {};
  const { area, defaultFalloff } = resolveArea(world, loose, expr);
  const e: SculptEdit = {
    id: opts.id ?? (typeof loose.id === 'string' && loose.id ? loose.id : newOpId(tool, layerIds(world))),
    label: String(loose.label ?? tool),
    source: opts.source ?? (loose.source as OpSource) ?? 'prompt',
    tool,
    area,
    falloffKm: Math.max(0, num(loose.falloffKm, 'falloffKm') ?? defaultFalloff),
    strength: clamp(num(loose.strength, 'strength') ?? 1, 0, 1),
  };
  if (tool === 'raise' || tool === 'lower') {
    const a = num(loose.amountM, 'amountM');
    if (a === undefined) throw new Error(`${tool} needs amountM (metres)`);
    e.amountM = a;
  }
  if (tool === 'flatten') {
    const t = num(loose.targetM, 'targetM');
    if (t === undefined) throw new Error('flatten needs targetM (absolute elevation, metres)');
    e.targetM = t;
  }
  if (tool === 'smooth') e.scaleKm = Math.max(0.1, num(loose.scaleKm, 'scaleKm') ?? 1);
  const prev = loose.expr as Record<string, unknown> | undefined;
  const merged = { ...(prev ?? {}), ...expr };
  if (Object.keys(merged).length) e.expr = merged;
  return e;
}

export function normalizePaint(world: World, loose: Record<string, unknown>, opts: { id?: string; source?: OpSource } = {}): PaintEdit {
  const biome = parseBiome(loose.biome);
  const expr: Record<string, unknown> = {};
  const { area, defaultFalloff } = resolveArea(world, loose, expr);
  const e: PaintEdit = {
    id: opts.id ?? (typeof loose.id === 'string' && loose.id ? loose.id : newOpId('paint', layerIds(world))),
    label: String(loose.label ?? `paint ${biome}`),
    source: opts.source ?? (loose.source as OpSource) ?? 'prompt',
    biome,
    area,
    falloffKm: Math.max(0, num(loose.falloffKm, 'falloffKm') ?? defaultFalloff),
    strength: clamp(num(loose.strength, 'strength') ?? 1, 0, 1),
  };
  const prev = loose.expr as Record<string, unknown> | undefined;
  const merged = { ...(prev ?? {}), ...expr };
  if (Object.keys(merged).length) e.expr = merged;
  return e;
}
