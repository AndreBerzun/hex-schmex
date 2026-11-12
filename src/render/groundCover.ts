import * as THREE from 'three';
import { ATMOS } from './glsl';
import { SUN_SHADOW_GLSL } from './sunShadow';
import { INK_GLSL } from './inkStyle';
import { GROUND_GLSL } from './groundTextures';

const MAP_PX = 256;
const MAP_KM = 0.064;
const BLADES = 7;
const RINGS = [
  { cellM: 0.32, innerM: 0, fadeInM: 0, fadeOutM: 9, radiusM: 11, scale: 1 },
  { cellM: 0.75, innerM: 8.5, fadeInM: 9, fadeOutM: 22, radiusM: 28, scale: 1.35 },
];

const COMMON = /* glsl */ `
uniform sampler2D uCoverMap;
uniform mat4 uCoverMat;
uniform vec2 uGridCenter;
uniform float uCellKm;
uniform vec4 uFade;
uniform float uRingScale;
uniform vec3 uEye;
uniform vec2 uTexOrigin;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vTexM;
varying float vTip;
varying float vKind;
uint coverHash(ivec2 c, uint salt) {
  uint h = uint(c.x) * 0x8da6b343u ^ uint(c.y) * 0xd8163841u ^ salt * 0xcb1ab31fu;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return h;
}
float coverRand(ivec2 c, uint salt) { return float(coverHash(c, salt) & 0xffffffu) / 16777216.0; }
vec4 coverAt(vec2 xz) {
  vec4 p = uCoverMat * vec4(xz.x, 0.0, xz.y, 1.0);
  vec2 f = (p.xy * 0.5 + 0.5) * ${MAP_PX.toFixed(1)} - 0.5;
  ivec2 i = ivec2(floor(f));
  if (any(lessThan(i, ivec2(0))) || any(greaterThan(i, ivec2(${MAP_PX - 2})))) return vec4(0.0);
  vec2 t = f - vec2(i);
  vec4 a = texelFetch(uCoverMap, i, 0), b = texelFetch(uCoverMap, i + ivec2(1, 0), 0);
  vec4 c = texelFetch(uCoverMap, i + ivec2(0, 1), 0), d = texelFetch(uCoverMap, i + ivec2(1, 1), 0);
  if (min(min(a.w, b.w), min(c.w, d.w)) < 0.75) return vec4(0.0);
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
float ringFade(vec2 xz) {
  float d = distance(xz, uEye.xz) * 1000.0;
  return smoothstep(uFade.x, uFade.y, d) * (1.0 - smoothstep(uFade.z, uFade.w, d));
}
`;

const TUFT_VS = COMMON + /* glsl */ `
attribute vec2 aCell;
attribute vec3 aBlade;
uniform float uExag;
void main() {
  ivec2 ci = ivec2(uGridCenter) + ivec2(aCell);
  vec2 jitter = vec2(coverRand(ci, 1u), coverRand(ci, 2u));
  vec2 xz = (vec2(ci) + jitter) * uCellKm;
  vec4 m = coverAt(xz);
  float r = coverRand(ci, 3u);
  float coral = m.y * 0.9, grass = m.z * 0.95;
  float kind = r < coral ? 1.0 : r < coral + grass ? 2.0 : 0.0;
  float fade = ringFade(xz);
  if (kind < 0.5 || fade <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float s = coverRand(ci, 4u);
  float heightM = (kind > 1.5 ? mix(0.3, 0.62, s) * (0.65 + 0.5 * grass) : mix(0.12, 0.3, s)) * uRingScale * fade;
  float spread = kind > 1.5 ? 0.16 : 0.1;
  float width = kind > 1.5 ? 0.035 : 0.03;
  float blade = aBlade.x;
  float a = (blade + coverRand(ci, 5u + uint(blade))) * ${(Math.PI * 2 / BLADES).toFixed(5)} + s * 6.2831;
  vec2 dir = vec2(cos(a), sin(a));
  float lean = mix(0.2, 0.75, coverRand(ci, 13u + uint(blade))) * (kind > 1.5 ? 1.0 : 0.35);
  float bh = heightM * mix(0.65, 1.0, coverRand(ci, 21u + uint(blade)));
  float tip = aBlade.z;
  vec2 side = vec2(-dir.y, dir.x) * aBlade.y * width * uRingScale * (1.0 - tip);
  vec2 local = dir * (spread * uRingScale * 0.5 + lean * bh * tip) + side;
  vec3 wp = vec3(xz.x + local.x * 0.001, m.x + (tip * bh * (1.0 - lean * 0.35) - 0.02) * 0.001 * uExag, xz.y + local.y * 0.001);
  vWorld = wp;
  vNormal = normalize(vec3(dir.x * 0.15, 1.0, dir.y * 0.15));
  vTexM = (xz - uTexOrigin) * 1000.0;
  vTip = tip;
  vKind = kind;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const PEBBLE_VS = COMMON + /* glsl */ `
attribute vec2 aCell;
uniform float uExag;
void main() {
  ivec2 ci = ivec2(uGridCenter) + ivec2(aCell);
  vec2 jitter = vec2(coverRand(ci, 31u), coverRand(ci, 32u));
  vec2 xz = (vec2(ci) + jitter) * uCellKm;
  vec4 m = coverAt(xz);
  bool rubble = m.w > 2.5;
  float stone = rubble ? m.w - 3.0 : clamp(m.w - 1.0, 0.0, 1.0);
  float fade = ringFade(xz);
  float density = rubble ? stone * 0.9 + 0.2 : stone * 1.6 + 0.1;
  if (m.w < 0.75 || coverRand(ci, 33u) > min(1.0, density) || fade <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float s = coverRand(ci, 34u);
  float size = (rubble ? mix(0.07, 0.42, s * s * s) * (0.7 + 0.6 * stone) : mix(0.05, 0.16, s * s) * (1.0 + stone)) * uRingScale * fade;
  float yaw = coverRand(ci, 35u) * 6.2831;
  vec3 p = position * vec3(1.0, 0.55, 0.8);
  p = vec3(p.x * cos(yaw) - p.z * sin(yaw), p.y, p.x * sin(yaw) + p.z * cos(yaw));
  vec3 n = normal / vec3(1.0, 0.55, 0.8);
  n = vec3(n.x * cos(yaw) - n.z * sin(yaw), n.y, n.x * sin(yaw) + n.z * cos(yaw));
  vec3 wp = vec3(xz.x + p.x * size * 0.001, m.x + (p.y - 0.25) * size * 0.001 * uExag, xz.y + p.z * size * 0.001);
  vWorld = wp;
  vNormal = normalize(n);
  vTexM = (xz - uTexOrigin) * 1000.0 + p.xz * size;
  vTip = 0.5 + 0.5 * p.y;
  vKind = rubble ? 4.0 : 3.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FS = ATMOS + SUN_SHADOW_GLSL + INK_GLSL + GROUND_GLSL + /* glsl */ `
uniform sampler2D uShadowTex;
uniform vec2 uGridKm;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vTexM;
varying float vTip;
varying float vKind;
void main() {
  vec3 albedo;
  if (vKind > 3.5) albedo = groundTexLod(L_MOUNTAIN_ROCK, vTexM / 0.8, 3.0) * vec3(1.1, 1.0, 0.88) * 0.5 * (0.7 + 0.4 * vTip);
  else if (vKind > 2.5) albedo = groundTexLod(L_CORAL_ROCK, vTexM / 0.6, 4.0) * 0.75 * (0.8 + 0.3 * vTip);
  else if (vKind > 1.5) albedo = groundTexLod(L_DOWNS_GRASS, vTexM / 1.25, 6.0) * 0.38 * (0.75 + 0.55 * vTip);
  else albedo = groundTexLod(L_CORAL_TURF, vTexM / 1.25, 6.0) * vec3(0.8, 0.62, 0.78) * 0.6 * (0.8 + 0.5 * vTip);
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing && vKind < 2.5) n = normalize(vec3(-n.x, n.y, -n.z));
  float shadow = texture2D(uShadowTex, clamp(vWorld.xz / uGridKm, 0.0, 1.0)).r * sunShadow(vWorld);
  float ndl = max(dot(n, uSunDir), 0.0);
  if (vKind < 2.5) ndl = max(ndl, 0.6) * step(0.0, uSunDir.y);
  vec3 skyAmb = mix(srgb(vec3(0.3, 0.29, 0.24)), uSkyZenith * 1.15, n.y * 0.5 + 0.5);
  float dist = distance(vWorld, cameraPosition);
  vec2 inked = inkLight(ndl, ndl * shadow, vTexM, dist, length(fwidth(vTexM)));
  vec3 col = albedo * (uSunColor * inked.x * 3.1 + skyAmb * (0.45 + 0.25 * vTip));
  gl_FragColor = vec4(toDisplay(applyAtmosphere(col, vWorld, cameraPosition)), 1.0 - inked.y);
}`;

function cells(ring: typeof RINGS[number], cellM = ring.cellM): Float32Array {
  const n = Math.ceil(ring.radiusM / cellM) + 1, out: number[] = [];
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    const d = Math.hypot(i, j) * cellM;
    if (d <= ring.radiusM + cellM && d >= ring.innerM - cellM) out.push(i, j);
  }
  return new Float32Array(out);
}

function tuftGeometry(): THREE.BufferGeometry {
  const blade: number[] = [];
  for (let b = 0; b < BLADES; b++) blade.push(b, -1, 0, b, 1, 0, b, 0, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BLADES * 9), 3));
  g.setAttribute('aBlade', new THREE.BufferAttribute(new Float32Array(blade), 3));
  return g;
}

function pebbleGeometry(): THREE.BufferGeometry {
  const ico = new THREE.OctahedronGeometry(1, 0).toNonIndexed();
  ico.computeVertexNormals();
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', ico.getAttribute('position'));
  g.setAttribute('normal', ico.getAttribute('normal'));
  return g;
}

export class GroundCover {
  readonly group = new THREE.Group();
  readonly target = new THREE.WebGLRenderTarget(MAP_PX, MAP_PX, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  private readonly camera = new THREE.OrthographicCamera(-MAP_KM / 2, MAP_KM / 2, MAP_KM / 2, -MAP_KM / 2, 0.001, 20);
  private readonly coverMat = new THREE.Matrix4();
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly clear = new THREE.Color();

  constructor(uniforms: Record<string, THREE.IUniform>) {
    this.group.visible = false;
    this.group.frustumCulled = false;
    const tuft = tuftGeometry(), pebble = pebbleGeometry();
    for (const ring of RINGS) {
      for (const [geo, vs, cellM] of [[tuft, TUFT_VS, ring.cellM], [pebble, PEBBLE_VS, ring.cellM * 2]] as const) {
        const at = cells(ring, cellM);
        const g = new THREE.InstancedBufferGeometry();
        for (const [name, attr] of Object.entries(geo.attributes)) g.setAttribute(name, attr);
        g.setAttribute('aCell', new THREE.InstancedBufferAttribute(at, 2));
        g.instanceCount = at.length / 2;
        const material = new THREE.ShaderMaterial({
          uniforms: {
            ...uniforms,
            uCoverMap: { value: this.target.texture },
            uCoverMat: { value: this.coverMat },
            uGridCenter: { value: new THREE.Vector2() },
            uCellKm: { value: cellM / 1000 },
            uFade: { value: new THREE.Vector4(ring.innerM, ring.fadeInM, ring.fadeOutM, ring.radiusM) },
            uRingScale: { value: ring.scale },
            uEye: { value: new THREE.Vector3() },
          },
          vertexShader: vs, fragmentShader: FS, side: THREE.DoubleSide,
        });
        this.materials.push(material);
        const mesh = new THREE.Mesh(g, material);
        mesh.frustumCulled = false;
        this.group.add(mesh);
      }
    }
  }

  update(renderer: THREE.WebGLRenderer, terrain: THREE.Mesh, terrainMaterial: THREE.ShaderMaterial, nearNodes: number, eye: THREE.Vector3, on: boolean) {
    this.group.visible = on;
    if (!on) return;
    const texel = MAP_KM / MAP_PX;
    const cx = Math.round(eye.x / texel) * texel, cz = Math.round(eye.z / texel) * texel;
    const cam = this.camera;
    cam.position.set(cx, eye.y + 5, cz);
    cam.up.set(0, 0, -1);
    cam.lookAt(cx, eye.y - 1, cz);
    cam.updateMatrixWorld();
    this.coverMat.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    for (const m of this.materials) {
      (m.uniforms.uEye.value as THREE.Vector3).copy(eye);
      const cell = m.uniforms.uCellKm.value as number;
      (m.uniforms.uGridCenter.value as THREE.Vector2).set(Math.floor(eye.x / cell), Math.floor(eye.z / cell));
    }
    const previous = terrain.material;
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    terrain.material = terrainMaterial;
    terrainMaterial.uniforms.uCoverPass.value = 1;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    const geo = terrain.geometry as THREE.InstancedBufferGeometry, all = geo.instanceCount;
    geo.instanceCount = nearNodes;
    renderer.render(terrain, cam);
    geo.instanceCount = all;
    terrainMaterial.uniforms.uCoverPass.value = 0;
    terrain.material = previous;
    renderer.setClearColor(this.clear, alpha);
    renderer.setRenderTarget(null);
  }
}
