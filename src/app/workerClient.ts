// Promise wrapper around the core worker. Falls back to running on the main thread if workers fail.
import CoreWorker from '../workers/core.worker?worker&inline';
import { computeHydrology, type HydroInput, type HydroOutput } from '../core/hydrology';
import { fluvialOnDesign, type FluvialOptions } from '../core/fluvial';
import { evaluate, type Heightfield } from '../core/ops';
import type { World } from '../core/types';

export class WorkerClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
  /** generation counter so stale evaluate results can be dropped */
  latestEval = 0;

  constructor() {
    try {
      this.worker = new CoreWorker();
      this.worker.onmessage = (ev) => {
        const m = ev.data as { id: number; ok: boolean; result?: unknown; error?: string };
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.ok) p.res(m.result);
        else p.rej(new Error(m.error));
      };
    } catch (e) {
      console.warn('worker unavailable, running on main thread', e);
      this.worker = null;
    }
  }

  private call<T>(msg: Record<string, unknown>): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((res, rej) => {
      this.pending.set(id, { res: res as (v: unknown) => void, rej });
      this.worker!.postMessage({ ...msg, id });
    });
  }

  async evaluate(world: World, res?: number): Promise<Heightfield & { ms: number }> {
    if (!this.worker) {
      const t0 = performance.now();
      const hf = evaluate(world, { res });
      return { ...hf, ms: performance.now() - t0 };
    }
    return this.call({ kind: 'evaluate', world: JSON.parse(JSON.stringify(world)), res });
  }

  async fluvial(height: Float32Array, nx: number, ny: number, kmPerPx: number, seaM: number, opts: FluvialOptions, maxRes: number, lake?: Float32Array): Promise<{ height: Float32Array; ms: number }> {
    if (!this.worker) {
      const t0 = performance.now();
      return { height: fluvialOnDesign(height, nx, ny, kmPerPx, seaM, opts, maxRes, lake), ms: performance.now() - t0 };
    }
    return this.call({ kind: 'fluvial', height, nx, ny, kmPerPx, seaM, opts, maxRes, lake });
  }

  async hydrology(input: HydroInput): Promise<HydroOutput & { ms: number }> {
    if (!this.worker) {
      const t0 = performance.now();
      return { ...computeHydrology(input), ms: performance.now() - t0 };
    }
    return this.call({ kind: 'hydrology', input });
  }
}
