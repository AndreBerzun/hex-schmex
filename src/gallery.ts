import * as THREE from 'three';
import { KINDS, KIND_NAMES, type Kind, type Placed, type Tier } from './core/scenery/kit';
import type { SceneryCells } from './core/scenery/store';
import { Scenery } from './render/scenery';
import type { Lod } from './render/scenery/kit';

const params = new URLSearchParams(location.search);
const tier = (params.get('tier') ?? 'mid') as Tier;
const lod = Number(params.get('lod') ?? 0) as Lod;
const only = params.get('kinds')?.split(',') as Kind[] | undefined;
const kinds = only ?? KIND_NAMES.filter((k) => KINDS[k].tier === tier);
const variants = Number(params.get('variants') ?? 1);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
white.needsUpdate = true;
const uniforms: Record<string, THREE.IUniform> = {
  uDaylight: { value: 1 }, uSunDir: { value: new THREE.Vector3(-0.5, 0.75, 0.45).normalize() }, uSunColor: { value: new THREE.Color(1, 0.93, 0.8) },
  uSkyZenith: { value: new THREE.Color(0.16, 0.32, 0.62) }, uSkyHorizon: { value: new THREE.Color(0.66, 0.74, 0.84) },
  uHazeDensity: { value: 0 }, uHazeScaleH: { value: 2.6 }, uExag: { value: 1 }, uSpire: { value: new THREE.Vector4() }, uSpireRadius: { value: 0 },
  uShadowTex: { value: white }, uWorldKm: { value: new THREE.Vector2(100, 100) },
};
const scenery = new Scenery(uniforms);
scenery.forceLod = lod;
const objects: Placed[] = [];
let x = 0, maxH = 0;
for (const kind of kinds) {
  const m = KINDS[kind];
  const w = Math.max(m.nominalM * m.footRatio * 2.4, m.nominalM * 0.8, kind === 'coral-wall' ? 20 : 0);
  for (let v = 0; v < Math.min(variants, m.variants); v++) {
    x += w / 2;
    const flatOn = kind === 'coral-wall' || kind === 'wreck' || kind === 'ruin-wall' || kind === 'ribs';
    objects.push({ kind, variant: v, x: 50 + x / 1000, z: 50, y: 0, yaw: flatOn ? 0.15 : 0.4, sx: 1, sy: 1, sz: 1, leanX: 0, leanZ: 0, tint: 1, heightM: m.nominalM });
    x += w / 2 + m.nominalM * 0.2;
    maxH = Math.max(maxH, m.nominalM);
  }
}
const cell = { objects, blockers: [] };
const fake = { peek: () => cell, get: () => cell } as unknown as SceneryCells;
scenery.setCells(fake, 100, 100);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0.62, 0.71, 0.82);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.06, 0.055, 0.05) }));
ground.position.set(50, 0, 50);
scene.add(ground, scenery.group);
const span = x / 1000;
const camera = new THREE.PerspectiveCamera(30, canvas.width / canvas.height, 0.0005, 100);
const dist = Math.max(span * 0.95, maxH * 0.004);
camera.position.set(50 + span / 2, maxH * 0.0011 + dist * 0.12, 50 + dist);
camera.lookAt(50 + span / 2, maxH * 0.00045, 50);
camera.updateMatrixWorld();
scenery.update(camera, 10, canvas.height, 1e9, false);
renderer.render(scene, camera);
const w = window as unknown as { __ready: boolean; __stats: unknown };
w.__stats = scenery.stats;
w.__ready = true;
