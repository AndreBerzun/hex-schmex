// CDLOD terrain: a quadtree of fixed-size grid patches, drawn instanced. The vertex shader samples the
// heightmap and geomorphs vertices toward the next-coarser grid near the end of each LOD range, so
// there are no cracks or popping.
//
// The quadtree covers the map plus a surround. Outside the map the heightmap is sampled mirrored and
// the shader fades it into haze, so the region reads as part of a larger world instead of a slab.

import * as THREE from 'three';
import { TERRAIN_FS, TERRAIN_VS } from './terrainShader';

const GRID_N = 32;
const MAX_NODES = 1024;
const MIN_RANGE_K = 3;
const FINE_QUAD_M = 6;

export interface HeightSource {
  texture: THREE.Texture;
  /** texture value * scale = metres */
  scale: number;
  nx: number;
  ny: number;
  /** CPU heights in metres (for LOD bounds, picking, readouts) */
  cpu: Float32Array;
  kmPerPx: number;
}

/** Mirror a coordinate into [0, size] (matches the shader). */
export function mirror(v: number, size: number): number {
  const u = v / size;
  const m = 1 - Math.abs((((u % 2) + 2) % 2) - 1);
  return m * size;
}

function makePatchGeometry(n: number): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  let k = 0;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    pos[k++] = i / n; pos[k++] = 0; pos[k++] = j / n;
  }
  const idx: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    // alternate diagonals for a more isotropic mesh
    if ((i + j) & 1) idx.push(a, c, b, b, c, d);
    else idx.push(a, c, d, a, d, b);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  const inst = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NODES * 4), 4);
  inst.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aNode', inst);
  g.instanceCount = 0;
  return g;
}

/** Min/max height pyramid at leaf-node granularity over the extended (mirrored) domain. */
class BoundsPyramid {
  levels: { min: Float32Array; max: Float32Array; n: number }[] = [];
  constructor(src: HeightSource, worldW: number, worldH: number, ox: number, oz: number, leafKm: number, maxLevel: number) {
    const n0 = 1 << maxLevel;
    const min0 = new Float32Array(n0 * n0);
    const max0 = new Float32Array(n0 * n0);
    const { nx, ny, cpu, kmPerPx } = src;
    const S = 6;
    const samples = n0 * S + 1;
    const columnOf = new Int32Array(samples), rowOf = new Int32Array(samples);
    for (let t = 0; t < samples; t++) {
      columnOf[t] = Math.min(nx - 1, Math.max(0, Math.floor(mirror(ox + (t / S) * leafKm, worldW) / kmPerPx)));
      rowOf[t] = Math.min(ny - 1, Math.max(0, Math.floor(mirror(oz + (t / S) * leafKm, worldH) / kmPerPx)));
    }
    for (let cz = 0; cz < n0; cz++) for (let cx = 0; cx < n0; cx++) {
      let mn = Infinity, mx = -Infinity;
      for (let b = 0; b <= S; b++) {
        const row = rowOf[cz * S + b] * nx;
        for (let a = 0; a <= S; a++) {
          const v = cpu[row + columnOf[cx * S + a]];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      }
      min0[cz * n0 + cx] = mn;
      max0[cz * n0 + cx] = mx;
    }
    this.levels.push({ min: min0, max: max0, n: n0 });
    for (let l = 1; l <= maxLevel; l++) {
      const p = this.levels[l - 1];
      const n = p.n >> 1;
      const mn = new Float32Array(n * n), mx = new Float32Array(n * n);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = (2 * j) * p.n + 2 * i;
        mn[j * n + i] = Math.min(p.min[a], p.min[a + 1], p.min[a + p.n], p.min[a + p.n + 1]);
        mx[j * n + i] = Math.max(p.max[a], p.max[a + 1], p.max[a + p.n], p.max[a + p.n + 1]);
      }
      this.levels.push({ min: mn, max: mx, n });
    }
  }
}

export class Terrain {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private readonly overviewMaterial: THREE.ShaderMaterial;
  private geom: THREE.InstancedBufferGeometry;
  private worldW = 1;
  private worldH = 1;
  /** origin of the extended domain (negative: the surround) */
  private ox = 0;
  private oz = 0;
  leafKm = 1;
  private maxLevel = 1;
  minLevel = 0;
  private bounds: BoundsPyramid | null = null;
  private detailAt: ((x: number, z: number) => number) | null = null;
  private leafDetail = new Int8Array(0);
  private frustum = new THREE.Frustum();
  private box = new THREE.Box3();
  private projView = new THREE.Matrix4();
  exag = 1.5;
  /** target edge length of a mesh quad on screen, in pixels, at the distance a patch splits */
  pxPerQuad = 8;
  rangeK = MIN_RANGE_K;
  /** extra metres of slack in bounds (erosion/deposition, water) */
  boundsSlackM = 150;
  /** how far the surround extends beyond the map, as a fraction of the larger map side */
  surround = 0.7;
  nodeCount = 0;
  private order: { x0: number; z0: number; size: number; level: number; d: number }[] = [];

  constructor(uniforms: Record<string, THREE.IUniform>) {
    this.geom = makePatchGeometry(GRID_N);
    this.material = new THREE.ShaderMaterial({
      defines: { SURFACE_DETAIL: 1 },
      vertexShader: TERRAIN_VS,
      fragmentShader: TERRAIN_FS,
      uniforms: { ...uniforms, uGridN: { value: GRID_N }, uLeafRange: { value: 10 }, uMinLevel: { value: 0 }, uCoarseKm: { value: 1 }, uOrigin: { value: new THREE.Vector2() }, uSurfaceFade: { value: 1 } },
    });
    // Compile fine detail out of the overview path: skipped texture fetches alone
    // still leave register/instruction overhead on integrated Intel graphics.
    this.overviewMaterial = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VS,
      fragmentShader: TERRAIN_FS,
      uniforms: this.material.uniforms,
    });
    this.mesh = new THREE.Mesh(this.geom, this.overviewMaterial);
    this.mesh.frustumCulled = false;
  }

  setSurfaceDetail(aglM: number, mapMode: boolean) {
    const fade = mapMode ? 0 : 1 - THREE.MathUtils.smoothstep(aglM, 1000, 3000);
    this.material.uniforms.uSurfaceFade.value = fade;
    this.mesh.material = fade > 0 ? this.material : this.overviewMaterial;
  }

  /** Configure world size and the heightmap the LOD bounds come from. */
  setSource(src: HeightSource, worldW: number, worldH: number) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.leafKm = GRID_N * src.kmPerPx;
    this.minLevel = -Math.max(0, Math.ceil(Math.log2(src.kmPerPx * 1000 / FINE_QUAD_M)));
    this.material.uniforms.uMinLevel.value = this.minLevel;
    const ext = Math.max(worldW, worldH) * this.surround;
    const span = Math.max(worldW, worldH) + 2 * ext;
    this.maxLevel = Math.max(1, Math.ceil(Math.log2(span / this.leafKm)));
    const root = this.leafKm * Math.pow(2, this.maxLevel);
    // centre the root on the map
    this.ox = worldW / 2 - root / 2;
    this.oz = worldH / 2 - root / 2;
    this.bounds = new BoundsPyramid(src, worldW, worldH, this.ox, this.oz, this.leafKm, this.maxLevel);
    this.leafDetail = new Int8Array(1 << (2 * this.maxLevel)).fill(-1);
    this.material.uniforms.uCoarseKm.value = this.leafKm / GRID_N;
    (this.material.uniforms.uOrigin.value as THREE.Vector2).set(this.ox, this.oz);
    this.material.uniforms.uLeafRange.value = this.leafKm * this.rangeK;
  }

  /** Mesh density follows the viewport, so a bigger window does not mean thinner triangles. */
  setViewportHeight(px: number, fovDeg: number) {
    const pxAtUnitDistance = px / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.rangeK = Math.max(MIN_RANGE_K, pxAtUnitDistance / (GRID_N * this.pxPerQuad));
  }

  setDetailCoverage(detailAt: ((x: number, z: number) => number) | null) {
    this.detailAt = detailAt;
    this.leafDetail.fill(-1);
  }

  private hasDetail(ix: number, iz: number): boolean {
    if (!this.detailAt) return false;
    const n = 1 << this.maxLevel;
    if (ix < 0 || iz < 0 || ix >= n || iz >= n) return false;
    const k = iz * n + ix;
    if (this.leafDetail[k] < 0) {
      let on = 0;
      const x0 = this.ox + ix * this.leafKm, z0 = this.oz + iz * this.leafKm, S = 14;
      for (let j = -1; j <= S + 1 && !on; j++) for (let i = -1; i <= S + 1 && !on; i++) {
        if (this.detailAt(x0 + (i / S) * this.leafKm, z0 + (j / S) * this.leafKm) > 0) on = 1;
      }
      this.leafDetail[k] = on;
    }
    return this.leafDetail[k] === 1;
  }

  private fineAt(x: number, z: number): boolean {
    return this.hasDetail(Math.floor((x - this.ox) / this.leafKm), Math.floor((z - this.oz) / this.leafKm));
  }

  get fineQuadM(): number { return this.leafKm * 1000 / GRID_N * Math.pow(2, this.minLevel); }

  surfaceHeightAt(x: number, z: number, base: (x:number,z:number)=>number, detail?: (x:number,z:number)=>number): number {
    const h = this.triangleAt(x, z, this.leafKm / GRID_N, base);
    return detail && this.fineAt(x, z) ? h + this.triangleAt(x, z, this.fineQuadM / 1000, detail) : h;
  }

  private triangleAt(x: number, z: number, cell: number, sample: (x:number,z:number)=>number): number {
    const gx=(x-this.ox)/cell,gz=(z-this.oz)/cell;
    const i=Math.floor(gx),j=Math.floor(gz),tx=gx-i,tz=gz-j;
    const x0=this.ox+i*cell,z0=this.oz+j*cell;
    const a=sample(x0,z0),b=sample(x0+cell,z0),c=sample(x0,z0+cell),d=sample(x0+cell,z0+cell);
    if((i+j)&1) return tx+tz<=1 ? a+(b-a)*tx+(c-a)*tz : d+(c-d)*(1-tx)+(b-d)*(1-tz);
    return tx>=tz ? a+(b-a)*tx+(d-b)*tz : a+(d-c)*tx+(c-a)*tz;
  }

  update(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, showSurround = true, viewportWidthPx = 1500) {
    if (!this.bounds) return;
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const arr = (this.geom.getAttribute('aNode') as THREE.InstancedBufferAttribute).array as Float32Array;
    let count = 0;
    const cam = camera.position;
    const leafRange = this.material.uniforms.uLeafRange.value as number;
    const s = 0.001 * this.exag;
    const slack = this.boundsSlackM * s;
    const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera;
    const ext = Math.max(this.worldW, this.worldH) * this.surround;
    const lim = showSurround ? { x0: -ext, z0: -ext, x1: this.worldW + ext, z1: this.worldH + ext } : { x0: 0, z0: 0, x1: this.worldW, z1: this.worldH };
    let orthoLeafRatio = 1;
    if (ortho) {
      const oc = camera as THREE.OrthographicCamera;
      const viewKm = (oc.right - oc.left) / oc.zoom;
      orthoLeafRatio = Math.max(1, ((viewKm / viewportWidthPx) * this.pxPerQuad * GRID_N) / this.leafKm);
    }
    const visit = (ix: number, iz: number, level: number) => {
      const size = this.leafKm * Math.pow(2, level);
      const x0 = this.ox + ix * size, z0 = this.oz + iz * size;
      if (x0 >= lim.x1 || z0 >= lim.z1 || x0 + size <= lim.x0 || z0 + size <= lim.z0) return;
      const up = Math.max(0, -level);
      const L = this.bounds!.levels[Math.max(0, level)];
      const mn = L.min[(iz >> up) * L.n + (ix >> up)], mx = L.max[(iz >> up) * L.n + (ix >> up)];
      this.box.min.set(Math.max(x0, lim.x0), Math.min(mn, 0) * s - slack, Math.max(z0, lim.z0));
      this.box.max.set(Math.min(x0 + size, lim.x1), Math.max(mx, 0) * s + slack, Math.min(z0 + size, lim.z1));
      if (!this.frustum.intersectsBox(this.box)) return;
      const add = () => {
        if (count >= MAX_NODES) return;
        const dx = Math.max(x0 - cam.x, cam.x - x0 - size, 0), dz = Math.max(z0 - cam.z, cam.z - z0 - size, 0);
        this.order[count] = { x0, z0, size, level, d: dx * dx + dz * dz };
        count++;
      };
      if (level === this.minLevel) return add();
      if (level <= 0 && !this.hasDetail(ix >> -level, iz >> -level)) return add();
      const subRange = leafRange * Math.pow(2, level - 1);
      const d = ortho ? Infinity : this.box.distanceToPoint(cam);
      const wantSplit = ortho ? level > 0 && size / this.leafKm > orthoLeafRatio : d < subRange;
      if (!wantSplit) return add();
      visit(ix * 2, iz * 2, level - 1);
      visit(ix * 2 + 1, iz * 2, level - 1);
      visit(ix * 2, iz * 2 + 1, level - 1);
      visit(ix * 2 + 1, iz * 2 + 1, level - 1);
    };
    visit(0, 0, this.maxLevel);
    const visible = this.order.slice(0, count).sort((a, b) => a.d - b.d);
    for (let i = 0; i < count; i++) {
      const n = visible[i];
      arr[i * 4] = n.x0; arr[i * 4 + 1] = n.z0; arr[i * 4 + 2] = n.size; arr[i * 4 + 3] = n.level;
    }
    (this.geom.getAttribute('aNode') as THREE.InstancedBufferAttribute).needsUpdate = true;
    this.geom.instanceCount = count;
    this.nodeCount = count;
  }
}
