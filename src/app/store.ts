// World state with transactional undo/redo (snapshots; worlds are small JSON).

import { cloneWorld } from '../core/world';
import type { World } from '../core/types';

export type ChangeKind = 'terrain' | 'sculpt' | 'paint' | 'climate' | 'meta' | 'load';

export interface Change {
  kind: ChangeKind;
  label: string;
  /** op ids added or modified by this transaction (for highlighting) */
  changedOps: string[];
  txId: number;
}

interface Snap { json: string; label: string; txId: number }

const TERRAIN_KEYS: (keyof World)[] = ['seed', 'grid', 'terrain', 'base', 'ops', 'erosion'];

export class Store {
  world: World;
  private past: Snap[] = [];
  private future: Snap[] = [];
  private listeners: ((c: Change) => void)[] = [];
  private tx = 0;
  /** txId -> snapshot taken before it, for "revert this prompt" */
  private before = new Map<number, string>();

  constructor(world: World) {
    this.world = world;
  }

  subscribe(fn: (c: Change) => void) {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((f) => f !== fn); };
  }

  private emit(c: Change) { for (const f of this.listeners) f(c); }

  private classify(a: World, b: World): ChangeKind {
    for (const k of TERRAIN_KEYS) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return 'terrain';
    if (JSON.stringify(a.sculpt) !== JSON.stringify(b.sculpt)) return 'sculpt';
    if (JSON.stringify(a.paint) !== JSON.stringify(b.paint)) return 'paint';
    if (JSON.stringify(a.climate) !== JSON.stringify(b.climate)) return 'climate';
    return 'meta';
  }

  /** Apply a mutation as one undoable transaction. Throws (and rolls back) if `mutate` throws. */
  commit(label: string, mutate: (w: World) => void | string[]): Change | null {
    const beforeJson = JSON.stringify(this.world);
    const draft = cloneWorld(this.world);
    const before = cloneWorld(this.world);
    const changed = mutate(draft) || [];
    if (JSON.stringify(draft) === beforeJson) return null;
    const txId = ++this.tx;
    this.past.push({ json: beforeJson, label, txId });
    if (this.past.length > 200) this.past.shift();
    this.future = [];
    this.before.set(txId, beforeJson);
    this.world = draft;
    const c: Change = { kind: this.classify(before, draft), label, changedOps: changed, txId };
    this.emit(c);
    return c;
  }

  replace(world: World, label = 'load') {
    this.past = [];
    this.future = [];
    this.world = world;
    this.emit({ kind: 'load', label, changedOps: [], txId: ++this.tx });
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get undoLabel() { return this.past[this.past.length - 1]?.label; }
  get redoLabel() { return this.future[this.future.length - 1]?.label; }

  undo() {
    const s = this.past.pop();
    if (!s) return;
    const prev = this.world;
    this.future.push({ json: JSON.stringify(this.world), label: s.label, txId: s.txId });
    this.world = JSON.parse(s.json);
    this.emit({ kind: this.classify(prev, this.world), label: `undo ${s.label}`, changedOps: [], txId: ++this.tx });
  }

  redo() {
    const s = this.future.pop();
    if (!s) return;
    const prev = this.world;
    this.past.push({ json: JSON.stringify(this.world), label: s.label, txId: s.txId });
    this.world = JSON.parse(s.json);
    this.emit({ kind: this.classify(prev, this.world), label: `redo ${s.label}`, changedOps: [], txId: ++this.tx });
  }

  /**
   * Revert one earlier transaction (e.g. a prompt) as a new transaction: the ops it added are removed
   * and ops it modified/removed are restored, while later unrelated edits are kept.
   */
  revertTx(txId: number, label: string): Change | null {
    const beforeJson = this.before.get(txId);
    if (!beforeJson) return null;
    const snapBefore = JSON.parse(beforeJson) as World;
    const afterIdx = this.past.findIndex((p) => p.txId === txId);
    const afterJson = afterIdx >= 0 && afterIdx + 1 < this.past.length ? this.past[afterIdx + 1].json : JSON.stringify(this.world);
    const snapAfter = JSON.parse(afterJson) as World;
    return this.commit(label, (w) => {
      for (const key of ['ops', 'sculpt', 'paint'] as const) {
        const list = revertList((w[key] ?? []) as { id: string }[], (snapBefore[key] ?? []) as { id: string }[], (snapAfter[key] ?? []) as { id: string }[]);
        (w as unknown as Record<string, unknown>)[key] = list;
      }
      // world params changed by the tx
      for (const k of ['base', 'climate', 'erosion', 'terrain'] as const) {
        if (JSON.stringify(snapAfter[k]) !== JSON.stringify(snapBefore[k]) && JSON.stringify(w[k]) === JSON.stringify(snapAfter[k])) {
          (w as unknown as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(snapBefore[k]));
        }
      }
    });
  }
}

function revertList<T extends { id: string }>(current: T[], before: T[], after: T[]): T[] {
  const beforeIds = new Map(before.map((o) => [o.id, o]));
  const afterIds = new Map(after.map((o) => [o.id, o]));
  let out = current.filter((o) => beforeIds.has(o.id) || !afterIds.has(o.id));
  out = out.map((o) => {
    const b = beforeIds.get(o.id), a = afterIds.get(o.id);
    if (b && a && JSON.stringify(a) !== JSON.stringify(b) && JSON.stringify(o) === JSON.stringify(a)) return JSON.parse(JSON.stringify(b));
    return o;
  });
  before.forEach((o, i) => {
    if (!afterIds.has(o.id) && !out.some((x) => x.id === o.id)) out.splice(Math.min(i, out.length), 0, JSON.parse(JSON.stringify(o)));
  });
  return out;
}
