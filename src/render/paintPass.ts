import * as THREE from 'three';

const RADIUS = 2;

const VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const KUWAHARA_FS = /* glsl */ `
uniform sampler2D uScene;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec3 m0 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0), m3 = vec3(0.0);
  vec3 s0 = vec3(0.0), s1 = vec3(0.0), s2 = vec3(0.0), s3 = vec3(0.0);
  for (int j = -${RADIUS}; j <= ${RADIUS}; j++) {
    for (int i = -${RADIUS}; i <= ${RADIUS}; i++) {
      vec3 c = texture2D(uScene, vUv + vec2(float(i), float(j)) * uStep).rgb;
      vec3 cc = c * c;
      if (i <= 0 && j <= 0) { m0 += c; s0 += cc; }
      if (i >= 0 && j <= 0) { m1 += c; s1 += cc; }
      if (i <= 0 && j >= 0) { m2 += c; s2 += cc; }
      if (i >= 0 && j >= 0) { m3 += c; s3 += cc; }
    }
  }
  float n = ${((RADIUS + 1) * (RADIUS + 1)).toFixed(1)};
  m0 /= n; m1 /= n; m2 /= n; m3 /= n;
  vec4 v = vec4(dot(s0 / n - m0 * m0, vec3(1.0)), dot(s1 / n - m1 * m1, vec3(1.0)), dot(s2 / n - m2 * m2, vec3(1.0)), dot(s3 / n - m3 * m3, vec3(1.0)));
  vec4 w = 1.0 / (1.0 + pow(max(v, 0.0) * 600.0, vec4(2.0)));
  gl_FragColor = vec4((m0 * w.x + m1 * w.y + m2 * w.z + m3 * w.w) / (w.x + w.y + w.z + w.w), 1.0);
}`;

const COMPOSITE_FS = /* glsl */ `
uniform sampler2D uPainted;
uniform sampler2D uScene;
uniform float uDetail;
uniform sampler2D uDepth;
uniform vec2 uTexel;
uniform float uInk;
uniform float uNear;
uniform float uFar;
uniform float uHatchScale;
varying vec2 vUv;
const vec3 LUMA = vec3(0.3, 0.55, 0.15);
float hatchLine(float u, float spacing, float width) {
  float d = abs(fract(u / spacing) - 0.5) * spacing;
  return (1.0 - smoothstep(width * 0.5 - 0.45, width * 0.5 + 0.45, d)) * smoothstep(0.15, 0.6, width);
}
float viewDepth(vec2 uv) {
  float d = texture2D(uDepth, uv).r;
  return uNear * uFar / (uFar - d * (uFar - uNear));
}
void main() {
  vec3 c = mix(texture2D(uPainted, vUv).rgb, texture2D(uScene, vUv).rgb, uDetail);
  float l = dot(c, LUMA);
  c = mix(vec3(l), c, 1.12);
  float shade = 1.0 - smoothstep(0.0, 0.55, l);
  c = mix(c, c * vec3(0.82, 0.88, 1.18), shade * 0.55);
  c = mix(c, c * vec3(1.04, 1.0, 0.92), smoothstep(0.55, 0.95, l) * 0.6);
  float ink = 1.0 - texture2D(uScene, vUv).a;
  vec2 px = gl_FragCoord.xy * uHatchScale;
  float solid = smoothstep(0.52, 0.6, ink);
  float wobble = sin(px.y * 0.043 + px.x * 0.011) * 1.3;
  float h1 = hatchLine(px.x + px.y + wobble, 9.0, smoothstep(0.18, 0.5, ink) * 2.4);
  float h2 = hatchLine(px.x - px.y * 0.7 - wobble, 10.0, smoothstep(0.42, 0.56, ink) * 2.0);
  vec3 black = c * vec3(0.16, 0.13, 0.22) + vec3(0.012, 0.01, 0.02);
  c = mix(c, black, max(solid, max(h1, h2) * (1.0 - solid)));
  float z = viewDepth(vUv);
  float jump = max(max(viewDepth(vUv + vec2(1.5, 0.0) * uTexel), viewDepth(vUv - vec2(1.5, 0.0) * uTexel)),
                   max(viewDepth(vUv + vec2(0.0, 1.5) * uTexel), viewDepth(vUv - vec2(0.0, 1.5) * uTexel)));
  float edge = smoothstep(0.06, 0.25, (jump - z) / z) * (1.0 - smoothstep(0.4, 3.0, z));
  c *= 1.0 - edge * uInk;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export class PaintPass {
  private readonly scene: THREE.WebGLRenderTarget;
  private readonly painted: THREE.WebGLRenderTarget;
  private readonly kuwahara: THREE.ShaderMaterial;
  private readonly composite: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly camera = new THREE.Camera();
  private readonly size = new THREE.Vector2();

  constructor() {
    this.scene = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType) });
    this.painted = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.kuwahara = new THREE.ShaderMaterial({
      uniforms: { uScene: { value: this.scene.texture }, uStep: { value: new THREE.Vector2() } },
      vertexShader: VS, fragmentShader: KUWAHARA_FS, depthTest: false, depthWrite: false,
    });
    this.composite = new THREE.ShaderMaterial({
      uniforms: { uPainted: { value: this.painted.texture }, uScene: { value: this.scene.texture }, uDetail: { value: 0.3 }, uDepth: { value: this.scene.depthTexture }, uTexel: { value: new THREE.Vector2() }, uInk: { value: 0.45 }, uNear: { value: 0.1 }, uFar: { value: 1000 }, uHatchScale: { value: 1 } },
      vertexShader: VS, fragmentShader: COMPOSITE_FS, depthTest: false, depthWrite: false,
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(g, this.kuwahara);
    this.quad.frustumCulled = false;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera) {
    renderer.getDrawingBufferSize(this.size);
    const { x: w, y: h } = this.size;
    if (this.scene.width !== w || this.scene.height !== h) {
      this.scene.setSize(w, h);
      this.painted.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    }
    (this.kuwahara.uniforms.uStep.value as THREE.Vector2).set(2 / w, 2 / h);
    (this.composite.uniforms.uTexel.value as THREE.Vector2).set(1 / w, 1 / h);
    this.composite.uniforms.uHatchScale.value = 1080 / h;
    this.composite.uniforms.uNear.value = camera.near;
    this.composite.uniforms.uFar.value = camera.far;
    renderer.setRenderTarget(this.scene);
    renderer.render(scene, camera);
    this.quad.material = this.kuwahara;
    renderer.setRenderTarget(this.painted);
    renderer.render(this.quad, this.camera);
    this.quad.material = this.composite;
    renderer.setRenderTarget(null);
    renderer.render(this.quad, this.camera);
  }
}
