// Tiny GPGPU helper on top of three.js: full-screen passes into float render targets.

import * as THREE from 'three';

export const PASS_VS = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** Shared GLSL helpers for passes (hash/noise). */
export const GLSL_NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
// gradient noise, roughly [-1, 1]
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash22(i) * 2.0 - 1.0, f);
  float b = dot(hash22(i + vec2(1.0, 0.0)) * 2.0 - 1.0, f - vec2(1.0, 0.0));
  float c = dot(hash22(i + vec2(0.0, 1.0)) * 2.0 - 1.0, f - vec2(0.0, 1.0));
  float d = dot(hash22(i + vec2(1.0, 1.0)) * 2.0 - 1.0, f - vec2(1.0, 1.0));
  return 1.6 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * gnoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.1;
    a *= 0.5;
  }
  return s;
}
float ridgedFbm(vec2 p, int oct) {
  float s = 0.0, a = 0.5, w = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    float n = 1.0 - abs(gnoise(p));
    n *= n;
    s += a * n * w;
    w = clamp(n * 1.5, 0.0, 1.0);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 9.3;
    a *= 0.5;
  }
  return s;
}
`;

export interface TargetOpts {
  type?: THREE.TextureDataType;
  filter?: THREE.MinificationTextureFilter & THREE.MagnificationTextureFilter;
  format?: THREE.AnyPixelFormat;
}

export class GPUCompute {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mesh: THREE.Mesh;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    const g = new THREE.BufferGeometry();
    // one big triangle covering the viewport
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new THREE.Mesh(g);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  target(w: number, h: number, o: TargetOpts = {}): THREE.WebGLRenderTarget {
    const filter = o.filter ?? THREE.NearestFilter;
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: o.type ?? THREE.FloatType,
      format: (o.format ?? THREE.RGBAFormat) as THREE.PixelFormat,
      minFilter: filter,
      magFilter: filter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    return rt;
  }

  material(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.RawShaderMaterial {
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: PASS_VS,
      fragmentShader: '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\nprecision highp sampler2D;\nin vec2 vUv;\nout vec4 outColor;\n' + fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
  }

  run(mat: THREE.Material, target: THREE.WebGLRenderTarget | null) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = false;
    this.mesh.material = mat;
    r.setRenderTarget(target);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prev);
    r.autoClear = prevAuto;
  }

  /** One horizontal band of a pass, so a costly full-resolution pass can spread over many frames. */
  runBand(mat: THREE.Material, target: THREE.WebGLRenderTarget, y: number, height: number) {
    target.scissorTest = true;
    target.scissor.set(0, y, target.width, height);
    this.run(mat, target);
    target.scissorTest = false;
  }

  read(target: THREE.WebGLRenderTarget): Float32Array {
    const out = new Float32Array(target.width * target.height * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, out);
    return out;
  }

  async readAsync(target: THREE.WebGLRenderTarget): Promise<Float32Array> {
    const out = new Float32Array(target.width * target.height * 4);
    await this.renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height, out);
    return out;
  }
}

/** Ping-pong pair. */
export class PingPong {
  a: THREE.WebGLRenderTarget;
  b: THREE.WebGLRenderTarget;
  constructor(gc: GPUCompute, w: number, h: number, o?: TargetOpts) {
    this.a = gc.target(w, h, o);
    this.b = gc.target(w, h, o);
  }
  get read() { return this.a; }
  get write() { return this.b; }
  swap() { const t = this.a; this.a = this.b; this.b = t; }
  dispose() { this.a.dispose(); this.b.dispose(); }
}
