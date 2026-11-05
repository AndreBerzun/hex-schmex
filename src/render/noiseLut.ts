import * as THREE from 'three';
import { GPUCompute } from '../gpu/compute';

const LUT_SIZE = 1024;
const LUT_CELLS = 32;

const BAKE_FS = /* glsl */ `
uniform float uCells;
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float periodicGradient(vec2 p, float period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 g00 = hash22(mod(i, period)) * 2.0 - 1.0;
  vec2 g10 = hash22(mod(i + vec2(1.0, 0.0), period)) * 2.0 - 1.0;
  vec2 g01 = hash22(mod(i + vec2(0.0, 1.0), period)) * 2.0 - 1.0;
  vec2 g11 = hash22(mod(i + vec2(1.0, 1.0), period)) * 2.0 - 1.0;
  float a = dot(g00, f);
  float b = dot(g10, f - vec2(1.0, 0.0));
  float c = dot(g01, f - vec2(0.0, 1.0));
  float d = dot(g11, f - vec2(1.0, 1.0));
  return 1.6 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float periodicValue(vec2 p, float period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(mod(i, period));
  float b = hash12(mod(i + vec2(1.0, 0.0), period));
  float c = hash12(mod(i + vec2(0.0, 1.0), period));
  float d = hash12(mod(i + vec2(1.0, 1.0), period));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 cell) {
  float s = 0.0, a = 0.5, f = 1.0;
  for (int i = 0; i < 4; i++) {
    s += a * periodicGradient(cell * f + float(i) * 17.0, uCells * f);
    f *= 2.0;
    a *= 0.5;
  }
  return s;
}
void main() {
  vec2 cell = vUv * uCells;
  float e = 1.0 / 64.0;
  float v = fbm(cell);
  vec2 g = vec2(fbm(cell + vec2(e, 0.0)) - fbm(cell - vec2(e, 0.0)), fbm(cell + vec2(0.0, e)) - fbm(cell - vec2(0.0, e))) / (2.0 * e);
  float cellular = periodicValue(vUv * 256.0, 256.0);
  outColor = vec4(v / 3.0 + 0.5, g / 12.0 + 0.5, cellular);
}`;

export const NOISE_LUT = /* glsl */ `
uniform sampler2D uNoise;
float gFw;
const mat2 LUT_ROT = mat2(0.8, 0.6, -0.6, 0.8);
vec4 lutFetch(vec2 xz, float wavelength) {
  float perPx = gFw / wavelength;
  return texture2DLodEXT(uNoise, LUT_ROT * xz / (wavelength * ${LUT_CELLS.toFixed(1)}), log2(max(perPx * ${(LUT_SIZE / LUT_CELLS).toFixed(1)}, 1.0)));
}
float noiseAt(vec2 xz, float wavelength) {
  if (gFw > wavelength * 0.7) return 0.0;
  return (lutFetch(xz, wavelength).r - 0.5) * 3.0;
}
vec2 noiseGradAt(vec2 xz, float wavelength) {
  if (gFw > wavelength * 0.7) return vec2(0.0);
  return (lutFetch(xz, wavelength).gb - 0.5) * 12.0;
}
float cellAt(vec2 xz, float wavelength) {
  return texture2DLodEXT(uNoise, LUT_ROT * xz / (wavelength * 256.0), log2(max(gFw / wavelength * 4.0, 1.0))).a;
}
`;

export function bakeNoiseLut(gc: GPUCompute): THREE.Texture {
  const rt = new THREE.WebGLRenderTarget(LUT_SIZE, LUT_SIZE, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: true,
  });
  const mat = gc.material(BAKE_FS, { uCells: { value: LUT_CELLS } });
  gc.run(mat, rt);
  mat.dispose();
  return rt.texture;
}
