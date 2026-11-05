// Hex id labels: one canvas atlas + an instanced, constant-pixel-size billboard per hex.

import * as THREE from 'three';
import { allHexes, hexCenter, type HexGrid } from '../core/hex';

const CELL_W = 64;
const CELL_H = 28;

export class HexLabels {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private geom: THREE.InstancedBufferGeometry;
  private grid: HexGrid | null = null;
  private atlas: THREE.CanvasTexture | null = null;

  constructor() {
    this.geom = new THREE.InstancedBufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    this.geom.setIndex([0, 1, 2, 0, 2, 3]);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: null },
        uAtlasCells: { value: new THREE.Vector2(1, 1) },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uPx: { value: new THREE.Vector2(CELL_W * 0.62, CELL_H * 0.62) },
        uOpacity: { value: 0.9 },
        uExag: { value: 1.5 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aPos;   // x, heightM, z, atlas index
        uniform vec2 uAtlasCells;
        uniform vec2 uViewport;
        uniform vec2 uPx;
        uniform float uExag;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          vec3 wp = vec3(aPos.x, aPos.y * 0.001 * uExag + 0.05, aPos.z);
          vec4 clip = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          float dist = length(wp - cameraPosition);
          // shrink a bit with distance, but never below legibility
          float s = mix(1.0, 0.75, smoothstep(40.0, 260.0, dist));
          clip.xy += position.xy * uPx * s / uViewport * 2.0 * clip.w;
          gl_Position = clip;
          float idx = aPos.w;
          float cx = mod(idx, uAtlasCells.x), cy = floor(idx / uAtlasCells.x);
          vUv = (vec2(cx, cy) + vec2(position.x + 0.5, 0.5 - position.y)) / uAtlasCells;
          vUv.y = 1.0 - vUv.y;
          vFade = 1.0 - smoothstep(350.0, 600.0, dist);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        uniform float uOpacity;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          vec4 t = texture2D(uAtlas, vUv);
          if (t.a < 0.02) discard;
          gl_FragColor = vec4(t.rgb, t.a * uOpacity * vFade);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geom, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  build(grid: HexGrid, heightAt: (x: number, z: number) => number) {
    this.grid = grid;
    const hexes = allHexes(grid);
    const perRow = 32;
    const rows = Math.ceil(hexes.length / perRow);
    const canvas = document.createElement('canvas');
    canvas.width = perRow * CELL_W;
    canvas.height = rows * CELL_H;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '600 19px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    hexes.forEach((h, i) => {
      const x = (i % perRow) * CELL_W + CELL_W / 2, y = Math.floor(i / perRow) * CELL_H + CELL_H / 2;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(20,18,14,0.85)';
      ctx.strokeText(h.id, x, y);
      ctx.fillStyle = 'rgba(245,238,220,1)';
      ctx.fillText(h.id, x, y);
    });
    this.atlas?.dispose();
    this.atlas = new THREE.CanvasTexture(canvas);
    this.atlas.minFilter = THREE.LinearFilter;
    this.atlas.generateMipmaps = false;
    this.material.uniforms.uAtlas.value = this.atlas;
    (this.material.uniforms.uAtlasCells.value as THREE.Vector2).set(perRow, rows);
    const arr = new Float32Array(hexes.length * 4);
    this.geom.setAttribute('aPos', new THREE.InstancedBufferAttribute(arr, 4));
    this.geom.instanceCount = hexes.length;
    this.updateHeights(heightAt);
  }

  /** Re-seat labels on the terrain (top part of each hex, like a printed hexcrawl map). */
  updateHeights(heightAt: (x: number, z: number) => number) {
    if (!this.grid) return;
    const g = this.grid;
    const attr = this.geom.getAttribute('aPos') as THREE.InstancedBufferAttribute;
    const arr = attr.array as Float32Array;
    allHexes(g).forEach((h, i) => {
      const [cx, cz] = hexCenter(g, h.col, h.row);
      const z = cz - g.flat * 0.32;
      arr[i * 4] = cx;
      arr[i * 4 + 1] = Math.max(heightAt(cx, z), heightAt(cx, cz)) + 30;
      arr[i * 4 + 2] = z;
      arr[i * 4 + 3] = i;
    });
    attr.needsUpdate = true;
  }

  setViewport(w: number, h: number) {
    (this.material.uniforms.uViewport.value as THREE.Vector2).set(w, h);
  }
  setExag(e: number) { this.material.uniforms.uExag.value = e; }
  setOpacity(o: number) { this.material.uniforms.uOpacity.value = o; }
}
