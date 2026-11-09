// Compact world context sent with every prompt (BRIEF §5): grid, terrain/climate settings, the op list in
// hex terms and a per-hex elevation table. Aim: a few thousand tokens.

import { hexCenter, hexId, makeGrid, pointToHex, type HexGrid } from '../core/hex';
import { OP_DESC_BY_TYPE } from '../core/opSchema';
import type { Op, Region, Vec2, World } from '../core/types';
import { allHexSummaries, type HexSummary, type TerrainProbe } from './probe';

const r1 = (v: number) => Math.round(v * 10) / 10;

/** A world-km point as a hex expression the resolver understands. */
export function pointToExpr(grid: HexGrid, p: Vec2): string | { hex: string; dx: number; dy: number } {
  const h = pointToHex(grid, p);
  const c = hexCenter(grid, h.col, h.row);
  const dx = (p[0] - c[0]) / grid.flat, dy = (p[1] - c[1]) / grid.flat;
  const id = hexId(Math.max(0, h.col), Math.max(0, h.row));
  if (Math.hypot(dx, dy) < 0.15) return id;
  return { hex: id, dx: r1(dx), dy: r1(dy) };
}

function regionToExpr(grid: HexGrid, r: Region): unknown {
  switch (r.kind) {
    case 'all': return 'all';
    case 'circle': return { center: pointToExpr(grid, r.center), radiusKm: r1(r.radius) };
    case 'rect': return { rect: [pointToExpr(grid, r.min), pointToExpr(grid, r.max)] };
    case 'polygon': return { polygon: r.points.map((p) => pointToExpr(grid, p)) };
    case 'union': {
      // unions come from hex lists; give them back as hexes (by part centroid)
      const ids = r.parts.map((p) => {
        const pts = p.kind === 'polygon' ? p.points : p.kind === 'circle' ? [p.center] : p.kind === 'rect' ? [p.min, p.max] : [[grid.widthKm / 2, grid.heightKm / 2] as Vec2];
        const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length, cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
        const h = pointToHex(grid, [cx, cy]);
        return hexId(h.col, h.row);
      });
      return { hexes: ids };
    }
  }
}

/** An op as the model should see it: geometry in hex terms (its original expression when there is one). */
export function describeOp(world: World, op: Op, grid: HexGrid = makeGrid(world.grid)): Record<string, unknown> {
  const desc = OP_DESC_BY_TYPE[op.type];
  const o = op as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { id: op.id, type: op.type, label: op.label };
  if (!op.enabled) out.enabled = false;
  if (op.blend) out.blend = op.blend;
  for (const p of desc.params) {
    const v = o[p.key];
    if (v === undefined) continue;
    const ex = op.expr?.[p.key];
    if (p.kind === 'points') out[p.key] = ex ?? simplify(v as Vec2[], 8).map((q) => pointToExpr(grid, q));
    else if (p.kind === 'point') out[p.key] = ex ?? pointToExpr(grid, v as Vec2);
    else if (p.kind === 'region') out[p.key] = ex ?? regionToExpr(grid, v as Region);
    else if (typeof v === 'number') out[p.key] = r1(v);
    else out[p.key] = v;
  }
  if (op.mask) out.mask = { region: regionToExpr(grid, op.mask.region), falloffKm: op.mask.falloffKm, invert: op.mask.invert || undefined };
  return out;
}

function simplify(pts: Vec2[], max: number): Vec2[] {
  if (pts.length <= max) return pts;
  const out: Vec2[] = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.round((i * (pts.length - 1)) / (max - 1))]);
  return out;
}

export function buildContext(world: World, probe: TerrainProbe | null): string {
  const grid = makeGrid(world.grid);
  const t = world.terrain, c = world.climate, e = world.erosion, b = world.base;
  const L: string[] = [];
  L.push('# World');
  L.push(`name: ${world.meta.name}`);
  L.push(`grid: ${grid.cols} cols x ${grid.rows} rows, ${world.grid.orientation}-top hexes, ${world.grid.hexMiles} mi (${r1(grid.flat)} km) across. Hex ids are CCRR, 0101 = top-left (NW), ${hexId(grid.cols, 1)} = top-right (NE), ${hexId(1, grid.rows)} = bottom-left (SW), ${hexId(grid.cols, grid.rows)} = bottom-right (SE). North is up.`);
  L.push(world.grid.orientation === 'flat'
    ? 'flat-top layout: even-numbered columns sit half a hex lower (south) than odd ones.'
    : 'pointy-top layout: even-numbered rows sit half a hex further east than odd ones.');
  L.push(`map extent: ${r1(grid.widthKm)} x ${r1(grid.heightKm)} km (incl. half a hex of margin around the grid)`);
  L.push(`terrain: seaLevelM ${t.seaLevelM}, maxElevationM ${t.maxElevationM}`);
  L.push(`base: ${JSON.stringify(b)}`);
  L.push(`climate: windFromDeg ${c.windFromDeg} (prevailing wind comes FROM this bearing), baseMoisture ${c.baseMoisture}, snowlineM ${c.snowlineM}, treelineM ${c.treelineM}, temperature ${c.temperature}`);
  L.push(`erosion: ${e.enabled ? `on, preset ${e.preset}, strength ${e.strength}` : 'off'}`);
  L.push('');
  L.push(`# Ops (${world.ops.length}, evaluated in order, top to bottom)`);
  if (!world.ops.length) L.push('(none yet: only the base noise terrain)');
  world.ops.forEach((op, i) => L.push(`${i}: ${JSON.stringify(describeOp(world, op, grid))}`));
  if (probe) {
    const stats = allHexSummaries(world, probe);
    L.push('');
    L.push(...elevationTables(grid, stats, probe.kind, world.environment?.palette === 'ashen'));
  }
  if (world.meta.notes) {
    L.push('');
    L.push(`# GM notes\n${world.meta.notes}`);
  }
  if (world.meta.edits?.length) {
    L.push('');
    L.push('# Recent edits (oldest first)');
    for (const e of world.meta.edits.slice(-10)) L.push(`- ${e.at.slice(0, 16).replace('T', ' ')} ${e.label}${e.ops.length ? ` [${e.ops.join(', ')}]` : ''}`);
  }
  return L.join('\n');
}

export function elevationTables(grid: HexGrid, stats: HexSummary[], kind: 'eroded' | 'design', shore = false): string[] {
  const by = new Map(stats.map((s) => [s.id, s]));
  const L: string[] = [];
  const head = '     ' + Array.from({ length: grid.cols }, (_, i) => String(i + 1).padStart(2, '0').padStart(5)).join('');
  const table = (title: string, f: (s: HexSummary) => string) => {
    L.push(title);
    L.push(head);
    for (let r = 1; r <= grid.rows; r++) {
      let row = String(r).padStart(2, '0').padEnd(5);
      for (let c = 1; c <= grid.cols; c++) {
        const s = by.get(hexId(c, r));
        row += (s ? f(s) : '').padStart(5);
      }
      L.push(row);
    }
  };
  L.push(`# Per-hex terrain (${kind === 'eroded' ? 'current eroded terrain' : 'op stack before erosion'}). Columns = CC, rows = RR.`);
  table('## mean elevation, m (negative = below datum; sea level is the terrain.seaLevelM above)', (s) => String(Math.round(s.meanM / 10) * 10));
  table('## max elevation, m', (s) => String(Math.round(s.maxM / 10) * 10));

  const code: Record<string, string> = shore
    ? { 'dark water': '~', 'mineral rock': '^', 'crimson coral': 'c', 'black earth': '.', 'ash-dusted earth': ':', ash: 'd', 'ash ridges': 'b', 'silt mire': 'm', 'tidal channel': 'r', 'tidal flats': 't', 'salt pan': 'p', 'dark pool': 'l', snow: '*' }
    : { water: '~', snow: '*', rock: '^', forest: 'f', grassland: '.', steppe: ':', desert: 'd', badlands: 'b', marsh: 'm', river: 'r', playa: 'p', alpine: 'a', 'lake basin': 'l' };
  const legend = shore
    ? '~ dark water, ^ mineral rock, c crimson coral, . black earth, : ash-dusted earth, d ash, b ash ridges, m silt mire, r tidal channel, t tidal flats, p salt pan, l dark pool'
    : '~ water, * snow, ^ rock, a alpine, f forest, . grass, : steppe, d desert, b badlands, m marsh, r river, p playa, l lake basin';
  table(`## dominant surface (${legend})`, (s) => code[s.surface] ?? '?');
  return L;
}
