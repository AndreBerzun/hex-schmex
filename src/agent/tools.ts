// Op-editing tools (BRIEF §5) executed against a draft world. Driven by the terrain CLI (scripts/terrain.ts),
// which a Claude Code session calls; see TERRAIN_AGENT.md.

import { hexId, makeGrid, parseHexId } from '../core/hex';
import { OP_DESC_BY_TYPE, normalizeOp } from '../core/opSchema';
import type { Op, World } from '../core/types';
import { setWorldParam } from '../core/world';
import { describeOp } from './context';
import { hexSummary, type TerrainProbe } from './probe';

export interface ToolLogEntry {
  name: string;
  input: unknown;
  ok: boolean;
  result: string;
  /** op id the call touched, if any */
  opId?: string;
}

/** Runs tool calls against a draft world. Tracks which ops changed for highlighting. */
export class ToolExecutor {
  readonly changed = new Set<string>();
  readonly removed = new Set<string>();
  queriesUsed = 0;
  constructor(public draft: World, private probe: TerrainProbe | null, private baseline: World) {}

  run(name: string, input: unknown): ToolLogEntry {
    try {
      const { result, opId } = this.exec(name, (input ?? {}) as Record<string, unknown>);
      return { name, input, ok: true, result, opId };
    } catch (e) {
      return { name, input, ok: false, result: `error: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  private find(id: unknown): number {
    const i = this.draft.ops.findIndex((o) => o.id === id);
    if (i < 0) throw new Error(`no op with id "${String(id)}". Existing ids: ${this.draft.ops.map((o) => o.id).join(', ') || '(none)'}`);
    return i;
  }

  private exec(name: string, a: Record<string, unknown>): { result: string; opId?: string } {
    const w = this.draft;
    switch (name) {
      case 'add_op': {
        const loose = { ...((a.op as Record<string, unknown>) ?? {}) };
        delete loose.id;
        if (loose.type === 'stroke') throw new Error('stroke ops are for brushes; use a terrain op type');
        const op = normalizeOp(w, loose, { source: 'prompt' });
        const idx = typeof a.index === 'number' ? Math.max(0, Math.min(w.ops.length, Math.round(a.index))) : w.ops.length;
        w.ops.splice(idx, 0, op);
        this.changed.add(op.id);
        return { result: `added ${op.id} at index ${idx}: ${JSON.stringify(describeOp(w, op))}`, opId: op.id };
      }
      case 'update_op': {
        const i = this.find(a.id);
        const old = w.ops[i];
        const patch = (a.patch ?? {}) as Record<string, unknown>;
        if (typeof patch !== 'object') throw new Error('patch must be an object');
        if ('type' in patch && patch.type !== old.type) throw new Error('cannot change an op\'s type; remove it and add a new one');
        const loose = JSON.parse(JSON.stringify(old)) as Record<string, unknown>;
        const expr = { ...((loose.expr as Record<string, unknown>) ?? {}) };
        for (const k of Object.keys(patch)) { delete expr[k]; loose[k] = patch[k]; }
        loose.expr = expr;
        loose.id = old.id;
        const op = normalizeOp(w, loose, { id: old.id, source: old.source });
        w.ops[i] = op;
        this.changed.add(op.id);
        return { result: `updated ${op.id}: ${JSON.stringify(describeOp(w, op))}`, opId: op.id };
      }
      case 'remove_op': {
        const i = this.find(a.id);
        const [op] = w.ops.splice(i, 1);
        this.changed.delete(op.id);
        this.removed.add(op.id);
        return { result: `removed ${op.id}`, opId: op.id };
      }
      case 'reorder_op': {
        const i = this.find(a.id);
        const [op] = w.ops.splice(i, 1);
        const idx = Math.max(0, Math.min(w.ops.length, Math.round(Number(a.index) || 0)));
        w.ops.splice(idx, 0, op);
        this.changed.add(op.id);
        return { result: `moved ${op.id} to index ${idx}`, opId: op.id };
      }
      case 'set_world_param': {
        const path = String(a.path);
        if (/^(grid\.|terrain\.(designRes|erodedRes))/.test(path)) throw new Error(`${path} is not settable from a prompt`);
        const old = setWorldParam(w, path, a.value);
        return { result: `${path}: ${JSON.stringify(old)} -> ${JSON.stringify(a.value)}` };
      }
      case 'query_region': {
        if (this.queriesUsed++ >= 1) throw new Error('query budget used (one query per request); work from what you have');
        if (!this.probe) throw new Error('terrain is not available yet; use the context table');
        const ids = this.hexList(a);
        const rows = ids.map((id) => {
          const h = parseHexId(id)!;
          const s = hexSummary(this.baseline, this.probe!, h.col, h.row);
          if (!s) return `${id}: outside the grid`;
          return `${id}: min ${Math.round(s.minM)} mean ${Math.round(s.meanM)} max ${Math.round(s.maxM)} m, slope ${s.slopeDeg.toFixed(1)}°, ${s.surface}${s.water > 0.05 ? `, water ${Math.round(s.water * 100)}%` : ''}`;
        });
        return { result: `${this.probe.kind === 'eroded' ? 'eroded terrain' : 'op stack (no erosion)'}:\n${rows.join('\n')}` };
      }
      default:
        throw new Error(`unknown tool ${name}`);
    }
  }

  private hexList(a: Record<string, unknown>): string[] {
    const grid = makeGrid(this.baseline.grid);
    let ids: string[] = [];
    if (Array.isArray(a.hexes)) ids = a.hexes.map(String);
    else if (Array.isArray(a.bbox) && a.bbox.length === 2) {
      const p = parseHexId(String(a.bbox[0])), q = parseHexId(String(a.bbox[1]));
      if (!p || !q) throw new Error('bbox must be two hex ids');
      for (let r = Math.min(p.row, q.row); r <= Math.max(p.row, q.row); r++) for (let c = Math.min(p.col, q.col); c <= Math.max(p.col, q.col); c++) ids.push(hexId(c, r));
    } else throw new Error('give hexes or bbox');
    ids = ids.filter((id) => { const h = parseHexId(id); return h && h.col >= 1 && h.row >= 1 && h.col <= grid.cols && h.row <= grid.rows; });
    if (!ids.length) throw new Error('no valid hex ids inside the grid');
    if (ids.length > 60) throw new Error(`${ids.length} hexes requested; max 60`);
    return ids;
  }
}

/** Ops in `after` that differ from `before` (added or modified). */
export function diffOps(before: World, after: World): string[] {
  const b = new Map(before.ops.map((o) => [o.id, JSON.stringify(o)]));
  return after.ops.filter((o: Op) => b.get(o.id) !== JSON.stringify(o)).map((o) => o.id);
}

export { OP_DESC_BY_TYPE };
