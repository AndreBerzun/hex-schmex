// Off-main-thread CPU work: op stack evaluation and hydrology.
import { fluvialOnDesign, type FluvialOptions } from '../core/fluvial';
import { computeHydrology, type HydroInput } from '../core/hydrology';
import { evaluate } from '../core/ops';
import type { World } from '../core/types';

type Req =
  | { id: number; kind: 'evaluate'; world: World; res?: number }
  | { id: number; kind: 'hydrology'; input: HydroInput }
  | { id: number; kind: 'fluvial'; height: Float32Array; nx: number; ny: number; kmPerPx: number; seaM: number; opts: FluvialOptions; maxRes: number; lake?: Float32Array };

self.onmessage = (ev: MessageEvent<Req>) => {
  const r = ev.data;
  try {
    if (r.kind === 'evaluate') {
      const t0 = performance.now();
      const hf = evaluate(r.world, { res: r.res });
      const ms = performance.now() - t0;
      (self as unknown as Worker).postMessage({ id: r.id, ok: true, result: { ...hf, ms } }, [hf.height.buffer, hf.moisture.buffer, hf.river.buffer, hf.lake.buffer]);
    } else if (r.kind === 'fluvial') {
      const t0 = performance.now();
      const out = fluvialOnDesign(r.height, r.nx, r.ny, r.kmPerPx, r.seaM, r.opts, r.maxRes, r.lake);
      (self as unknown as Worker).postMessage({ id: r.id, ok: true, result: { height: out, ms: performance.now() - t0 } }, [out.buffer]);
    } else if (r.kind === 'hydrology') {
      const t0 = performance.now();
      const out = computeHydrology(r.input);
      const ms = performance.now() - t0;
      (self as unknown as Worker).postMessage(
        { id: r.id, ok: true, result: { ...out, ms } },
        [out.waterLevel.buffer, out.waterKind.buffer, out.logArea.buffer, out.moisture.buffer, out.receiver.buffer],
      );
    }
  } catch (e) {
    (self as unknown as Worker).postMessage({ id: r.id, ok: false, error: String((e as Error)?.stack ?? e) });
  }
};
