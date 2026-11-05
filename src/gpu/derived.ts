// Derived lighting maps from the heightfield: soft sun shadows (ray march toward the sun) and
// horizon-based ambient occlusion. Both are stored as 8-bit textures at heightmap resolution.

import * as THREE from 'three';
import { GPUCompute } from './compute';

const HEIGHT_COMMON = /* glsl */ `
uniform sampler2D uHeight;
uniform float uHeightScale; // texture value -> metres
uniform float uExag;
uniform vec2 uTexel;        // 1 / size
uniform float uCellM;       // metres per texel
float H(vec2 uv) { return texture(uHeight, uv).r * uHeightScale * uExag; }
`;

const SHADOW_FS = HEIGHT_COMMON + /* glsl */ `
uniform vec3 uSun; // world dir toward sun: x east, y up, z south
void main() {
  vec2 uv = vUv;
  float h0 = H(uv) + 2.0;
  vec2 dir = normalize(uSun.xz + 1e-6);
  float tanE = uSun.y / max(1e-4, length(uSun.xz));
  float vis = 1.0;
  float t = 1.0;
  for (int i = 0; i < 72; i++) {
    vec2 p = uv + dir * t * uTexel;
    if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) break;
    float ray = h0 + t * uCellM * tanE;
    float d = H(p) - ray;
    // penumbra: blocking depth relative to distance travelled
    vis = min(vis, clamp(1.0 - d / (t * uCellM * 0.06 + 15.0), 0.0, 1.0));
    if (vis <= 0.0) break;
    t += max(1.0, t * 0.08);
  }
  outColor = vec4(vis, vis, vis, 1.0);
}`;

const AO_FS = HEIGHT_COMMON + /* glsl */ `
void main() {
  vec2 uv = vUv;
  float h0 = H(uv);
  float occ = 0.0;
  for (int d = 0; d < 12; d++) {
    float a = float(d) * 6.2831853 / 12.0 + 0.3;
    vec2 dir = vec2(cos(a), sin(a));
    float maxS = 0.0;
    float t = 1.0;
    for (int i = 0; i < 10; i++) {
      vec2 p = uv + dir * t * uTexel;
      float dh = H(clamp(p, 0.0, 1.0)) - h0;
      maxS = max(maxS, dh / (t * uCellM));
      t *= 1.65;
    }
    occ += maxS / sqrt(1.0 + maxS * maxS); // sin of horizon angle
  }
  float ao = 1.0 - occ / 12.0;
  outColor = vec4(ao, ao, ao, 1.0);
}`;

const DRAFT_RES = 512;
const FULL_RES = 2048;
const BANDS_PER_PASS = 32;

export interface LightingSource {
  texture: THREE.Texture;
  w: number;
  h: number;
  scale: number;
  exag: number;
  cellM: number;
  sun: THREE.Vector3;
}

interface LightingMaps {
  shadow: THREE.WebGLRenderTarget;
  ao: THREE.WebGLRenderTarget;
}

function bands(rows: number): { y: number; height: number }[] {
  const out = [];
  const height = Math.ceil(rows / BANDS_PER_PASS);
  for (let y = 0; y < rows; y += height) out.push({ y, height: Math.min(height, rows - y) });
  return out;
}

const SURFACE_FS = HEIGHT_COMMON + /* glsl */ `
void main() {
  float h = H(vUv);
  float hL = H(vUv - vec2(uTexel.x, 0.0)), hR = H(vUv + vec2(uTexel.x, 0.0));
  float hD = H(vUv - vec2(0.0, uTexel.y)), hU = H(vUv + vec2(0.0, uTexel.y));
  vec2 grad = vec2(hR - hL, hU - hD) / (2.0 * uCellM);
  outColor = vec4(grad, (hL + hR + hD + hU - 4.0 * h) / uCellM, length(grad));
}`;

const SETTLED_HEIGHT_FS = HEIGHT_COMMON + /* glsl */ `
void main() {
  outColor = vec4(H(vUv));
}`;

export class DerivedMaps {
  readonly gc: GPUCompute;
  private shadowMat: THREE.RawShaderMaterial;
  private aoMat: THREE.RawShaderMaterial;
  private draftMaps: LightingMaps | null = null;
  private fullMaps: LightingMaps | null = null;
  private showing: LightingMaps | null = null;
  private job: { run: () => void }[] = [];
  private jobEnd: (() => void) | null = null;
  private surfaceMat: THREE.RawShaderMaterial;
  private settledMat: THREE.RawShaderMaterial;
  private surfaceTarget: THREE.WebGLRenderTarget | null = null;
  private settledTarget: THREE.WebGLRenderTarget | null = null;

  constructor(gc: GPUCompute) {
    this.gc = gc;
    const u = () => ({
      uHeight: { value: null }, uHeightScale: { value: 1 }, uExag: { value: 1 }, uTexel: { value: new THREE.Vector2() }, uCellM: { value: 100 },
    });
    this.shadowMat = gc.material(SHADOW_FS, { ...u(), uSun: { value: new THREE.Vector3(0, 1, 0) } });
    this.aoMat = gc.material(AO_FS, u());
    this.surfaceMat = gc.material(SURFACE_FS, u());
    this.settledMat = gc.material(SETTLED_HEIGHT_FS, u());
  }

  private mipmapped(previous: THREE.WebGLRenderTarget | null, w: number, h: number, format: THREE.AnyPixelFormat, type: THREE.TextureDataType, internal: 'RGBA16F' | 'R32F') {
    if (previous && previous.width === w && previous.height === h) return previous;
    previous?.dispose();
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type,
      format: format as THREE.PixelFormat,
      internalFormat: internal,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: true,
    });
    return rt;
  }

  /** Slope, curvature and mean slope per texel: one mipmapped fetch per pixel instead of five raw ones. */
  surface(s: LightingSource): THREE.Texture {
    this.surfaceTarget = this.mipmapped(this.surfaceTarget, s.w, s.h, THREE.RGBAFormat, THREE.HalfFloatType, 'RGBA16F');
    this.bind(this.surfaceMat, s, s.w, s.h);
    this.surfaceMat.uniforms.uExag.value = 1;
    this.gc.run(this.surfaceMat, this.surfaceTarget);
    return this.surfaceTarget.texture;
  }

  /** The finished height field in metres, single channel and mipmapped, for the time after the simulation. */
  settledHeight(s: LightingSource): THREE.Texture {
    this.settledTarget = this.mipmapped(this.settledTarget, s.w, s.h, THREE.RedFormat, THREE.FloatType, 'R32F');
    this.bind(this.settledMat, s, s.w, s.h);
    this.settledMat.uniforms.uExag.value = 1;
    this.gc.run(this.settledMat, this.settledTarget);
    return this.settledTarget.texture;
  }

  get current(): { shadow: THREE.Texture; ao: THREE.Texture } {
    return { shadow: this.showing!.shadow.texture, ao: this.showing!.ao.texture };
  }

  get fullPending() { return this.job.length > 0; }

  private fit(maps: LightingMaps | null, w: number, h: number): LightingMaps {
    if (maps && maps.shadow.width === w && maps.shadow.height === h) return maps;
    if (maps) { maps.shadow.dispose(); maps.ao.dispose(); }
    const mk = () => this.gc.target(w, h, { type: THREE.UnsignedByteType, filter: THREE.LinearFilter });
    return { shadow: mk(), ao: mk() };
  }

  private bind(m: THREE.RawShaderMaterial, s: LightingSource, w: number, h: number) {
    m.uniforms.uHeight.value = s.texture;
    m.uniforms.uHeightScale.value = s.scale;
    m.uniforms.uExag.value = s.exag;
    (m.uniforms.uTexel.value as THREE.Vector2).set(1 / w, 1 / h);
    m.uniforms.uCellM.value = s.cellM * (s.w / w);
    if (m === this.shadowMat) (m.uniforms.uSun.value as THREE.Vector3).copy(s.sun);
  }

  private sizeFor(s: LightingSource, maxRes: number): [number, number] {
    const f = Math.max(1, Math.ceil(Math.max(s.w, s.h) / maxRes));
    return [Math.round(s.w / f), Math.round(s.h / f)];
  }

  /** A low-resolution pair right now, cheap enough to run during a slider drag or erosion. */
  draft(s: LightingSource) {
    const [w, h] = this.sizeFor(s, DRAFT_RES);
    this.draftMaps = this.fit(this.draftMaps, w, h);
    this.bind(this.shadowMat, s, w, h);
    this.gc.run(this.shadowMat, this.draftMaps.shadow);
    this.bind(this.aoMat, s, w, h);
    this.gc.run(this.aoMat, this.draftMaps.ao);
    this.showing = this.draftMaps;
  }

  /** Queue the full-resolution pair as bands; the view keeps showing what it has until they are done. */
  startFull(s: LightingSource) {
    const [w, h] = this.sizeFor(s, FULL_RES);
    this.fullMaps = this.fit(this.fullMaps, w, h);
    const maps = this.fullMaps;
    const pass = (mat: THREE.RawShaderMaterial, target: THREE.WebGLRenderTarget) => bands(h).map((b) => ({
      run: () => {
        this.bind(mat, s, w, h);
        this.gc.runBand(mat, target, b.y, b.height);
      },
    }));
    this.job = [...pass(this.shadowMat, maps.shadow), ...pass(this.aoMat, maps.ao)];
    this.jobEnd = () => { this.showing = maps; };
  }

  cancelFull() {
    this.job = [];
    this.jobEnd = null;
  }

  /** Runs one band. True on the step that finishes the full pair. */
  stepFull(): boolean {
    const next = this.job.shift();
    if (!next) return false;
    next.run();
    if (this.job.length > 0) return false;
    this.jobEnd?.();
    this.jobEnd = null;
    return true;
  }

  finishFull() {
    while (this.fullPending) this.stepFull();
  }
}
