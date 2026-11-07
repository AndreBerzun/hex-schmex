// Crown shape and normals are baked once. No cellular search in the terrain's
// per-pixel shader, and no geometry or change to the walkable heightfield.
import * as THREE from 'three';
import { GPUCompute, GLSL_NOISE } from '../gpu/compute';

const SIZE = 512;
const CELLS = 32;
export const CANOPY_TILE_KM = CELLS * 0.012;

const BAKE_FS = GLSL_NOISE + /* glsl */ `
float leaves(vec2 p, float period) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(mod(i, period)), hash12(mod(i + vec2(1,0), period)), u.x),
             mix(hash12(mod(i + vec2(0,1), period)), hash12(mod(i + vec2(1,1), period)), u.x), u.y) - 0.5;
}
float foliage(vec2 p) {
  return leaves(p * 5.0, 160.0) * 1.2 + leaves(p * 13.0, 416.0) * 0.5;
}
void main() {
  vec2 p = vUv * ${CELLS.toFixed(1)};
  vec2 cell = floor(p);
  float height = 0.0;
  vec2 gradient = vec2(0.0);
  float tint = 0.5;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 id = cell + vec2(float(x), float(y));
    vec2 periodic = mod(id, ${CELLS.toFixed(1)});
    vec2 seed = hash22(periodic);
    vec2 centre = id + 0.5 + (seed - 0.5) * 0.95;
    vec2 delta = p - centre;
    float angle = seed.y * 6.2831853;
    mat2 rotation = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
    delta = rotation * delta;
    vec2 radius = vec2(0.55, 0.65) + hash22(periodic + 71.0) * 0.5;
    float peak = 5.0 + seed.x * 7.0;
    float cap = max(0.0, 1.0 - dot(delta / radius, delta / radius));
    float h = cap * peak;
    vec2 slope = cap > 0.0 ? (-2.0 * delta / (radius * radius) * peak / 12.0) * rotation : vec2(0.0);
    // Round the joins between neighbouring crowns instead of sharp plate edges.
    float blend = clamp(0.5 + 0.5 * (h - height) / 1.5, 0.0, 1.0);
    height = mix(height, h, blend) + 1.5 * blend * (1.0 - blend);
    gradient = mix(gradient, slope, blend);
    tint = mix(tint, seed.y, blend);
  }
  float e = 0.015;
  gradient += vec2(foliage(p + vec2(e,0)) - foliage(p - vec2(e,0)),
                   foliage(p + vec2(0,e)) - foliage(p - vec2(0,e))) / (2.0 * e * 12.0);
  height = max(0.0, height + foliage(p));
  // Store slopes, not unit normals, so mipmaps converge to a flat canopy.
  outColor = vec4(gradient / 8.0 + 0.5, height / 12.0, tint);
}`;

export function bakeCanopyLut(gc: GPUCompute): THREE.Texture {
  const rt = new THREE.WebGLRenderTarget(SIZE, SIZE, {
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
  const mat = gc.material(BAKE_FS, {});
  gc.run(mat, rt);
  mat.dispose();
  return rt.texture;
}
