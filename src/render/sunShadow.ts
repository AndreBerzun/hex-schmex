import * as THREE from 'three';

export const SUN_SHADOW_GLSL = /* glsl */ `
uniform highp sampler2DShadow uSunShadowMap;
uniform mat4 uSunShadowMat;
uniform float uSunShadowOn;
uniform float uSunShadowTexel;
float sunShadow(vec3 wp) {
  if (uSunShadowOn < 0.5) return 1.0;
  vec4 p = uSunShadowMat * vec4(wp, 1.0);
  vec3 s = p.xyz / p.w * 0.5 + 0.5;
  vec2 c = abs(s.xy - 0.5);
  float reach = max(c.x, c.y);
  if (reach > 0.5 || s.z > 1.0) return 1.0;
  float z = s.z - 0.00025;
  float t = uSunShadowTexel;
  float v = texture(uSunShadowMap, vec3(s.xy + vec2(-t, -t), z))
          + texture(uSunShadowMap, vec3(s.xy + vec2(t, -t), z))
          + texture(uSunShadowMap, vec3(s.xy + vec2(-t, t), z))
          + texture(uSunShadowMap, vec3(s.xy + vec2(t, t), z));
  return mix(v * 0.25, 1.0, smoothstep(0.4, 0.5, reach));
}
`;

const SIZE = 2048;
const HALF_KM = 0.16;
const BACKOFF_KM = 0.6;

export interface ShadowCaster {
  renderDepth(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void;
}

export class SunShadow {
  readonly camera = new THREE.OrthographicCamera(-HALF_KM, HALF_KM, HALF_KM, -HALF_KM, 0.01, BACKOFF_KM * 2);
  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();
  private allocated = false;

  constructor() {
    const depth = new THREE.DepthTexture(SIZE, SIZE, THREE.UnsignedIntType);
    depth.compareFunction = THREE.LessEqualCompare;
    depth.minFilter = depth.magFilter = THREE.LinearFilter;
    this.target = new THREE.WebGLRenderTarget(SIZE, SIZE, { depthTexture: depth, depthBuffer: true });
    this.uniforms = {
      uSunShadowMap: { value: depth },
      uSunShadowMat: { value: new THREE.Matrix4() },
      uSunShadowOn: { value: 0 },
      uSunShadowTexel: { value: 0.75 / SIZE },
    };
  }

  update(renderer: THREE.WebGLRenderer, caster: ShadowCaster, eye: THREE.Vector3, sunDir: THREE.Vector3, on: boolean) {
    this.uniforms.uSunShadowOn.value = on && sunDir.y > 0.02 ? 1 : 0;
    if (!this.allocated) {
      renderer.setRenderTarget(this.target);
      renderer.clear();
      this.allocated = true;
    }
    if (!this.uniforms.uSunShadowOn.value) return;
    const cam = this.camera;
    if (Math.abs(sunDir.y) > 0.99) cam.up.set(0, 0, -1); else cam.up.set(0, 1, 0);
    cam.position.copy(sunDir);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    this.right.setFromMatrixColumn(cam.matrixWorld, 0);
    this.up.setFromMatrixColumn(cam.matrixWorld, 1);
    const texel = (2 * HALF_KM) / SIZE;
    this.focus.copy(eye);
    const a = this.focus.dot(this.right), b = this.focus.dot(this.up);
    this.focus.addScaledVector(this.right, Math.round(a / texel) * texel - a).addScaledVector(this.up, Math.round(b / texel) * texel - b);
    cam.position.copy(this.focus).addScaledVector(sunDir, BACKOFF_KM);
    cam.lookAt(this.focus);
    cam.updateMatrixWorld();
    (this.uniforms.uSunShadowMat.value as THREE.Matrix4).multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    caster.renderDepth(renderer, cam);
    renderer.setRenderTarget(null);
  }
}
