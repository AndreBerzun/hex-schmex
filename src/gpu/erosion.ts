// GPU hydraulic erosion (virtual pipe model, Mei, Decaudin & Hu 2007) + thermal erosion.
//
// Simulation space is normalised: one cell = 1 unit horizontally, heights are metres / cellMetres,
// so slopes are geometric and talus angles are real. The renderer multiplies by cellMetres.
//
// Textures (RGBA32F, ping-pong):
//   T: x terrain b, y water d, z suspended sediment s, w deposition accumulator
//   F: outflow flux to (-x, +x, -y, +y)
//   V: x,y velocity, z discharge (EMA, used for debug), w erosion accumulator
//   O1/O2: thermal outflow to cardinal / diagonal neighbours

import * as THREE from 'three';
import { GLSL_NOISE, GPUCompute, PingPong } from './compute';

export interface ErosionParams {
  iterations: number;
  /** multiplier on capacity / dissolve */
  strength: number;
  rain: number;
  talusDeg: number;
  thermal: number;
  seed: number;
}

const COMMON = /* glsl */ `
uniform ivec2 uSize;
ivec2 P() { return ivec2(gl_FragCoord.xy); }
bool inside(ivec2 p) { return p.x >= 0 && p.y >= 0 && p.x < uSize.x && p.y < uSize.y; }
vec4 fetch(sampler2D t, ivec2 p) { return texelFetch(t, clamp(p, ivec2(0), uSize - 1), 0); }
`;

const INIT_FS = COMMON + GLSL_NOISE + /* glsl */ `
uniform sampler2D uDesign;   // R32F metres, linear filtered
uniform float uCellM;
uniform float uSeaM;
uniform vec2 uSeed;
uniform float uDetailM;
void main() {
  vec2 uv = (vec2(P()) + 0.5) / vec2(uSize);
  float h = texture(uDesign, uv).r;
  vec2 e = 1.0 / vec2(uSize);
  float hx = texture(uDesign, uv + vec2(e.x, 0.0)).r - texture(uDesign, uv - vec2(e.x, 0.0)).r;
  float hy = texture(uDesign, uv + vec2(0.0, e.y)).r - texture(uDesign, uv - vec2(0.0, e.y)).r;
  float slope = length(vec2(hx, hy)) / (2.0 * uCellM);
  // small ridged detail, stronger on slopes and at altitude: gives erosion something to bite on
  vec2 p = vec2(P()) * uCellM / 1400.0 + uSeed;
  float det = ridgedFbm(p, 5) - 0.45;
  float amp = uDetailM * (0.25 + 1.5 * clamp(slope, 0.0, 1.0)) * smoothstep(uSeaM - 50.0, uSeaM + 300.0, h);
  float b = (h + det * amp) / uCellM;
  float seaB = uSeaM / uCellM;
  float d = max(0.0, seaB - b);
  outColor = vec4(b, d, 0.0, 0.0);
}`;

const FLUX_FS = COMMON + /* glsl */ `
uniform sampler2D uT;
uniform sampler2D uF;
uniform float uDt;
uniform float uK;
uniform float uDamp;
float Hn(ivec2 p, vec4 self) {
  if (!inside(p)) return self.x; // open boundary: water leaves the map
  vec4 t = texelFetch(uT, p, 0);
  return t.x + t.y;
}
void main() {
  ivec2 p = P();
  vec4 t = texelFetch(uT, p, 0);
  float H = t.x + t.y;
  vec4 dh = H - vec4(Hn(p + ivec2(-1, 0), t), Hn(p + ivec2(1, 0), t), Hn(p + ivec2(0, -1), t), Hn(p + ivec2(0, 1), t));
  vec4 f = max(vec4(0.0), texelFetch(uF, p, 0) * uDamp + uDt * uK * dh);
  float sum = f.x + f.y + f.z + f.w;
  float K = sum > 1e-9 ? min(1.0, t.y / (sum * uDt)) : 0.0;
  outColor = f * K;
}`;

const WATER_FS = COMMON + /* glsl */ `
uniform sampler2D uT;
uniform sampler2D uF;
uniform float uDt;
float fin(ivec2 p, int comp) {
  if (!inside(p)) return 0.0;
  return texelFetch(uF, p, 0)[comp];
}
void main() {
  ivec2 p = P();
  vec4 t = texelFetch(uT, p, 0);
  vec4 f = texelFetch(uF, p, 0);
  float inflow = fin(p + ivec2(-1, 0), 1) + fin(p + ivec2(1, 0), 0) + fin(p + ivec2(0, -1), 3) + fin(p + ivec2(0, 1), 2);
  float outflow = f.x + f.y + f.z + f.w;
  float d2 = max(0.0, t.y + uDt * (inflow - outflow));
  outColor = vec4(t.x, d2, t.z, t.w);
}`;

const VEL_FS = COMMON + /* glsl */ `
uniform sampler2D uTold;
uniform sampler2D uTnew;
uniform sampler2D uF;
uniform sampler2D uV;
uniform float uDt;
float fc(ivec2 p, int comp) {
  if (!inside(p)) return 0.0;
  return texelFetch(uF, p, 0)[comp];
}
void main() {
  ivec2 p = P();
  vec4 f = texelFetch(uF, p, 0);
  float wx = (fc(p + ivec2(-1, 0), 1) - f.x + f.y - fc(p + ivec2(1, 0), 0)) * 0.5;
  float wy = (fc(p + ivec2(0, -1), 3) - f.z + f.w - fc(p + ivec2(0, 1), 2)) * 0.5;
  float d1 = texelFetch(uTold, p, 0).y;
  float d2 = texelFetch(uTnew, p, 0).y;
  float dAvg = 0.5 * (d1 + d2);
  vec2 vel = dAvg > 1e-4 ? vec2(wx, wy) / dAvg : vec2(0.0);
  float vmax = 0.9 / uDt; // CFL-ish limit: never move more than ~a cell per step
  float vl = length(vel);
  if (vl > vmax) vel *= vmax / vl;
  vec4 old = texelFetch(uV, p, 0);
  float q = length(vec2(wx, wy));
  outColor = vec4(vel, mix(old.z, q, 0.02), old.w);
}`;

const ERODE_FS = COMMON + GLSL_NOISE + /* glsl */ `
uniform sampler2D uT;
uniform sampler2D uV;
uniform float uKc;      // capacity, metres of sediment at full slope/speed/depth
uniform float uKs;      // dissolve fraction per step
uniform float uKd;      // deposit fraction per step
uniform float uMinTilt;
uniform float uDmaxM;   // water depth (m) at which capacity saturates
uniform float uMaxCutM; // max erosion per step, m
uniform float uVref;    // speed (cells/time) at which capacity saturates
uniform float uCellM;
uniform float uSeaB;
uniform vec2 uSeed;
void main() {
  ivec2 p = P();
  vec4 t = texelFetch(uT, p, 0);
  vec4 v = texelFetch(uV, p, 0);
  float bl = fetch(uT, p + ivec2(-1, 0)).x, br = fetch(uT, p + ivec2(1, 0)).x;
  float bd = fetch(uT, p + ivec2(0, -1)).x, bu = fetch(uT, p + ivec2(0, 1)).x;
  vec2 g = vec2(br - bl, bu - bd) * 0.5;
  float sl = length(g);
  float sinT = sl / sqrt(1.0 + sl * sl);
  float speed = min(length(v.xy) / uVref, 1.0);
  float dM = t.y * uCellM;
  float lmax = clamp(dM / uDmaxM, 0.0, 1.0);
  float C = uKc * max(sinT, uMinTilt) * speed * lmax;  // metres
  // rock hardness: horizontal strata (benches) plus patchiness
  float hM = t.x * uCellM;
  float strata = 0.5 + 0.5 * sin(hM / 85.0 + 3.0 * gnoise(vec2(p) * uCellM / 9000.0 + uSeed));
  float hard = mix(0.55, 1.0, strata) * mix(0.8, 1.2, gnoise(vec2(p) * uCellM / 20000.0 - uSeed) * 0.5 + 0.5);
  float bM = t.x * uCellM, sM = t.z * uCellM, dep = t.w;
  float lowest = min(min(bl, br), min(bd, bu)) * uCellM;
  if (C > sM) {
    // never dig below the lowest neighbour: channels deepen by draining, not by pitting
    float amt = min(uKs * (C - sM) / hard, min(uMaxCutM, max(0.0, bM - lowest) * 0.45));
    if (t.x < uSeaB) amt *= 0.2;
    bM -= amt; sM += amt;
  } else {
    float amt = uKd * (sM - C);
    bM += amt; sM -= amt; dep += amt / uCellM;
  }
  outColor = vec4(bM / uCellM, t.y, sM / uCellM, dep);
}`;

const ADVECT_FS = COMMON + GLSL_NOISE + /* glsl */ `
uniform sampler2D uT;
uniform sampler2D uV;
uniform float uDt;
uniform float uKe;      // evaporation fraction per step
uniform float uRain;    // rain per step, in cell units (metres / cellM)
uniform float uIter;
uniform float uSeaB;
float sAt(vec2 c) {
  vec2 q = c - 0.5;
  ivec2 i = ivec2(floor(q));
  vec2 f = fract(q);
  float a = fetch(uT, i).z, b = fetch(uT, i + ivec2(1, 0)).z;
  float cc = fetch(uT, i + ivec2(0, 1)).z, d = fetch(uT, i + ivec2(1, 1)).z;
  return mix(mix(a, b, f.x), mix(cc, d, f.x), f.y);
}
void main() {
  ivec2 p = P();
  vec4 t = texelFetch(uT, p, 0);
  vec2 vel = texelFetch(uV, p, 0).xy;
  float s = sAt(vec2(p) + 0.5 - vel * uDt);
  float d = t.y * (1.0 - uKe);
  // rain: uneven per step, so channels self-organise instead of sheet-flowing
  float r = hash12(vec2(p) * 0.37 + vec2(uIter * 13.1, uIter * 7.7));
  d += uRain * (r * r * 3.0);
  if (t.x < uSeaB) d = max(d, uSeaB - t.x); // sea keeps its level
  outColor = vec4(t.x, d, s, t.w);
}`;

const THERMAL_OUT_FS = COMMON + /* glsl */ `
uniform sampler2D uT;
uniform float uTalus;
uniform float uRate;
uniform int uDiag;
const ivec2 N[8] = ivec2[8](ivec2(-1, 0), ivec2(1, 0), ivec2(0, -1), ivec2(0, 1), ivec2(-1, -1), ivec2(1, -1), ivec2(-1, 1), ivec2(1, 1));
void main() {
  ivec2 p = P();
  float b = texelFetch(uT, p, 0).x;
  float ex[8];
  float total = 0.0, mx = 0.0;
  for (int i = 0; i < 8; i++) {
    ivec2 q = p + N[i];
    float dist = i < 4 ? 1.0 : 1.41421356;
    float e = 0.0;
    if (inside(q)) e = max(0.0, (b - texelFetch(uT, q, 0).x) - uTalus * dist);
    ex[i] = e;
    total += e;
    mx = max(mx, e);
  }
  float amount = uRate * mx * 0.5;
  float k = total > 1e-9 ? amount / total : 0.0;
  if (uDiag == 0) outColor = vec4(ex[0], ex[1], ex[2], ex[3]) * k;
  else outColor = vec4(ex[4], ex[5], ex[6], ex[7]) * k;
}`;

const THERMAL_APPLY_FS = COMMON + /* glsl */ `
uniform sampler2D uT;
uniform sampler2D uO1;
uniform sampler2D uO2;
float o1(ivec2 q, int c) { return inside(q) ? texelFetch(uO1, q, 0)[c] : 0.0; }
float o2(ivec2 q, int c) { return inside(q) ? texelFetch(uO2, q, 0)[c] : 0.0; }
void main() {
  ivec2 p = P();
  vec4 t = texelFetch(uT, p, 0);
  vec4 a = texelFetch(uO1, p, 0), d = texelFetch(uO2, p, 0);
  float out_ = a.x + a.y + a.z + a.w + d.x + d.y + d.z + d.w;
  // inflow: neighbour at p+n sends toward -n
  float in_ = o1(p + ivec2(-1, 0), 1) + o1(p + ivec2(1, 0), 0) + o1(p + ivec2(0, -1), 3) + o1(p + ivec2(0, 1), 2)
            + o2(p + ivec2(-1, -1), 3) + o2(p + ivec2(1, -1), 2) + o2(p + ivec2(-1, 1), 1) + o2(p + ivec2(1, 1), 0);
  float moved = in_ - out_;
  // scree: count material arriving as deposition so materials can show talus fans
  outColor = vec4(t.x + moved, t.y, t.z, t.w + max(0.0, moved) * 0.5);
}`;

export class Erosion {
  readonly gc: GPUCompute;
  readonly nx: number;
  readonly ny: number;
  readonly cellM: number;
  readonly seaM: number;
  T: PingPong;
  F: PingPong;
  V: PingPong;
  O1: THREE.WebGLRenderTarget;
  O2: THREE.WebGLRenderTarget;
  iteration = 0;
  params: ErosionParams;
  private mats: Record<string, THREE.RawShaderMaterial> = {};
  private dt = 0.12;

  constructor(gc: GPUCompute, nx: number, ny: number, cellM: number, seaM: number, params: ErosionParams) {
    this.gc = gc;
    this.nx = nx;
    this.ny = ny;
    this.cellM = cellM;
    this.seaM = seaM;
    this.params = params;
    // texelFetch ignores filtering, so T can be linear-filtered for the renderer at no cost to the sim
    this.T = new PingPong(gc, nx, ny, { filter: THREE.LinearFilter });
    this.F = new PingPong(gc, nx, ny);
    this.V = new PingPong(gc, nx, ny);
    this.O1 = gc.target(nx, ny);
    this.O2 = gc.target(nx, ny);
    const size = { value: new THREE.Vector2(nx, ny) };
    const u = (o: Record<string, unknown>) => {
      const r: Record<string, THREE.IUniform> = { uSize: size as THREE.IUniform };
      for (const k in o) r[k] = { value: o[k] };
      return r;
    };
    const seed = new THREE.Vector2((params.seed % 997) * 1.37, (params.seed % 991) * 0.71);
    this.mats.init = gc.material(INIT_FS, u({ uDesign: null, uCellM: cellM, uSeaM: seaM, uSeed: seed, uDetailM: 45 }));
    this.mats.flux = gc.material(FLUX_FS, u({ uT: null, uF: null, uDt: this.dt, uK: 1.0, uDamp: 0.995 }));
    this.mats.water = gc.material(WATER_FS, u({ uT: null, uF: null, uDt: this.dt }));
    this.mats.vel = gc.material(VEL_FS, u({ uTold: null, uTnew: null, uF: null, uV: null, uDt: this.dt }));
    this.mats.erode = gc.material(ERODE_FS, u({ uT: null, uV: null, uKc: 0, uKs: 0, uKd: 0, uMinTilt: 0.02, uDmaxM: 1.2, uMaxCutM: 0.6, uVref: 3.0, uCellM: cellM, uSeaB: seaM / cellM, uSeed: seed }));
    this.mats.advect = gc.material(ADVECT_FS, u({ uT: null, uV: null, uDt: this.dt, uKe: 0.02, uRain: 0, uIter: 0, uSeaB: seaM / cellM }));
    this.mats.tout = gc.material(THERMAL_OUT_FS, u({ uT: null, uTalus: 0, uRate: 0, uDiag: 0 }));
    this.mats.tapply = gc.material(THERMAL_APPLY_FS, u({ uT: null, uO1: this.O1.texture, uO2: this.O2.texture }));
    this.setParams(params);
  }

  setParams(p: ErosionParams) {
    this.params = p;
    // physical constants in metres; rain converted to cell units
    this.mats.erode.uniforms.uKc.value = 6.0 * p.strength;
    this.mats.erode.uniforms.uKs.value = 0.06 * p.strength;
    this.mats.erode.uniforms.uKd.value = 0.08;
    this.mats.advect.uniforms.uRain.value = (0.012 * p.rain) / this.cellM;
    this.mats.tout.uniforms.uTalus.value = Math.tan((p.talusDeg * Math.PI) / 180);
    this.mats.tout.uniforms.uRate.value = 0.5 * p.thermal;
  }

  /** Reset the simulation from a design heightmap texture (metres). */
  start(design: THREE.Texture) {
    this.mats.init.uniforms.uDesign.value = design;
    this.gc.run(this.mats.init, this.T.read);
    const zero = this.gc.material('void main(){ outColor = vec4(0.0); }', {});
    this.gc.run(zero, this.F.read);
    this.gc.run(zero, this.V.read);
    zero.dispose();
    this.iteration = 0;
  }

  get done() { return this.iteration >= this.params.iterations; }
  get progress() { return Math.min(1, this.iteration / Math.max(1, this.params.iterations)); }
  get texture() { return this.T.read.texture; }

  step(n = 1) {
    const m = this.mats;
    for (let k = 0; k < n && !this.done; k++) {
      // 1 flux
      m.flux.uniforms.uT.value = this.T.read.texture;
      m.flux.uniforms.uF.value = this.F.read.texture;
      this.gc.run(m.flux, this.F.write);
      this.F.swap();
      // 2 water depth
      m.water.uniforms.uT.value = this.T.read.texture;
      m.water.uniforms.uF.value = this.F.read.texture;
      this.gc.run(m.water, this.T.write);
      // 3 velocity (needs old and new water)
      m.vel.uniforms.uTold.value = this.T.read.texture;
      m.vel.uniforms.uTnew.value = this.T.write.texture;
      m.vel.uniforms.uF.value = this.F.read.texture;
      m.vel.uniforms.uV.value = this.V.read.texture;
      this.gc.run(m.vel, this.V.write);
      this.V.swap();
      this.T.swap();
      // 4 erosion / deposition
      m.erode.uniforms.uT.value = this.T.read.texture;
      m.erode.uniforms.uV.value = this.V.read.texture;
      this.gc.run(m.erode, this.T.write);
      this.T.swap();
      // 5 sediment transport + evaporation + rain
      m.advect.uniforms.uT.value = this.T.read.texture;
      m.advect.uniforms.uV.value = this.V.read.texture;
      m.advect.uniforms.uIter.value = this.iteration;
      this.gc.run(m.advect, this.T.write);
      this.T.swap();
      // 6 thermal (every other step is plenty)
      if (this.params.thermal > 0 && (this.iteration & 1) === 0) {
        m.tout.uniforms.uT.value = this.T.read.texture;
        m.tout.uniforms.uDiag.value = 0;
        this.gc.run(m.tout, this.O1);
        m.tout.uniforms.uDiag.value = 1;
        this.gc.run(m.tout, this.O2);
        m.tapply.uniforms.uT.value = this.T.read.texture;
        this.gc.run(m.tapply, this.T.write);
        this.T.swap();
      }
      this.iteration++;
    }
  }

  /** Read back terrain (metres), water depth (m) and deposition. */
  readback(): { height: Float32Array; water: Float32Array; deposit: Float32Array } {
    const raw = this.gc.read(this.T.read);
    const n = this.nx * this.ny;
    const height = new Float32Array(n), water = new Float32Array(n), deposit = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      height[i] = raw[i * 4] * this.cellM;
      water[i] = raw[i * 4 + 1] * this.cellM;
      deposit[i] = raw[i * 4 + 3] * this.cellM;
    }
    return { height, water, deposit };
  }

  dispose() {
    this.T.dispose(); this.F.dispose(); this.V.dispose(); this.O1.dispose(); this.O2.dispose();
    for (const k in this.mats) this.mats[k].dispose();
  }
}
