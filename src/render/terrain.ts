// CDLOD terrain: a quadtree of fixed-size grid patches, drawn instanced. The vertex shader samples the
// heightmap and geomorphs vertices toward the next-coarser grid near the end of each LOD range, so
// there are no cracks or popping.
//
// The quadtree covers the map plus a surround. Outside the map the heightmap is sampled mirrored and
// the shader fades it into haze, so the region reads as part of a larger world instead of a slab.

import * as THREE from 'three';
import { TERRAIN_FS, TERRAIN_VS } from './terrainShader';

const GRID_N = 64;
const MAX_NODES = 4096;

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
    for (let cz = 0; cz < n0; cz++) for (let cx = 0; cx < n0; cx++) {
      let mn = Infinity, mx = -Infinity;
      for (let b = 0; b <= S; b++) for (let a = 0; a <= S; a++) {
        const x = mirror(ox + (cx + a / S) * leafKm, worldW), z = mirror(oz + (cz + b / S) * leafKm, worldH);
        const i = Math.min(nx - 1, Math.max(0, Math.floor(x / kmPerPx))), j = Math.min(ny - 1, Math.max(0, Math.floor(z / kmPerPx)));
        const v = cpu[j * nx + i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
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
  private geom: THREE.InstancedBufferGeometry;
  private worldW = 1;
  private worldH = 1;
  /** origin of the extended domain (negative: the surround) */
  private ox = 0;
  private oz = 0;
  leafKm = 1;
  private maxLevel = 1;
  private bounds: BoundsPyramid | null = null;
  private frustum = new THREE.Frustum();
  private box = new THREE.Box3();
  private projView = new THREE.Matrix4();
  exag = 1.5;
  /** LOD range multiplier: range of level 0 = leafKm * rangeK (higher = more triangles) */
  rangeK = 4;
  /** extra metres of slack in bounds (erosion/deposition, water) */
  boundsSlackM = 150;
  /** how far the surround extends beyond the map, as a fraction of the larger map side */
  surround = 0.7;
  nodeCount = 0;

  constructor(uniforms: Record<string, THREE.IUniform>) {
    this.geom = makePatchGeometry(GRID_N);
    this.material = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VS,
      fragmentShader: TERRAIN_FS,
      uniforms: { ...uniforms, uGridN: { value: GRID_N }, uLeafRange: { value: 10 } },
    });
    this.mesh = new THREE.Mesh(this.geom, this.material);
    this.mesh.frustumCulled = false;
  }

  /** Configure world size and the heightmap the LOD bounds come from. */
  setSource(src: HeightSource, worldW: number, worldH: number) {
    this.worldW = worldW;
    this.worldH = worldH;
    // leaf patches have ~2 vertices per height texel so close-up detail has geometry to live on
    this.leafKm = (GRID_N * src.kmPerPx) / 2;
    const ext = Math.max(worldW, worldH) * this.surround;
    const span = Math.max(worldW, worldH) + 2 * ext;
    this.maxLevel = Math.max(1, Math.ceil(Math.log2(span / this.leafKm)));
    const root = this.leafKm * Math.pow(2, this.maxLevel);
    // centre the root on the map
    this.ox = worldW / 2 - root / 2;
    this.oz = worldH / 2 - root / 2;
    this.bounds = new BoundsPyramid(src, worldW, worldH, this.ox, this.oz, this.leafKm, this.maxLevel);
    this.material.uniforms.uLeafRange.value = this.leafKm * this.rangeK;
  }

  update(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, showSurround = true) {
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
      // ~1 patch vertex per 2 screen pixels at 1500 px wide
      orthoLeafRatio = Math.max(1, ((viewKm / 1500) * 2 * GRID_N) / this.leafKm);
    }
    const visit = (ix: number, iz: number, level: number) => {
      const size = this.leafKm * Math.pow(2, level);
      const x0 = this.ox + ix * size, z0 = this.oz + iz * size;
      if (x0 >= lim.x1 || z0 >= lim.z1 || x0 + size <= lim.x0 || z0 + size <= lim.z0) return;
      const L = this.bounds!.levels[level];
      const mn = L.min[iz * L.n + ix], mx = L.max[iz * L.n + ix];
      this.box.min.set(Math.max(x0, lim.x0), Math.min(mn, 0) * s - slack, Math.max(z0, lim.z0));
      this.box.max.set(Math.min(x0 + size, lim.x1), Math.max(mx, 0) * s + slack, Math.min(z0 + size, lim.z1));
      if (!this.frustum.intersectsBox(this.box)) return;
      const add = () => {
        if (count >= MAX_NODES) return;
        arr[count * 4] = x0; arr[count * 4 + 1] = z0; arr[count * 4 + 2] = size; arr[count * 4 + 3] = level;
        count++;
      };
      if (level === 0) return add();
      const subRange = leafRange * Math.pow(2, level - 1);
      const d = ortho ? Infinity : this.box.distanceToPoint(cam);
      const wantSplit = ortho ? size / this.leafKm > orthoLeafRatio : d < subRange;
      if (!wantSplit) return add();
      visit(ix * 2, iz * 2, level - 1);
      visit(ix * 2 + 1, iz * 2, level - 1);
      visit(ix * 2, iz * 2 + 1, level - 1);
      visit(ix * 2 + 1, iz * 2 + 1, level - 1);
    };
    visit(0, 0, this.maxLevel);
    (this.geom.getAttribute('aNode') as THREE.InstancedBufferAttribute).needsUpdate = true;
    this.geom.instanceCount = count;
    this.nodeCount = count;
  }
}
