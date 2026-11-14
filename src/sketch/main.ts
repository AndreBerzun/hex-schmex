import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { evaluate } from '../core/ops';
import { loadWorld } from '../core/world';
import { flatField, groundHit, heightAt, stamp, type BrushTool, type Field, type Rect } from './field';

type Tool = BrushTool | 'mark' | 'stand';
interface Marker { x: number; y: number; note?: string; by?: string }
interface Meta { nx: number; ny: number; kmPerPx: number; seaLevelM: number; markers: Marker[] }

const NAME = new URLSearchParams(location.search).get('name') ?? 'sandbox';
const SKELETON = new URLSearchParams(location.search).get('from') ?? 'triangle-sandbox';
const LAND = new THREE.Color('#b9b2a4');
const CLIFF = new THREE.Color('#6f6860');
const SKY = new THREE.Color('#cfd6dc');
const UNDO_KEEP = 40;
const EYE_M = 2;

const canvas = document.getElementById('view') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLElement;
const hud = document.getElementById('hud') as HTMLElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(1);
const scene = new THREE.Scene();
scene.background = SKY;
scene.fog = new THREE.FogExp2(SKY, 0.004);
scene.add(new THREE.HemisphereLight('#ffffff', '#8a8478', 1.1));
const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
sun.position.set(-0.6, 0.55, -0.5);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(55, 1, 0.002, 900);
const controls = new OrbitControls(camera, canvas);
controls.mouseButtons = { LEFT: -1 as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
controls.maxPolarAngle = Math.PI * 0.49;
controls.zoomToCursor = true;

let field: Field;
let meta: Meta;
let mesh: THREE.Mesh;
let water: THREE.Mesh;
let exaggeration = 2;
let tool: Tool = 'raise';
let radiusKm = 4;
let strength = 600;
let dirty = true;
let eye: { x: number; y: number; yaw: number; pitch: number } | null = null;
let hover: [number, number] | null = null;
const undoStack: Float32Array[] = [];
const keys = new Set<string>();
const markerGroup = new THREE.Group();
scene.add(markerGroup);
const ring = new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3)), new THREE.LineBasicMaterial({ color: '#c8102e', depthTest: false }));
ring.renderOrder = 2;
ring.frustumCulled = false;
scene.add(ring);

const widthKm = () => (field.nx - 1) * field.kmPerPx;
const depthKm = () => (field.ny - 1) * field.kmPerPx;
const sceneY = (m: number) => (m / 1000) * exaggeration;
const invalidate = () => { dirty = true; };

async function fetchSketch(): Promise<boolean> {
  const m = await fetch(`/__sketch/${NAME}.json`);
  const b = await fetch(`/__sketch/${NAME}.bin`);
  if (!m.ok || !b.ok) return false;
  meta = await m.json();
  field = { nx: meta.nx, ny: meta.ny, kmPerPx: meta.kmPerPx, h: new Float32Array(await b.arrayBuffer()) };
  return field.h.length === meta.nx * meta.ny;
}

async function fromSkeleton(): Promise<void> {
  const r = await fetch(`/__maps/${SKELETON}`);
  if (r.ok) {
    const world = loadWorld(await r.json());
    const hf = evaluate(world, { res: 256 });
    field = { nx: hf.nx, ny: hf.ny, kmPerPx: hf.kmPerPx, h: hf.height.slice() };
    meta = { nx: hf.nx, ny: hf.ny, kmPerPx: hf.kmPerPx, seaLevelM: world.terrain.seaLevelM, markers: [] };
  } else {
    field = flatField(257, 257, 0.4, 120);
    meta = { nx: 257, ny: 257, kmPerPx: 0.4, seaLevelM: 0, markers: [] };
  }
}

let heightTimer = 0;
function saveHeights() {
  clearTimeout(heightTimer);
  heightTimer = window.setTimeout(() => { void fetch(`/__sketch/${NAME}.bin`, { method: 'PUT', body: field.h.slice().buffer }); }, 600);
}
function saveMeta() {
  void fetch(`/__sketch/${NAME}.json`, { method: 'PUT', body: JSON.stringify(meta, null, 1) });
}

function buildTerrain() {
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
  if (water) { scene.remove(water); water.geometry.dispose(); }
  const { nx, ny, kmPerPx } = field;
  const pos = new Float32Array(nx * ny * 3);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = (j * nx + i) * 3;
    pos[k] = i * kmPerPx;
    pos[k + 2] = j * kmPerPx;
  }
  const index = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let q = 0;
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    index[q++] = a; index[q++] = c; index[q++] = b;
    index[q++] = b; index[q++] = c; index[q++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nx * ny * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nx * ny * 3), 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.frustumCulled = false;
  scene.add(mesh);
  water = new THREE.Mesh(new THREE.PlaneGeometry(widthKm() * 3, depthKm() * 3).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#5f7f96', transparent: true, opacity: 0.85 }));
  water.position.set(widthKm() / 2, sceneY(meta.seaLevelM), depthKm() / 2);
  scene.add(water);
  refresh({ i0: 0, i1: nx - 1, j0: 0, j1: ny - 1 });
}

function refresh(r: Rect) {
  const { nx, ny, kmPerPx, h } = field;
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const nor = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
  const col = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
  const c = new THREE.Color();
  for (let j = Math.max(0, r.j0 - 1); j <= Math.min(ny - 1, r.j1 + 1); j++) for (let i = Math.max(0, r.i0 - 1); i <= Math.min(nx - 1, r.i1 + 1); i++) {
    const k = j * nx + i;
    pos.setY(k, sceneY(h[k]));
    const gx = (h[j * nx + Math.min(nx - 1, i + 1)] - h[j * nx + Math.max(0, i - 1)]) / (2000 * kmPerPx);
    const gy = (h[Math.min(ny - 1, j + 1) * nx + i] - h[Math.max(0, j - 1) * nx + i]) / (2000 * kmPerPx);
    const len = Math.hypot(gx * exaggeration, 1, gy * exaggeration);
    nor.setXYZ(k, (-gx * exaggeration) / len, 1 / len, (-gy * exaggeration) / len);
    c.copy(LAND).lerp(CLIFF, Math.min(1, Math.max(0, (Math.hypot(gx, gy) - 0.35) / 0.5)));
    col.setXYZ(k, c.r, c.g, c.b);
  }
  pos.needsUpdate = nor.needsUpdate = col.needsUpdate = true;
  invalidate();
}

const numberTextures = new Map<string, THREE.CanvasTexture>();
function numberTexture(n: number, colour: string): THREE.CanvasTexture {
  const key = `${n}${colour}`;
  const known = numberTextures.get(key);
  if (known) return known;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = colour;
  g.beginPath();
  g.arc(48, 48, 44, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = '600 54px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), 48, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  numberTextures.set(key, t);
  return t;
}

function rebuildMarkers() {
  markerGroup.clear();
  const tall = Math.max(0.6, widthKm() * 0.012) * exaggeration;
  const thick = widthKm() * 0.0025;
  meta.markers.forEach((m, n) => {
    const colour = m.by ? '#a86f00' : '#c8102e';
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(thick, thick, tall, 8), new THREE.MeshBasicMaterial({ color: colour, fog: false }));
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTexture(n + 1, colour), fog: false, depthTest: false }));
    const base = sceneY(Math.max(meta.seaLevelM, heightAt(field, m.x, m.y)));
    pole.position.set(m.x, base + tall / 2, m.y);
    head.position.set(m.x, base + tall, m.y);
    head.scale.setScalar(thick * 11);
    head.renderOrder = 3;
    markerGroup.add(pole, head);
  });
  renderMarkerList();
  invalidate();
}

function pushUndo() {
  undoStack.push(field.h.slice());
  if (undoStack.length > UNDO_KEEP) undoStack.shift();
}
function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  field.h = prev;
  refresh({ i0: 0, i1: field.nx - 1, j0: 0, j1: field.ny - 1 });
  rebuildMarkers();
  saveHeights();
}

function pick(ev: PointerEvent): [number, number] | null {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector3(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1, 0.5).unproject(camera);
  const dir = ndc.sub(camera.position).normalize();
  const o = camera.position;
  const scaled = new THREE.Vector3(dir.x, dir.y / exaggeration, dir.z);
  return groundHit(field, [o.x, o.y / exaggeration, o.z], [scaled.x, scaled.y, scaled.z], meta.seaLevelM);
}

function drawRing() {
  ring.visible = !!hover && !eye && tool !== 'stand';
  if (!hover || !ring.visible) return;
  const p = ring.geometry.getAttribute('position') as THREE.BufferAttribute;
  const r = tool === 'mark' ? widthKm() * 0.008 : radiusKm;
  for (let n = 0; n < 64; n++) {
    const a = (n / 64) * Math.PI * 2;
    const x = hover[0] + Math.cos(a) * r, y = hover[1] + Math.sin(a) * r;
    p.setXYZ(n, x, sceneY(Math.max(meta.seaLevelM, heightAt(field, x, y))), y);
  }
  p.needsUpdate = true;
}

let stroke: { targetM: number; last: number } | null = null;
function strokeStep(now: number) {
  if (!stroke || !hover || tool === 'mark' || tool === 'stand') return;
  const dt = Math.min(0.1, (now - stroke.last) / 1000);
  stroke.last = now;
  refresh(stamp(field, { tool, x: hover[0], y: hover[1], radiusKm, amountM: strength * dt, targetM: stroke.targetM }));
}

function toggleMarker(at: [number, number]) {
  const near = meta.markers.findIndex((m) => Math.hypot(m.x - at[0], m.y - at[1]) < widthKm() * 0.012);
  if (near >= 0) meta.markers.splice(near, 1);
  else meta.markers.push({ x: Math.round(at[0] * 100) / 100, y: Math.round(at[1] * 100) / 100 });
  rebuildMarkers();
  saveMeta();
}

function standAt(at: [number, number]) {
  const back = eye ? eye.yaw : Math.atan2(controls.target.x - camera.position.x, controls.target.z - camera.position.z);
  eye = { x: at[0], y: at[1], yaw: back, pitch: 0 };
  controls.enabled = false;
  placeEye();
  renderPanel();
}
function leaveEye() {
  if (!eye) return;
  const e = eye;
  eye = null;
  controls.enabled = true;
  controls.target.set(e.x, sceneY(heightAt(field, e.x, e.y)), e.y);
  camera.position.set(e.x - Math.sin(e.yaw) * widthKm() * 0.25, controls.target.y + widthKm() * 0.2, e.y - Math.cos(e.yaw) * widthKm() * 0.25);
  controls.update();
  renderPanel();
  invalidate();
}
function placeEye() {
  if (!eye) return;
  eye.x = Math.min(widthKm(), Math.max(0, eye.x));
  eye.y = Math.min(depthKm(), Math.max(0, eye.y));
  const y = sceneY(Math.max(meta.seaLevelM, heightAt(field, eye.x, eye.y)) + EYE_M);
  camera.position.set(eye.x, y, eye.y);
  camera.lookAt(eye.x + Math.sin(eye.yaw) * Math.cos(eye.pitch), y + Math.sin(eye.pitch), eye.y + Math.cos(eye.yaw) * Math.cos(eye.pitch));
  invalidate();
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  canvas.setPointerCapture(ev.pointerId);
  if (eye && tool !== 'stand') { stroke = null; return; }
  const at = pick(ev);
  if (!at) return;
  if (tool === 'stand') { standAt(at); return; }
  if (tool === 'mark') { toggleMarker(at); return; }
  hover = at;
  pushUndo();
  stroke = { targetM: heightAt(field, at[0], at[1]), last: performance.now() };
});
canvas.addEventListener('pointermove', (ev) => {
  if (eye) {
    if (ev.buttons & 1 || ev.buttons & 2) {
      eye.yaw -= ev.movementX * 0.004;
      eye.pitch = Math.min(1.3, Math.max(-1.3, eye.pitch - ev.movementY * 0.004));
      placeEye();
    }
    return;
  }
  hover = pick(ev);
  if (hover) hud.textContent = `${hover[0].toFixed(1)} km east, ${hover[1].toFixed(1)} km south, ${Math.round(heightAt(field, hover[0], hover[1]))} m`;
  invalidate();
});
canvas.addEventListener('pointerup', () => {
  if (!stroke) return;
  stroke = null;
  rebuildMarkers();
  saveHeights();
});
window.addEventListener('keydown', (ev) => {
  if (ev.target instanceof HTMLInputElement && ev.target.type === 'text') return;
  if (ev.key === 'z' && (ev.ctrlKey || ev.metaKey)) { undo(); ev.preventDefault(); return; }
  if (ev.key === 'Escape') { leaveEye(); return; }
  const order: Tool[] = ['raise', 'lower', 'flatten', 'smooth', 'mark', 'stand'];
  const n = Number(ev.key);
  if (n >= 1 && n <= order.length) { tool = order[n - 1]; renderPanel(); invalidate(); return; }
  if (ev.key === '[') { radiusKm = Math.max(0.5, radiusKm / 1.25); renderPanel(); invalidate(); return; }
  if (ev.key === ']') { radiusKm = Math.min(30, radiusKm * 1.25); renderPanel(); invalidate(); return; }
  keys.add(ev.key.toLowerCase());
});
window.addEventListener('keyup', (ev) => keys.delete(ev.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
controls.addEventListener('change', invalidate);

function glide(f: number, s: number, dt: number) {
  const reach = camera.position.distanceTo(controls.target);
  const yaw = Math.atan2(controls.target.x - camera.position.x, controls.target.z - camera.position.z);
  const speed = reach * (keys.has('shift') ? 1.5 : 0.5) * dt;
  const dx = (Math.sin(yaw) * f - Math.cos(yaw) * s) * speed;
  const dz = (Math.cos(yaw) * f + Math.sin(yaw) * s) * speed;
  camera.position.x += dx;
  camera.position.z += dz;
  controls.target.x += dx;
  controls.target.z += dz;
  controls.update();
  invalidate();
}

function walk(dt: number) {
  const f = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
  const s = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  if (!f && !s) return;
  if (!eye) { glide(f, s, dt); return; }
  const speed = (keys.has('shift') ? 6 : 1.5) * dt;
  eye.x += (Math.sin(eye.yaw) * f - Math.cos(eye.yaw) * s) * speed;
  eye.y += (Math.cos(eye.yaw) * f + Math.sin(eye.yaw) * s) * speed;
  placeEye();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) (e as unknown as Record<string, string>)[k] = v;
  e.append(...kids);
  return e;
}
const markerList = el('ol');
function renderMarkerList() {
  markerList.replaceChildren(...meta.markers.map((m) => el('li', { className: m.by ? 'mine' : '', textContent: m.note ?? `${m.x.toFixed(0)} east, ${m.y.toFixed(0)} south` })));
}
function slider(text: string, min: number, max: number, value: number, set: (v: number) => void) {
  const out = el('small', { textContent: String(Math.round(value * 10) / 10) });
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: 'any', value: String(value) });
  input.addEventListener('input', () => { set(Number(input.value)); out.textContent = String(Math.round(Number(input.value) * 10) / 10); invalidate(); });
  return el('label', {}, `${text} `, out, input);
}
function renderPanel() {
  const names: [Tool, string][] = [['raise', '1 Raise'], ['lower', '2 Lower'], ['flatten', '3 Flatten'], ['smooth', '4 Smooth'], ['mark', '5 Mark'], ['stand', '6 Stand here']];
  const tools = el('div', { className: 'tools' }, ...names.map(([t, text]) => {
    const b = el('button', { textContent: text, className: t === tool ? 'on' : '' });
    b.addEventListener('click', () => { tool = t; renderPanel(); invalidate(); });
    return b;
  }));
  const back = el('button', { textContent: 'Back to overview (Esc)' });
  back.addEventListener('click', leaveEye);
  const undoB = el('button', { textContent: 'Undo (Ctrl+Z)' });
  undoB.addEventListener('click', undo);
  const reset = el('button', { textContent: 'Start over from skeleton' });
  reset.addEventListener('click', async () => {
    pushUndo();
    const keep = meta.markers;
    await fromSkeleton();
    meta.markers = keep;
    buildTerrain();
    rebuildMarkers();
    saveHeights();
    saveMeta();
  });
  const flat = el('button', { textContent: 'Start over flat' });
  flat.addEventListener('click', () => { pushUndo(); field.h.fill(120); refresh({ i0: 0, i1: field.nx - 1, j0: 0, j1: field.ny - 1 }); rebuildMarkers(); saveHeights(); });
  panel.replaceChildren(
    tools,
    slider('Brush size, km', 0.5, 30, radiusKm, (v) => { radiusKm = v; }),
    slider('Strength, m per second', 50, 3000, strength, (v) => { strength = v; }),
    slider('Height exaggeration', 1, 5, exaggeration, (v) => { exaggeration = v; water.position.y = sceneY(meta.seaLevelM); refresh({ i0: 0, i1: field.nx - 1, j0: 0, j1: field.ny - 1 }); rebuildMarkers(); placeEye(); }),
    ...(eye ? [back] : []),
    undoB, reset, flat,
    el('small', { textContent: eye ? 'Drag to look, WASD to walk, Shift to run.' : 'Left: tool. Right-drag: turn. WASD or middle-drag: move, Shift faster. Wheel: zoom.' }),
    el('small', { textContent: 'Marks (red yours, amber Dramba\'s):' }),
    markerList,
  );
  renderMarkerList();
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  invalidate();
}
window.addEventListener('resize', resize);

let lastFrame = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  strokeStep(now);
  walk(dt);
  if (dirty) {
    dirty = false;
    drawRing();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}

import.meta.hot?.on('tp:sketch-changed', async (d: { name: string }) => {
  if (d.name !== NAME || stroke) return;
  if (await fetchSketch()) { buildTerrain(); rebuildMarkers(); placeEye(); }
});

async function start() {
  if (!(await fetchSketch())) {
    await fromSkeleton();
    saveHeights();
    saveMeta();
  }
  buildTerrain();
  rebuildMarkers();
  controls.target.set(widthKm() / 2, 0, depthKm() / 2);
  camera.position.set(widthKm() / 2, widthKm() * 0.7, depthKm() * 1.35);
  controls.update();
  renderPanel();
  resize();
  Object.assign(window, { __sketch: { ready: true, stand: standAt, leave: leaveEye } });
  requestAnimationFrame(frame);
}
void start();
