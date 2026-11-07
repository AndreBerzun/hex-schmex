// Procedural landmark blockouts in real-world units. All repeated parts are instanced;
// no downloaded assets, random global state, or extra render passes.
import * as THREE from 'three';
import { hashString, mulberry32 } from '../core/noise';
import type { Feature, World } from '../core/types';
import { ATMOS, LANDMARK_SHADOW } from './glsl';

type Shape = 'box' | 'column' | 'cone' | 'crown';
interface Part { matrix: THREE.Matrix4; color: THREE.Color; detail: number }
const VS = /* glsl */ `
attribute float aDetail;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vLocal;
varying vec3 vFace;
varying float vDetail;
void main() {
  vec4 p = instanceMatrix * vec4(position, 1.0);
  vec4 wp = modelMatrix * p;
  vWorld = wp.xyz;
  mat3 im = mat3(instanceMatrix);
  vec3 sizes = vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
  vec3 n = im * (normal / max(sizes, vec3(0.00000001)));
  mat3 mm = mat3(modelMatrix);
  vec3 ms = vec3(dot(mm[0], mm[0]), dot(mm[1], mm[1]), dot(mm[2], mm[2]));
  vNormal = normalize(mm * (n / ms));
  vColor = instanceColor;
  vLocal = (position + 0.5) * sqrt(sizes);
  vFace = normal;
  vDetail = aDetail;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FS = ATMOS + LANDMARK_SHADOW + /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vLocal;
varying vec3 vFace;
varying float vDetail;
void main() {
  vec3 n = normalize(vNormal);
  float direct = max(dot(n, uSunDir), 0.0);
  vec3 ambient = mix(vec3(0.10, 0.085, 0.09), uSkyZenith * 0.65, n.y * 0.5 + 0.5);
  vec3 base = vColor;
  if (vDetail > 0.5 && abs(vFace.y) < 0.7) {
    float u = abs(vFace.x) > 0.5 ? vLocal.z : vLocal.x;
    float bay = vDetail > 1.5 ? 0.014 : 0.0045;
    float storey = vDetail > 1.5 ? 0.018 : 0.0045;
    float row = floor(vLocal.y / storey);
    vec2 cell = vec2(u / bay, vLocal.y / storey);
    vec2 q = fract(cell);
    vec2 aa = max(fwidth(cell), vec2(0.002));
    float window = smoothstep(0.24-aa.x, 0.24+aa.x, q.x) * (1.0-smoothstep(0.64-aa.x, 0.64+aa.x, q.x));
    window *= smoothstep(0.30-aa.y, 0.30+aa.y, q.y) * (1.0-smoothstep(0.80-aa.y, 0.80+aa.y, q.y));
    if (vDetail > 1.5) window *= 1.0-smoothstep(0.42, 0.46, q.y + abs(q.x-0.44)*0.65 - 0.28);
    window *= smoothstep(0.003, 0.006, vLocal.y);
    float warm = step(0.91, fract(sin(floor(cell.x)*12.31+row*77.7)*431.13));
    base = mix(base, mix(vec3(0.012,0.016,0.025), vec3(0.16,0.09,0.036), warm), window * 0.94);
    // Recessed courses, with a thin lintel beneath each storey.
    float course = 1.0 - smoothstep(0.02, 0.02+aa.y, abs(q.y-0.11));
    base *= 1.0-course*0.16;
  }
  if (vDetail < -0.5) {
    vec2 tile = vLocal.xz / 0.0015;
    vec2 a = max(fwidth(tile), vec2(0.01));
    float seam = 1.0-smoothstep(0.015,0.015+a.x,abs(fract(tile.x)-0.5));
    base *= 1.0-seam*0.18;
  }
  vec3 col = base * (ambient + uSunColor * direct * landmarkShadow(vWorld) * 2.5);
  gl_FragColor = vec4(toDisplay(applyAtmosphere(col, vWorld, cameraPosition)), 1.0);
}`;

export class Landmarks {
  readonly group = new THREE.Group();
  private material: THREE.ShaderMaterial;
  private geometries: Record<Shape, THREE.BufferGeometry> = {
    box: new THREE.BoxGeometry(1, 1, 1),
    column: new THREE.CylinderGeometry(1, 1, 1, 8),
    cone: new THREE.CylinderGeometry(0, 1, 1, 8),
    crown: new THREE.IcosahedronGeometry(1, 1),
  };
  private batches = new Map<Shape, Part[]>();
  constructor(uniforms: Record<string, THREE.IUniform>) {
    this.material = new THREE.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader: FS });
  }
  setExag(value: number) { this.group.scale.y = value; }
  private part(shape: Shape, pos: number[], scale: number[], color: number, rotation = 0, quat?: THREE.Quaternion, detail = 0) {
    const parts = this.batches.get(shape) ?? [];
    parts.push({ matrix: new THREE.Matrix4().compose(new THREE.Vector3(...pos), quat ?? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation), new THREE.Vector3(...scale)), color: new THREE.Color(color), detail });
    this.batches.set(shape, parts);
  }
  private beam(a: THREE.Vector3, b: THREE.Vector3, radius: number, color: number) {
    const d = b.clone().sub(a);
    this.part('column', a.clone().add(b).multiplyScalar(0.5).toArray(), [radius, d.length(), radius], color, 0,
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  }
  rebuild(world: World, heightAt: (x: number, z: number) => number) {
    for (const child of [...this.group.children]) {
      (child as THREE.InstancedMesh).geometry.dispose();
      (child as THREE.InstancedMesh).dispose();
      this.group.remove(child);
    }
    this.batches.clear();
    for (const f of world.features) {
      if (!f.pos || !f.pos.every(Number.isFinite)) continue;
      if (f.kind === 'walled-city') this.city(f, world.seed, heightAt);
      if (f.kind === 'crimson-spire') this.spire(f, heightAt);
      if (f.kind === 'cursed-tree') this.tree(f, world.seed, heightAt);
      if (f.kind === 'walking-statue') this.statue(f, heightAt);
    }
    for (const [shape, parts] of this.batches) {
      const geometry = this.geometries[shape].clone();
      geometry.setAttribute('aDetail', new THREE.InstancedBufferAttribute(new Float32Array(parts.map(p => p.detail)), 1));
      const mesh = new THREE.InstancedMesh(geometry, this.material, parts.length);
      parts.forEach((p, i) => { mesh.setMatrixAt(i, p.matrix); mesh.setColorAt(i, p.color); });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
    this.batches.clear();
  }
  private city(f: Feature, seed: number, heightAt: (x: number, z: number) => number) {
    const [cx, cz] = f.pos!;
    const r = f.radiusKm ?? 1.15;
    const random = mulberry32(seed ^ hashString(f.id));
    const ground = (x: number, z: number) => heightAt(x, z) / 1000;
    const stone = 0x45444c, pale = 0xbfb7a9;
    const wall = (radius: number, h: number, count: number) => {
      for (let i = 0; i < count; i++) {
        // Four entrances interrupt the ring, with towers at either side.
        const a = i / count * Math.PI * 2, b = (i + 1) / count * Math.PI * 2;
        const x = cx + Math.cos(a) * radius, z = cz + Math.sin(a) * radius;
        const bx = cx + Math.cos(b) * radius, bz = cz + Math.sin(b) * radius;
        const y = Math.min(ground(x, z), ground(bx, bz)) - 0.01;
        const top = Math.max(ground(x, z), ground(bx, bz)) + h;
        if (i % (count / 4) !== 0) {
          this.part('box', [(x + bx) / 2, (y + top) / 2, (z + bz) / 2], [Math.hypot(x - bx, z - bz) + 0.004, top - y, 0.015], stone, -(a + b) / 2 - Math.PI / 2);
          for (let k = 0; k < 5; k++) this.part('box', [x + (bx - x) * k / 5, top + 0.003, z + (bz - z) * k / 5], [0.01, 0.006, 0.019], stone);
        }
        if (i % 2 === 0) {
          this.part('column', [x, ground(x, z) + h * 0.7, z], [0.026, h * 1.4, 0.026], stone);
          this.part('column', [x, ground(x, z) + h * 1.4, z], [0.03, 0.012, 0.03], 0x55525b);
        }
      }
    };
    wall(r, (f.heightM ?? 55) / 1000, 64);
    wall(r * 0.59, 0.028, 40);
    wall(r * 0.27, 0.025, 24);
    // Dense districts separated by radial streets and two ring roads.
    for (let x = -r; x <= r; x += 0.056) for (let z = -r; z <= r; z += 0.056) {
      const d = Math.hypot(x, z), angle = Math.atan2(z, x);
      if (d > r * 0.94 || d < r * 0.30 || Math.abs(d - r * 0.59) < 0.047) continue;
      if (Math.abs(Math.sin(angle * 4)) * d < 0.035 || random() < 0.13) continue;
      const px = cx + x + (random() - 0.5) * 0.013, pz = cz + z + (random() - 0.5) * 0.013;
      const h = 0.009 + random() * 0.026, w = 0.019 + random() * 0.019;
      const y = ground(px, pz), color = [0x514952, 0x625861, 0x74626a, 0x3e3d48][Math.floor(random() * 4)];
      this.part('box', [px, y + h / 2 - 0.003, pz], [w, h + 0.006, w * 1.3], color, angle, undefined, 1);
      this.part('cone', [px, y + h + 0.005, pz], [w * 0.76, 0.012, w * 0.85], 0x302b38, angle, undefined, -1);
      // Street-facing portal, a chimney, and a projecting cornice give the blocks depth.
      const portal = new THREE.Vector3(0, 0, w * 0.66).applyAxisAngle(new THREE.Vector3(0,1,0), angle);
      this.part('box', [px + portal.x, y + 0.0025, pz + portal.z], [0.0022, 0.005, 0.0008], 0x201e28, angle);
      this.part('box', [px, y + h - 0.001, pz], [w * 1.09, 0.0015, w * 1.41], 0x81737a, angle);
      if (h > 0.019) this.part('box', [px + w * 0.18, y + h + 0.011, pz], [0.0025, 0.009, 0.0025], 0x514853);
    }
    const y = ground(cx, cz);
    this.part('column', [cx, y + 0.012, cz], [r * 0.23, 0.024, r * 0.23], 0x8c8584);
    this.part('box', [cx, y + 0.065, cz], [0.23, 0.13, 0.19], pale, 0, undefined, 2);
    this.part('box', [cx, y + 0.11, cz], [0.075, 0.22, 0.09], 0xd7d0bd, 0, undefined, 2);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, x = cx + Math.cos(a) * 0.17, z = cz + Math.sin(a) * 0.17;
      const h = i % 2 ? 0.13 : 0.18;
      this.part('column', [x, y + h / 2, z], [0.024, h, 0.024], pale);
      this.part('cone', [x, y + h + 0.025, z], [0.031, 0.05, 0.031], 0x827f90);
      for (const level of [0.04, 0.075, 0.11]) {
        this.part('column', [x, y+level, z], [0.0255, 0.003, 0.0255], 0xd3c8b0);
        for (let side=0; side<8; side++) {
          const angle=side*Math.PI/4;
          this.part('box', [x+Math.cos(angle)*0.024, y+level+0.012, z+Math.sin(angle)*0.024], [0.003,0.012,0.001], 0x322c38, Math.PI/2-angle);
        }
      }
    }
    // Keep buttresses, inset portals, cornices and layered tower crowns.
    for (const side of [-1, 1]) {
      for (let i = -2; i <= 2; i++) {
        this.part('box', [cx + i * 0.044, y + 0.055, cz + side * 0.101], [0.009, 0.11, 0.024], 0xa49d91);
        this.part('cone', [cx + i * 0.044, y + 0.12, cz + side * 0.101], [0.008, 0.02, 0.013], 0xc8bfaa);
      }
      this.part('box', [cx, y + 0.024, cz + side * 0.096], [0.019, 0.048, 0.002], 0x39313b);
      this.part('column', [cx, y + 0.052, cz + side * 0.098], [0.0095, 0.014, 0.002], 0x39313b, Math.PI/2);
    }
    for (const level of [0.045, 0.09, 0.13]) this.part('box', [cx, y + level, cz], [0.238, 0.005, 0.198], 0xddd3b9);
    for (const level of [0.07, 0.14, 0.218]) this.part('box', [cx, y + level, cz], [0.082, 0.004, 0.098], 0xe1d8c0);
    this.part('cone', [cx, y + 0.252, cz], [0.06, 0.064, 0.06], 0xb1a8a2);
  }
  private spire(f: Feature, heightAt: (x: number, z: number) => number) {
    const [x, z] = f.pos!, y = heightAt(x, z) / 1000;
    const h = (f.heightM ?? 1800) / 1000, r = f.radiusKm ?? 0.22;
    this.part('cone', [x, y + h / 2, z], [r, h, r], 0x411b27);
    // Ribbed buttresses and tiered galleries follow the tapered core.
    for (let tier = 1; tier <= 11; tier++) {
      const f = tier / 13, radius = r * (1 - f);
      this.part('column', [x, y + h*f, z], [radius*1.08, 0.010, radius*1.08], tier % 3 ? 0x542532 : 0x823341);
      for (let j = 0; j < 8; j++) {
        const a = j*Math.PI/4;
        const p = new THREE.Vector3(x + Math.cos(a)*radius, y+h*f, z+Math.sin(a)*radius);
        this.part('box', p.toArray(), [0.012, 0.037, 0.009], 0x180f1d, -a);
        if (tier % 3 === 0) this.part('cone', [p.x, p.y+0.047, p.z], [0.012,0.055,0.012], 0x692b3b);
      }
    }
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, px = x + Math.cos(a) * r * 0.7, pz = z + Math.sin(a) * r * 0.7;
      this.part('cone', [px, y + h * 0.24, pz], [r * 0.3, h * 0.48, r * 0.3], i % 2 ? 0x632331 : 0x371923);
      this.beam(new THREE.Vector3(px, y + 0.05, pz), new THREE.Vector3(x, y + h * 0.85, z), 0.016, 0x7b3540);
    }
    this.part('column', [x, y + 0.015, z], [r * 1.5, 0.03, r * 1.5], 0x29222e);
  }
  private tree(f: Feature, seed: number, heightAt: (x: number, z: number) => number) {
    const [x, z] = f.pos!, y = heightAt(x, z) / 1000;
    const h = (f.heightM ?? 420) / 1000, r = f.radiusKm ?? 0.4;
    const random = mulberry32(seed ^ hashString(f.id));
    const base = new THREE.Vector3(x, y, z), fork = new THREE.Vector3(x + h * 0.07, y + h * 0.50, z);
    this.beam(base, fork, h * 0.065, 0x38212b);
    for (let i = 0; i < 10; i++) {
      const a = i * Math.PI / 5;
      const root = new THREE.Vector3(x + Math.cos(a) * r * 0.55, y, z + Math.sin(a) * r * 0.55);
      this.beam(root, base.clone().add(new THREE.Vector3(0, h * 0.20, 0)), h * 0.035, 0x40232d);
    }
    for (let i = 0; i < 18; i++) {
      const a = i * 2.39996, d = r * (0.3 + random() * 0.55);
      const tip = new THREE.Vector3(x + Math.cos(a) * d, y + h * (0.65 + random() * 0.20), z + Math.sin(a) * d);
      const elbow = fork.clone().lerp(tip, 0.55); elbow.y -= h * 0.07;
      this.beam(fork, elbow, h * 0.023, 0x46242e);
      this.beam(elbow, tip, h * 0.013, 0x542832);
      for (let j = 0; j < 3; j++) {
        const p = tip.clone().add(new THREE.Vector3((random() - 0.5) * r * 0.35, random() * h * 0.08, (random() - 0.5) * r * 0.35));
        this.part('crown', p.toArray(), [r * 0.19, h * 0.13, r * 0.18], [0x731c32, 0xa02a3c, 0x50182d][j]);
      }
    }
  }
  private statue(f: Feature, heightAt: (x: number, z: number) => number) {
    const [x, z] = f.pos!, y = heightAt(x, z) / 1000, h = (f.heightM ?? 90) / 1000;
    const a = (f.rotationDeg ?? 0) * Math.PI / 180, stone = 0x737383;
    const p = (dx: number, dy: number, dz: number) => new THREE.Vector3(x + (dx * Math.cos(a) + dz * Math.sin(a)) * h, y + dy * h, z + (-dx * Math.sin(a) + dz * Math.cos(a)) * h);
    this.beam(p(-0.12, 0.05, -0.18), p(-0.09, 0.51, 0), h * 0.064, stone);
    this.beam(p(0.12, 0.05, 0.18), p(0.09, 0.51, 0), h * 0.064, stone);
    this.part('box', p(0, 0.66, 0).toArray(), [h * 0.32, h * 0.31, h * 0.18], stone, a);
    this.part('box', p(0, 0.90, 0).toArray(), [h * 0.16, h * 0.19, h * 0.17], 0x9997a4, a);
    this.part('cone', p(0, 1.025, 0).toArray(), [h * 0.12, h * 0.10, h * 0.11], stone, a);
    this.part('cone', p(0, 0.52, 0).toArray(), [h * 0.23, h * 0.38, h * 0.18], 0x575b6a, a);
    this.part('box', p(0, 0.55, 0).toArray(), [h * 0.35, h * 0.035, h * 0.21], 0x96919d, a);
    for (const side of [-1, 1]) {
      this.part('crown', p(side * 0.20, 0.79, 0).toArray(), [h * 0.10, h * 0.075, h * 0.12], 0x8a8898, a);
      this.part('box', p(side * 0.12, 0.035, side * 0.18 + 0.04).toArray(), [h * 0.12, h * 0.07, h * 0.21], stone, a);
    }
    this.part('box', p(-0.30, 0.48, -0.04).toArray(), [h * 0.20, h * 0.34, h * 0.035], 0x595d70, a);
    this.part('box', p(0, 0.91, 0.089).toArray(), [h * 0.12, h * 0.017, h * 0.006], 0x252738, a);
    this.beam(p(-0.19, 0.78, 0), p(-0.30, 0.45, -0.08), h * 0.048, stone);
    this.beam(p(0.19, 0.78, 0), p(0.28, 0.58, 0.11), h * 0.048, stone);
    this.beam(p(0.29, 0.01, 0.13), p(0.29, 1.16, 0.13), h * 0.015, 0xaaa4ac);
  }
}
