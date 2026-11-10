import { TIERS, type Blocker, type Tier } from './kit';
import { ScenerySource, segmentDistance, type SceneryCell } from './place';

const LIMIT: Record<Tier, number> = { near: 900, mid: 1400, far: 1200 };
const MASK_PX_KM = 0.002;
const MASK_LIMIT = 500;

export class SceneryCells {
  private caches: Record<Tier, Map<string, SceneryCell>> = { near: new Map(), mid: new Map(), far: new Map() };
  private masks = new Map<string, Uint8Array>();
  generated = 0;
  clearanceKm = 0.0006;
  constructor(readonly source: ScenerySource) {}

  peek(tier: Tier, cx: number, cz: number): SceneryCell | undefined {
    const c = this.caches[tier], key = `${cx},${cz}`;
    const v = c.get(key);
    if (v) { c.delete(key); c.set(key, v); }
    return v;
  }

  get(tier: Tier, cx: number, cz: number): SceneryCell {
    const v = this.peek(tier, cx, cz);
    if (v) return v;
    const cell = this.source.cell(tier, cx, cz);
    this.generated++;
    const c = this.caches[tier];
    c.set(`${cx},${cz}`, cell);
    while (c.size > LIMIT[tier]) c.delete(c.keys().next().value!);
    return cell;
  }

  private mask(cx: number, cz: number): Uint8Array {
    const key = `${cx},${cz}`;
    let m = this.masks.get(key);
    if (m) { this.masks.delete(key); this.masks.set(key, m); return m; }
    const cell = TIERS.mid.cellKm, n = Math.round(cell / MASK_PX_KM);
    m = new Uint8Array(n * n);
    const x0 = cx * cell, z0 = cz * cell;
    const blockers: Blocker[] = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) blockers.push(...this.get('mid', cx + di, cz + dj).blockers);
    const far = TIERS.far.cellKm;
    const fi = Math.floor((x0 + cell / 2) / far), fj = Math.floor((z0 + cell / 2) / far);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) blockers.push(...this.get('far', fi + di, fj + dj).blockers);
    const pad = this.clearanceKm;
    for (const b of blockers) {
      const ex = b.ax === undefined ? b.r : Math.max(Math.abs(b.ax - b.x), Math.abs(b.bx! - b.x)) + b.r;
      const ez = b.ax === undefined ? b.r : Math.max(Math.abs(b.az! - b.z), Math.abs(b.bz! - b.z)) + b.r;
      const i0 = Math.max(0, Math.floor((b.x - ex - pad - x0) / MASK_PX_KM)), i1 = Math.min(n - 1, Math.ceil((b.x + ex + pad - x0) / MASK_PX_KM));
      const j0 = Math.max(0, Math.floor((b.z - ez - pad - z0) / MASK_PX_KM)), j1 = Math.min(n - 1, Math.ceil((b.z + ez + pad - z0) / MASK_PX_KM));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (m[j * n + i]) continue;
        if (segmentDistance(x0 + (i + 0.5) * MASK_PX_KM, z0 + (j + 0.5) * MASK_PX_KM, b) < pad) m[j * n + i] = 1;
      }
    }
    this.masks.set(key, m);
    while (this.masks.size > MASK_LIMIT) this.masks.delete(this.masks.keys().next().value!);
    return m;
  }

  blocked(x: number, z: number): boolean {
    const cell = TIERS.mid.cellKm, n = Math.round(cell / MASK_PX_KM);
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    const i = Math.min(n - 1, Math.floor((x - cx * cell) / MASK_PX_KM)), j = Math.min(n - 1, Math.floor((z - cz * cell) / MASK_PX_KM));
    return this.mask(cx, cz)[j * n + i] === 1;
  }
}
