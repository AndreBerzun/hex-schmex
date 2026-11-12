import * as THREE from 'three';
import { KINDS, TIERS, type Kind, type Placed, type Tier } from '../../core/scenery/kit';
import type { SceneryCells } from '../../core/scenery/store';
import { ATMOS, LANDMARK_SHADOW } from '../glsl';
import { buildKind, type Lod } from './kit';
import { SUN_SHADOW_GLSL, type ShadowCaster } from '../sunShadow';
import { INK_GLSL } from '../inkStyle';
import { GROUND_GLSL } from '../groundTextures';

const VS = /* glsl */ `
attribute vec4 aA;
attribute vec4 aB;
attribute vec4 aC;
attribute vec3 color;
uniform float uPxPerRad;
uniform float uAlbedo;
uniform float uExag;
uniform vec2 uTexOrigin;
uniform vec3 uEye;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vColor;
varying float vVis;
varying vec3 vTexP;
vec3 lean(vec3 v, vec2 l) {
  float a = length(l);
  if (a < 1e-4) return v;
  vec3 k = vec3(l.y, 0.0, -l.x) / a;
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
void main() {
  vec3 p = position * aB.xyz;
  vec3 n = normal / aB.xyz;
  float cy = cos(aA.w), sy = sin(aA.w);
  p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
  n = vec3(n.x * cy + n.z * sy, n.y, -n.x * sy + n.z * cy);
  p = lean(p, aC.xy);
  n = lean(n, aC.xy);
  vec3 base = vec3(aA.x, aA.y * 0.001 * uExag, aA.z);
  vec3 wp = base + vec3(p.x, p.y * uExag, p.z) * 0.001;
  float d = distance(uEye, base + vec3(0.0, aC.w * 0.0004 * uExag, 0.0));
  float px = aC.w * 0.001 * uPxPerRad / max(d, 1e-5);
  float vis = (1.0 - smoothstep(aC.z * 0.78, aC.z, d)) * smoothstep(0.8, 2.0, px);
  vVis = vis;
  vColor = color * aB.w * uAlbedo;
  vNormal = normalize(vec3(n.x, n.y / uExag, n.z));
  vWorld = wp;
  vTexP = vec3((aA.x - uTexOrigin.x) * 1000.0 + p.x, aA.y + p.y, (aA.z - uTexOrigin.y) * 1000.0 + p.z);
  gl_Position = vis <= 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const DEPTH_FS = /* glsl */ `
varying float vVis;
void main() {
  if (vVis < 0.5) discard;
  gl_FragColor = vec4(1.0);
}`;

const FS = ATMOS + LANDMARK_SHADOW + SUN_SHADOW_GLSL + INK_GLSL + /* glsl */ `
uniform sampler2D uShadowTex;
uniform vec2 uGridKm;
${GROUND_GLSL}
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vColor;
varying float vVis;
varying vec3 vTexP;
const vec3 LUMA = vec3(0.3, 0.55, 0.15);
float paintedTone(float t, vec3 p, vec3 n, float tileM, float meanLuma) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= dot(w, vec3(1.0));
  vec3 c = groundTex(t, p.zy / tileM) * w.x + groundTex(t, p.xz / tileM) * w.y + groundTex(t, p.xy / tileM) * w.z;
  return clamp(dot(c, LUMA) / meanLuma, 0.25, 2.2);
}
void main() {
  if (vVis < 0.999) {
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (vVis < dither) discard;
  }
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  float shadow = texture2D(uShadowTex, clamp(vWorld.xz / uGridKm, 0.0, 1.0)).r * landmarkShadow(vWorld) * sunShadow(vWorld);
  vec3 skyAmb = mix(srgb(vec3(0.3, 0.29, 0.24)), uSkyZenith * 1.15, n.y * 0.5 + 0.5);
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 fillDir = normalize(vec3(-uSunDir.x, 0.35, -uSunDir.z) + vec3(0.0001, 0.0, 0.0));
  float fill = max(dot(n, fillDir), 0.0) * 0.45 + (1.0 - abs(n.y)) * 0.35 + max(-n.y, 0.0) * 0.3;
  float coral = smoothstep(0.25, 0.55, (vColor.r - max(vColor.g, vColor.b)) / max(vColor.r, 1e-4));
  float tone = coral > 0.01 ? paintedTone(L_CORAL_TURF, vTexP, n, 1.6, 0.19) : 1.0;
  if (coral < 0.99) tone = mix(paintedTone(L_CORAL_ROCK, vTexP, n, 2.0, 0.33), tone, coral);
  vec2 inkM = vec2(vTexP.x + vTexP.y * 0.6, vTexP.z - vTexP.y * 0.4);
  vec2 inked = inkLight(ndl, ndl * shadow, inkM, distance(vWorld, cameraPosition), length(fwidth(vTexP)));
  vec3 col = vColor * tone * (uSunColor * (inked.x * 3.1 + fill * (1.0 - 0.5 * uInkOn)) + skyAmb * 0.66);
  gl_FragColor = vec4(toDisplay(applyAtmosphere(col, vWorld, cameraPosition)), 1.0 - inked.y);
}`;

const MAX_RANGE: Partial<Record<Kind, number>> = {
  'coral-tree': 2.6, 'coral-wall': 1.6, 'fan-coral': 1.1, 'brain-mound': 0.9, 'reed-bed': 1.4, boulder: 1.6, 'tube-sponge': 2, 'dead-trunk': 1.8, ribs: 1.4,
};
const FLOATS = 12;
const MIN_PX: Record<Tier, number> = { near: 6, mid: 3, far: 1.6 };
const ALTITUDE_CUTOFF_M: Record<Tier, number> = { near: 250, mid: 3000, far: 15000 };

interface Batch { mesh: THREE.Mesh; geo: THREE.InstancedBufferGeometry; buf: THREE.InstancedInterleavedBuffer; capacity: number; count: number }

export class Scenery implements ShadowCaster {
  readonly group = new THREE.Group();
  readonly stats = { instances: 0, cells: 0, pending: false, updateMs: 0, triangles: 0, batches: 0 };
  readonly material: THREE.ShaderMaterial;
  private depthMaterial!: THREE.ShaderMaterial;
  private cells: SceneryCells | null = null;
  private width = 0;
  private height = 0;
  private bases = new Map<string, THREE.BufferGeometry>();
  private batches = new Map<string, Batch>();
  private signature = '';
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private box = new THREE.Box3();
  private sphere = new THREE.Sphere();
  private scratch = new Map<string, number[]>();
  forceLod: Lod | null = null;

  constructor(uniforms: Record<string, THREE.IUniform>) {
    this.material = new THREE.ShaderMaterial({ uniforms: { ...uniforms, uPxPerRad: { value: 900 }, uAlbedo: { value: 0.5 }, uEye: { value: new THREE.Vector3() } }, vertexShader: VS, fragmentShader: FS });
    this.depthMaterial = new THREE.ShaderMaterial({ uniforms: this.material.uniforms, vertexShader: VS, fragmentShader: DEPTH_FS, side: THREE.DoubleSide });
    this.group.frustumCulled = false;
  }

  setCells(cells: SceneryCells | null, width: number, height: number) {
    this.cells = cells; this.width = width; this.height = height;
    this.signature = '';
    for (const b of this.batches.values()) { b.count = 0; b.geo.instanceCount = 0; b.mesh.visible = false; }
    this.group.visible = !!cells;
  }

  private base(kind: Kind, variant: number, lod: Lod): THREE.BufferGeometry {
    const key = `${kind}:${variant}:${lod}`;
    let g = this.bases.get(key);
    if (!g) { g = buildKind(kind, variant, lod); this.bases.set(key, g); }
    return g;
  }

  private batch(key: string, need: number): Batch {
    const old = this.batches.get(key);
    if (old && old.capacity >= need) return old;
    if (old) { this.group.remove(old.mesh); old.geo.dispose(); }
    const [kind, variant, lod] = key.split(':');
    const capacity = 2 ** Math.ceil(Math.log2(Math.max(64, need * 1.3)));
    const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(capacity * FLOATS), FLOATS);
    buf.setUsage(THREE.DynamicDrawUsage);
    const base = this.base(kind as Kind, Number(variant), Number(lod) as Lod);
    const geo = new THREE.InstancedBufferGeometry();
    for (const name of ['position', 'normal', 'color']) geo.setAttribute(name, base.getAttribute(name));
    geo.setAttribute('aA', new THREE.InterleavedBufferAttribute(buf, 4, 0));
    geo.setAttribute('aB', new THREE.InterleavedBufferAttribute(buf, 4, 4));
    geo.setAttribute('aC', new THREE.InterleavedBufferAttribute(buf, 4, 8));
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    const b = { mesh, geo, buf, capacity, count: 0 };
    this.batches.set(key, b);
    return b;
  }

  renderDepth(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    if (!this.group.visible) return;
    for (const b of this.batches.values()) b.mesh.material = this.depthMaterial;
    renderer.render(this.group, camera);
    for (const b of this.batches.values()) b.mesh.material = this.material;
  }

  sizeM(o: Placed): number {
    if (o.kind === 'coral-wall') return Math.max(o.heightM, o.sx * 8);
    return o.heightM * Math.max(1, KINDS[o.kind].footRatio * 0.7);
  }

  update(camera: THREE.PerspectiveCamera, aglM: number, viewportPx: number, budgetMs: number, hidden: boolean): boolean {
    const cells = this.cells;
    if (!cells || hidden) { this.group.visible = false; this.stats.pending = false; return false; }
    this.group.visible = true;
    const t0 = performance.now();
    const pxPerRad = viewportPx / THREE.MathUtils.degToRad(camera.fov);
    this.material.uniforms.uPxPerRad.value = pxPerRad;
    const cp = camera.position;
    (this.material.uniforms.uEye.value as THREE.Vector3).copy(cp);
    const q = camera.quaternion;
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const exag = (this.material.uniforms.uExag?.value as number) ?? 1;
    const visible: { tier: Tier; cx: number; cz: number; d: number }[] = [];
    for (const tier of ['near', 'mid', 'far'] as Tier[]) {
      if (aglM > ALTITUDE_CUTOFF_M[tier]) continue;
      const { cellKm, rangeKm } = TIERS[tier];
      const r = rangeKm + cellKm;
      for (let cz = Math.max(0, Math.floor((cp.z - r) / cellKm)); cz <= Math.min(Math.ceil(this.height / cellKm), Math.floor((cp.z + r) / cellKm)); cz++) {
        for (let cx = Math.max(0, Math.floor((cp.x - r) / cellKm)); cx <= Math.min(Math.ceil(this.width / cellKm), Math.floor((cp.x + r) / cellKm)); cx++) {
          const dx = Math.max(cx * cellKm - cp.x, cp.x - (cx + 1) * cellKm, 0), dz = Math.max(cz * cellKm - cp.z, cp.z - (cz + 1) * cellKm, 0);
          const d = Math.hypot(dx, dz);
          if (d > rangeKm) continue;
          this.box.min.set(cx * cellKm - 0.15, -3 * exag, cz * cellKm - 0.15);
          this.box.max.set((cx + 1) * cellKm + 0.15, 15 * exag, (cz + 1) * cellKm + 0.15);
          if (!this.frustum.intersectsBox(this.box)) continue;
          visible.push({ tier, cx, cz, d });
        }
      }
    }
    visible.sort((a, b) => a.d - b.d);
    let pending = false, generated = 0;
    const ready: { tier: Tier; cx: number; cz: number }[] = [];
    for (const v of visible) {
      if (cells.peek(v.tier, v.cx, v.cz)) { ready.push(v); continue; }
      if (generated === 0 || performance.now() - t0 < budgetMs) { cells.get(v.tier, v.cx, v.cz); generated++; ready.push(v); }
      else pending = true;
    }
    const sig = `${Math.round(cp.x * 500)},${Math.round(cp.y * 500 / exag)},${Math.round(cp.z * 500)},${q.x.toFixed(3)},${q.y.toFixed(3)},${q.z.toFixed(3)},${q.w.toFixed(3)},${ready.length},${viewportPx},${camera.aspect.toFixed(3)},${camera.fov},${exag}`;
    if (sig !== this.signature || generated) {
      this.signature = sig;
      this.rebuild(ready, cp, pxPerRad, exag);
    }
    this.stats.pending = pending;
    this.stats.cells = ready.length;
    this.stats.updateMs = performance.now() - t0;
    return pending;
  }

  private rebuild(ready: { tier: Tier; cx: number; cz: number }[], cp: THREE.Vector3, pxPerRad: number, exag: number) {
    const sc = this.scratch;
    for (const arr of sc.values()) arr.length = 0;
    let total = 0;
    for (const v of ready) {
      const cell = this.cells!.peek(v.tier, v.cx, v.cz);
      if (!cell) continue;
      const tierRange = TIERS[v.tier].rangeKm;
      for (const o of cell.objects) {
        const size = this.sizeM(o);
        const range = Math.min(MAX_RANGE[o.kind] ?? tierRange, size * 0.001 * pxPerRad / MIN_PX[v.tier]);
        const yKm = o.y * 0.001 * exag;
        const d = Math.hypot(o.x - cp.x, yKm + o.heightM * 0.0004 * exag - cp.y, o.z - cp.z);
        if (d > range) continue;
        this.sphere.center.set(o.x, yKm + o.heightM * 0.0005 * exag, o.z);
        this.sphere.radius = size * 0.0008 * Math.max(1, exag) + 0.002;
        if (!this.frustum.intersectsSphere(this.sphere)) continue;
        const px = size * 0.001 * pxPerRad / Math.max(d, 1e-5);
        const lod: Lod = this.forceLod ?? (px > 70 ? 0 : px > 16 ? 1 : 2);
        const key = `${o.kind}:${o.variant}:${lod}`;
        let arr = sc.get(key);
        if (!arr) { arr = []; sc.set(key, arr); }
        arr.push(o.x, o.y, o.z, o.yaw, o.sx, o.sy, o.sz, o.tint, o.leanX, o.leanZ, range, size);
        total++;
      }
    }
    for (const b of this.batches.values()) { b.count = 0; b.geo.instanceCount = 0; b.mesh.visible = false; }
    let tris = 0, batches = 0;
    for (const [key, arr] of sc) {
      const n = arr.length / FLOATS;
      if (!n) continue;
      const b = this.batch(key, n);
      (b.buf.array as Float32Array).set(arr);
      b.buf.needsUpdate = true;
      b.count = n; b.geo.instanceCount = n; b.mesh.visible = true;
      tris += n * (b.geo.getAttribute('position').count / 3);
      batches++;
    }
    this.stats.instances = total;
    this.stats.triangles = tris;
    this.stats.batches = batches;
  }

  kindCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, b] of this.batches) if (b.count) { const k = key.split(':')[0]; out[k] = (out[k] ?? 0) + b.count; }
    return out;
  }

  dispose() {
    for (const b of this.batches.values()) { b.geo.dispose(); this.group.remove(b.mesh); }
    for (const g of this.bases.values()) g.dispose();
    this.batches.clear(); this.bases.clear();
  }
}
