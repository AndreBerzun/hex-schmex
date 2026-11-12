import type * as THREE from 'three';

export const INK_GLSL = /* glsl */ `
uniform float uInkOn;
float inkHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float inkNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(inkHash(i), inkHash(i + vec2(1.0, 0.0)), f.x), mix(inkHash(i + vec2(0.0, 1.0)), inkHash(i + 1.0), f.x), f.y);
}
vec2 inkLight(float ndl, float sunVis, vec2 m, float distKm, float mPerPx) {
  float on = uInkOn * (1.0 - smoothstep(1.2, 5.0, distKm));
  if (on <= 0.0) return vec2(sunVis, 0.0);
  float fine = 1.0 - smoothstep(0.08, 0.35, mPerPx * 3.0);
  float j = (inkNoise(m * 3.0) - 0.5) * 0.16 * fine + (inkNoise(m * 0.45 + 7.3) - 0.5) * 0.3;
  float ink = 1.0 - smoothstep(0.12, 0.34, sunVis + j);
  float flatLit = 0.68 + 0.32 * smoothstep(0.25, 0.65, ndl);
  return vec2(mix(sunVis, flatLit, on), ink * on);
}
`;

export function inkUniforms(): Record<string, THREE.IUniform> {
  return { uInkOn: { value: 0 } };
}
