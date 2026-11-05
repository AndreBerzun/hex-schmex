// CDLOD terrain: a quadtree of fixed-size grid patches, drawn instanced. The vertex shader samples the
// heightmap and geomorphs vertices toward the next-coarser grid near the end of each LOD range, so
// there are no cracks or popping.

import * as THREE from 'three';
import { TERRAIN_FS, TERRAIN_VS } from './terrainShader';

const GRID_N = 64;
const MAX_NODES = 2048;

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

/** Min/max height pyramid at leaf-node granularity. */
class BoundsPyramid {
  levels: { min: Float32Array; max: Float32Array; n: number }[] = [];
  constructor(src: HeightSource, worldW: number, worldH: number, leafKm: number, maxLevel: number) {
    const n0 = 1 << maxLevel;
    const min0 = new Float32Array(n0 * n0).fill(Infinity);
    const max0 = new Float32Array(n0 * n0).fill(-Infinity);
    const { nx, ny, cpu, kmPerPx } = src;
    const step = Math.max(1, Math.floor(leafKm / kmPerPx / 8));
    for (let j = 0; j < ny; j += step) {
      const z = (j + 0.5) * kmPerPx;
      const cz = Math.min(n0 - 1, Math.floor(z / leafKm));
      for (let i = 0; i < nx; i += step) {
        const x = (i + 0.5) * kmPerPx;
        const cx = Math.min(n0 - 1, Math.floor(x / leafKm));
        const v = cpu[j * nx + i];
        const k = cz * n0 + cx;
        if (v < min0[k]) min0[k] = v;
        if (v > max0[k]) max0[k] = v;
      }
    }
    void worldW; void worldH;
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
  leafKm = 1;
  private maxLevel = 1;
  private bounds: BoundsPyramid | null = null;
  private frustum = new THREE.Frustum();
  private box = new THREE.Box3();
  private projView = new THREE.Matrix4();
  exag = 1.5;
  /** extra metres of slack in bounds (erosion/deposition, water) */
  boundsSlackM = 150;
  nodeCount = 0;

  constructor(uniforms: Record<string, THREE.IUniform>) {
    this.geom = makePatchGeometry(GRID_N);
    this.material = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VS,
      fragmentShader: TERRAIN_FS,
      uniforms: { ...uniforms, uGridN: { value: GRID_N }, uLeafRange: { value: 10 } },
      extensions: {},
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
    this.maxLevel = Math.max(1, Math.ceil(Math.log2(Math.max(worldW, worldH) / this.leafKm)));
    this.bounds = new BoundsPyramid(src, worldW, worldH, this.leafKm, this.maxLevel);
    this.material.uniforms.uLeafRange.value = this.leafKm * 2.2;
  }

  update(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera) {
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
    const visit = (x0: number, z0: number, size: number, level: number) => {
      if (x0 >= this.worldW || z0 >= this.worldH) return;
      const L = this.bounds!.levels[level];
      const n = L.n;
      const ix = Math.round(x0 / size), iz = Math.round(z0 / size);
      if (ix >= n || iz >= n) return;
      const mn = L.min[iz * n + ix], mx = L.max[iz * n + ix];
      if (mn === Infinity) return;
      this.box.min.set(x0, Math.min(mn, 0) * s - slack, z0);
      this.box.max.set(Math.min(x0 + size, this.worldW), Math.max(mx, 0) * s + slack, Math.min(z0 + size, this.worldH));
      if (!this.frustum.intersectsBox(this.box)) return;
      const add = () => {
        if (count >= MAX_NODES) return;
        arr[count * 4] = x0; arr[count * 4 + 1] = z0; arr[count * 4 + 2] = size; arr[count * 4 + 3] = level;
        count++;
      };
      if (level === 0) return add();
      // ortho (map mode): pick level by pixel footprint instead of distance
      const subRange = leafRange * Math.pow(2, level - 1);
      const d = ortho ? Infinity : this.box.distanceToPoint(cam);
      const wantSplit = ortho ? size / this.leafKm > orthoLeafRatio : d < subRange;
      if (!wantSplit) return add();
      const h = size / 2;
      visit(x0, z0, h, level - 1);
      visit(x0 + h, z0, h, level - 1);
      visit(x0, z0 + h, h, level - 1);
      visit(x0 + h, z0 + h, h, level - 1);
    };
    let orthoLeafRatio = 1;
    if (ortho) {
      const oc = camera as THREE.OrthographicCamera;
      const viewKm = (oc.right - oc.left) / oc.zoom;
      // ~1 patch vertex per 2 screen pixels at 1500 px wide
      orthoLeafRatio = Math.max(1, (viewKm / 1500) * 2 * GRID_N / this.leafKm);
      // the shader morph uses distance; push ortho camera ranges to "infinite" detail by level choice only
    }
    const root = this.leafKm * Math.pow(2, this.maxLevel);
    visit(0, 0, root, this.maxLevel);
    (this.geom.getAttribute('aNode') as THREE.InstancedBufferAttribute).needsUpdate = true;
    this.geom.instanceCount = count;
    this.nodeCount = count;
  }
}
