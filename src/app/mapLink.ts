// Live link between the app and a map file on disk (dev server only; see vite-plugins/mapLink.ts).
// External writes (the terrain CLI, usually driven by Claude Code) arrive as one undoable commit each;
// edits made in the UI are written back to the file.

import { loadWorld, serializeWorld } from '../core/world';
import type { World } from '../core/types';
import type { Store } from './store';

export interface ExternalEdit {
  at: string;
  label: string;
  changedOps: string[];
  txId?: number;
  reverted?: boolean;
}

export class MapLink {
  name: string | null = null;
  readonly edits: ExternalEdit[] = [];
  status = '';
  private applyingExternal = false;
  private saveTimer = 0;
  private lastText = '';
  private listeners: (() => void)[] = [];

  constructor(private store: Store) {
    import.meta.hot?.on('tp:map-changed', (d: { name: string; text: string }) => {
      if (d.name === this.name) this.onExternal(d.text);
    });
    store.subscribe((c) => {
      if (this.applyingExternal || !this.name) return;
      if (c.kind === 'load') { this.unlink(); return; }
      clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => void this.save(), 500);
    });
  }

  static get available() { return !!import.meta.hot; }

  onChange(fn: () => void) { this.listeners.push(fn); }
  private emit() { for (const f of this.listeners) f(); }

  /** Fetch a map file's text (used at boot, before the store exists). */
  static async fetchText(name: string): Promise<string> {
    const r = await fetch(`/__maps/${encodeURIComponent(name)}`);
    if (!r.ok) throw new Error(`could not open maps/${name}.json (${r.status})`);
    return r.text();
  }

  /** Mark the store's current world as coming from maps/<name>.json (whose text is `text`). */
  adopt(name: string, text: string) {
    this.name = name;
    this.lastText = text;
    this.status = `linked to maps/${name}.json`;
    try { localStorage.setItem('tp:link', name); } catch { /* ignore */ }
    this.emit();
  }

  async list(): Promise<string[]> {
    const r = await fetch('/__maps');
    return r.ok ? r.json() : [];
  }

  /** Link to maps/<name>.json. With `create`, write the current world there first. */
  async link(name: string, opts: { create?: boolean } = {}) {
    if (opts.create) {
      const text = serializeWorld(this.store.world);
      await this.put(name, text);
    }
    const text = await MapLink.fetchText(name);
    this.edits.length = 0;
    this.applyingExternal = true;
    try { this.store.replace(loadWorld(JSON.parse(text)), `open maps/${name}.json`); } finally { this.applyingExternal = false; }
    this.adopt(name, text);
  }

  unlink() {
    clearTimeout(this.saveTimer);
    this.name = null;
    this.edits.length = 0;
    this.status = '';
    try { localStorage.removeItem('tp:link'); } catch { /* ignore */ }
    this.emit();
  }

  private onExternal(text: string) {
    if (text === this.lastText) return;
    this.lastText = text;
    let w: World;
    try { w = loadWorld(JSON.parse(text)); } catch (e) { this.status = `could not read the file: ${String(e)}`; this.emit(); return; }
    const last = w.meta.edits?.[w.meta.edits.length - 1];
    const label = last && Date.now() - Date.parse(last.at) < 60_000 ? last.label : 'external edit';
    const before = new Map(this.store.world.ops.map((o) => [o.id, JSON.stringify(o)]));
    const changedOps = w.ops.filter((o) => before.get(o.id) !== JSON.stringify(o)).map((o) => o.id);
    this.applyingExternal = true;
    let txId: number | undefined;
    try {
      const c = this.store.commit(`file: ${label}`, (draft) => {
        for (const k of Object.keys(draft) as (keyof World)[]) delete (draft as Partial<World>)[k];
        Object.assign(draft, w);
        return changedOps;
      });
      txId = c?.txId;
    } finally { this.applyingExternal = false; }
    if (txId !== undefined) {
      this.edits.push({ at: new Date().toISOString(), label, changedOps, txId });
      this.status = `${new Date().toLocaleTimeString()}: ${label}`;
      this.emit();
    }
  }

  private async save() {
    if (!this.name) return;
    const text = serializeWorld(this.store.world);
    if (text === this.lastText) return;
    try {
      await this.put(this.name, text);
      this.lastText = text;
    } catch (e) {
      this.status = `could not save: ${String(e)}`;
      this.emit();
    }
  }

  private async put(name: string, text: string) {
    const r = await fetch(`/__maps/${encodeURIComponent(name)}`, { method: 'PUT', body: text, headers: { 'content-type': 'application/json' } });
    if (!r.ok) throw new Error(`write failed (${r.status})`);
  }

  revert(e: ExternalEdit) {
    if (e.txId === undefined || e.reverted) return;
    if (this.store.revertTx(e.txId, `revert: ${e.label}`)) { e.reverted = true; this.emit(); }
  }
}
