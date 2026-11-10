export type Blocked = (x: number, z: number) => boolean;

export interface RouteOptions {
  cellKm?: number;
  marginKm?: number;
  maxCells?: number;
}

export function clearLine(ax: number, az: number, bx: number, bz: number, blocked: Blocked, stepKm = 0.002): boolean {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / stepKm));
  for (let i = 1; i <= n; i++) if (blocked(ax + (bx - ax) * i / n, az + (bz - az) * i / n)) return false;
  return true;
}

export function planRoute(ax: number, az: number, bx: number, bz: number, blocked: Blocked, opts: RouteOptions = {}): [number, number][] | null {
  if (clearLine(ax, az, bx, bz, blocked)) return [[bx, bz]];
  const cell = opts.cellKm ?? 0.004;
  const margin = opts.marginKm ?? 0.15;
  const minX = Math.min(ax, bx) - margin, minZ = Math.min(az, bz) - margin;
  const w = Math.ceil((Math.max(ax, bx) + margin - minX) / cell) + 1;
  const h = Math.ceil((Math.max(az, bz) + margin - minZ) / cell) + 1;
  if (w * h > (opts.maxCells ?? 300_000)) return null;
  const free = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) free[j * w + i] = blocked(minX + i * cell, minZ + j * cell) ? 0 : 1;
  const idx = (x: number, z: number) => Math.round((z - minZ) / cell) * w + Math.round((x - minX) / cell);
  const start = idx(ax, az);
  let goal = idx(bx, bz);
  free[start] = 1;
  if (!free[goal]) {
    const gi = goal % w, gj = Math.floor(goal / w);
    let best = -1, bd = Infinity;
    for (let j = Math.max(0, gj - 12); j <= Math.min(h - 1, gj + 12); j++) for (let i = Math.max(0, gi - 12); i <= Math.min(w - 1, gi + 12); i++) {
      const d = (i - gi) ** 2 + (j - gj) ** 2;
      if (free[j * w + i] && d < bd) { bd = d; best = j * w + i; }
    }
    if (best < 0) return null;
    goal = best;
  }
  const g = new Float32Array(w * h).fill(Infinity);
  const from = new Int32Array(w * h).fill(-1);
  const heap = new MinHeap();
  const gi = goal % w, gj = Math.floor(goal / w);
  const heur = (k: number) => { const dx = Math.abs(k % w - gi), dz = Math.abs(Math.floor(k / w) - gj); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); };
  g[start] = 0;
  heap.push(start, heur(start));
  const N = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
  let found = false;
  while (heap.size) {
    const k = heap.pop();
    if (k === goal) { found = true; break; }
    const i = k % w, j = Math.floor(k / w);
    for (const [di, dj, c] of N) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const nk = nj * w + ni;
      if (!free[nk]) continue;
      if (di && dj && (!free[j * w + ni] || !free[nj * w + i])) continue;
      const ng = g[k] + c;
      if (ng < g[nk]) { g[nk] = ng; from[nk] = k; heap.push(nk, ng + heur(nk)); }
    }
  }
  if (!found) return null;
  const cells: [number, number][] = [];
  for (let k = goal; k !== -1; k = from[k]) cells.push([minX + (k % w) * cell, minZ + Math.floor(k / w) * cell]);
  cells.reverse();
  cells[0] = [ax, az];
  if (goal === idx(bx, bz)) cells[cells.length - 1] = [bx, bz];
  const out: [number, number][] = [];
  let anchor = cells[0];
  let i = 1;
  while (i < cells.length) {
    let j = i;
    while (j + 1 < cells.length && clearLine(anchor[0], anchor[1], cells[j + 1][0], cells[j + 1][1], blocked, cell * 0.5)) j++;
    out.push(cells[j]);
    anchor = cells[j];
    i = j + 1;
  }
  return out;
}

class MinHeap {
  private keys: number[] = [];
  private pri: number[] = [];
  get size() { return this.keys.length; }
  push(k: number, p: number) {
    const a = this.keys, b = this.pri;
    let i = a.length;
    a.push(k); b.push(p);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (b[up] <= p) break;
      a[i] = a[up]; b[i] = b[up]; i = up;
    }
    a[i] = k; b[i] = p;
  }
  pop(): number {
    const a = this.keys, b = this.pri;
    const top = a[0];
    const k = a.pop()!, p = b.pop()!;
    if (a.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= a.length) break;
        if (c + 1 < a.length && b[c + 1] < b[c]) c++;
        if (b[c] >= p) break;
        a[i] = a[c]; b[i] = b[c]; i = c;
      }
      a[i] = k; b[i] = p;
    }
    return top;
  }
}
