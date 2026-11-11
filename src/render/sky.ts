// Analytic sky drawn as a full-screen background pass, and the skirt that closes the terrain edges.

import * as THREE from 'three';
import { ATMOS } from './glsl';

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  constructor(uniforms: Record<string, THREE.IUniform>) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uInvViewProj: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() } },
      vertexShader: /* glsl */ `
        varying vec2 vNdc;
        void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
      fragmentShader: ATMOS + /* glsl */ `
        uniform sampler2D uNoise;
        uniform mat4 uInvViewProj;
        uniform vec3 uCamPos;
        varying vec2 vNdc;
        void main() {
          vec4 p = uInvViewProj * vec4(vNdc, 1.0, 1.0);
          vec3 dir = normalize(p.xyz / p.w - uCamPos);
          vec3 c = skyColor(dir);
          // a few soft cumulus near the horizon band for scale and mood
          if (dir.y > 0.0) {
            vec2 cp = dir.xz / (dir.y + 0.08) * 1.6;
            float cl = smoothstep(0.15, 0.65, (texture2D(uNoise, cp / 32.0).r - 0.5) * 3.0 * 1.05 + 0.1);
            cl *= smoothstep(0.0, 0.12, dir.y) * (1.0 - smoothstep(0.35, 0.8, dir.y));
            float lit = 0.75 + 0.25 * max(dot(dir, uSunDir), 0.0);
            c = mix(c, mix(uSkyHorizon, vec3(1.0), 0.7) * lit * 1.05, cl * 0.75 * uDaylight);
          }
          gl_FragColor = vec4(toDisplay(c), 1.0);
        }`,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  update(camera: THREE.Camera) {
    const m = this.material.uniforms.uInvViewProj.value as THREE.Matrix4;
    m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    (this.material.uniforms.uCamPos.value as THREE.Vector3).copy(camera.position);
  }
}

/** Vertical walls around the map edge so oblique views don't look under the terrain. */
export class Skirt {
  readonly mesh: THREE.Mesh;
  constructor(uniforms: Record<string, THREE.IUniform>) {
    const segs = 512;
    const pos = new Float32Array((segs + 1) * 2 * 3);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      for (let r = 0; r < 2; r++) {
        const k = (i * 2 + r) * 3;
        pos[k] = t; pos[k + 1] = r; pos[k + 2] = 0;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < segs; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        uniform sampler2D uHeight;
        uniform float uHeightScale;
        uniform sampler2D uWaterTex;
        uniform vec2 uWorldKm;
        uniform vec2 uGridKm;
        uniform float uExag;
        varying vec3 vWorld;
        varying float vTop;
        void main() {
          // perimeter parameter t in [0,1] -> point on the rectangle
          float W = uWorldKm.x, Hh = uWorldKm.y, P = 2.0 * (W + Hh);
          float s = position.x * P;
          vec2 xz;
          if (s < W) xz = vec2(s, 0.0);
          else if (s < W + Hh) xz = vec2(W, s - W);
          else if (s < 2.0 * W + Hh) xz = vec2(W - (s - W - Hh), Hh);
          else xz = vec2(0.0, Hh - (s - 2.0 * W - Hh));
          vec2 uv = clamp(xz / uGridKm, 0.0005, 0.9995);
          float h = texture2D(uHeight, uv).r * uHeightScale;
          float w = texture2D(uWaterTex, uv).r;
          float top = (w - h > 0.25 ? w : h) * 0.001 * uExag;
          float y = position.y > 0.5 ? top : -1.2 * uExag;
          vTop = position.y;
          vWorld = vec3(xz.x, y, xz.y);
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
        }`,
      fragmentShader: ATMOS + /* glsl */ `
        varying vec3 vWorld;
        varying float vTop;
        void main() {
          vec3 c = srgb(vec3(0.24, 0.2, 0.16)) * (0.35 + 0.4 * vTop);
          c = applyAtmosphere(c, vWorld, cameraPosition);
          gl_FragColor = vec4(toDisplay(c), 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
  }
}
