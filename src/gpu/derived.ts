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

export class DerivedMaps {
  readonly gc: GPUCompute;
  shadow: THREE.WebGLRenderTarget;
  ao: THREE.WebGLRenderTarget;
  private shadowMat: THREE.RawShaderMaterial;
  private aoMat: THREE.RawShaderMaterial;
  private w = 0;
  private h = 0;

  constructor(gc: GPUCompute) {
    this.gc = gc;
    this.shadow = this.mk(4, 4);
    this.ao = this.mk(4, 4);
    const u = () => ({
      uHeight: { value: null }, uHeightScale: { value: 1 }, uExag: { value: 1 }, uTexel: { value: new THREE.Vector2() }, uCellM: { value: 100 },
    });
    this.shadowMat = gc.material(SHADOW_FS, { ...u(), uSun: { value: new THREE.Vector3(0, 1, 0) } });
    this.aoMat = gc.material(AO_FS, u());
  }

  private mk(w: number, h: number) {
    return this.gc.target(w, h, { type: THREE.UnsignedByteType, filter: THREE.LinearFilter });
  }

  private ensure(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    this.shadow.dispose(); this.ao.dispose();
    this.shadow = this.mk(w, h);
    this.ao = this.mk(w, h);
    this.w = w; this.h = h;
  }

  private setCommon(m: THREE.RawShaderMaterial, tex: THREE.Texture, w: number, h: number, scale: number, exag: number, cellM: number) {
    m.uniforms.uHeight.value = tex;
    m.uniforms.uHeightScale.value = scale;
    m.uniforms.uExag.value = exag;
    (m.uniforms.uTexel.value as THREE.Vector2).set(1 / w, 1 / h);
    m.uniforms.uCellM.value = cellM;
  }

  /** Lighting maps at most `maxRes` on the long side. */
  update(tex: THREE.Texture, w: number, h: number, scale: number, exag: number, cellM: number, sun: THREE.Vector3, what: { shadow?: boolean; ao?: boolean }, maxRes = 2048) {
    const f = Math.max(1, Math.ceil(Math.max(w, h) / maxRes));
    const tw = Math.round(w / f), th = Math.round(h / f);
    this.ensure(tw, th);
    const cm = cellM * f;
    if (what.shadow) {
      this.setCommon(this.shadowMat, tex, tw, th, scale, exag, cm);
      (this.shadowMat.uniforms.uSun.value as THREE.Vector3).copy(sun);
      this.gc.run(this.shadowMat, this.shadow);
    }
    if (what.ao) {
      this.setCommon(this.aoMat, tex, tw, th, scale, exag, cm);
      this.gc.run(this.aoMat, this.ao);
    }
  }
}
