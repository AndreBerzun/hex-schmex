import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { Simplex2, mulberry32 } from '../src/core/noise';
import { encodeRGB8 } from '../src/core/png';

const NX = 501, NY = 417, KM = 0.3;
const W = (NX - 1) * KM, H = (NY - 1) * KM;
const SEED = 4711;
const DAY_SEA = -60;
const out = process.argv[2] ?? 'sketches/shore-draft-1-regen';
const preview = process.argv[3];

const n1 = new Simplex2(SEED), n2 = new Simplex2(SEED + 1), n3 = new Simplex2(SEED + 2), n4 = new Simplex2(SEED + 3);
const rnd = mulberry32(SEED);
const sat = (v: number) => Math.min(1, Math.max(0, v));
const ss = (a: number, b: number, v: number) => { const t = sat((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
type P = [number, number];

function segDist(x: number, y: number, pts: P[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    const t = sat(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy));
    best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
  }
  return best;
}

const CRATER: P = [80, -58];
const CRATER_R = 100;
const southFoot = (x: number) => H - 33 + 6 * n2.fbm(x / 26, 3.1, 2) + Math.max(0, x - 84) * 0.62;
const westFoot = (y: number) => 30 + 6 * n2.fbm(7.7, y / 24, 2);

const peninsulas: { pts: P[]; w: number; top: number }[] = [
  { pts: [[36, 33], [40, 29.5], [44.5, 26.5]], w: 2.3, top: 820 },
  { pts: [[71, 43], [69.5, 35], [72, 29], [77, 26]], w: 1.9, top: 700 },
  { pts: [[97, 41], [99, 34], [97.5, 30]], w: 1.4, top: 720 },
  { pts: [[127, 31], [122, 23], [114, 19], [110, 21.5]], w: 2.2, top: 660 },
  { pts: [[20, 14], [26, 11], [29, 6]], w: 1.6, top: 800 },
];

const stacks: { x: number; y: number; r: number; top: number }[] = [];
{
  const anchors: P[] = [[47, 23], [50, 20], [79, 23], [82, 20], [96, 26], [106, 23], [101, 18], [32, 3], [60, 30], [57, 26], [88, 33], [134, 20], [139, 14]];
  for (const [ax, ay] of anchors) {
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) stacks.push({ x: ax + (rnd() - 0.5) * 6, y: ay + (rnd() - 0.5) * 6, r: 0.6 + rnd() * 1.3, top: 150 + rnd() * 300 });
  }
}

const massifs: { pts: P[]; r: number; top: number }[] = [
  { pts: [[55, 55], [60, 59], [58, 64]], r: 5.5, top: 1250 },
  { pts: [[69, 61], [66, 67]], r: 4.2, top: 950 },
  { pts: [[103, 75], [110, 73]], r: 4.5, top: 1300 },
  { pts: [[129, 47], [133, 53]], r: 5, top: 1000 },
  { pts: [[50, 72], [53, 76]], r: 4, top: 850 },
  { pts: [[121, 70], [126, 74]], r: 4, top: 800 },
  { pts: [[75, 84], [79, 87]], r: 3.6, top: 900 },
  { pts: [[100, 55], [97, 60]], r: 3.4, top: 700 },
];
const tables: { x: number; y: number; rx: number; ry: number; ang: number; top: number }[] = [
  { x: 64, y: 74, rx: 6.5, ry: 3.6, ang: 0.3, top: 380 },
  { x: 83, y: 64.5, rx: 5, ry: 2.6, ang: -0.15, top: 300 },
  { x: 112, y: 46, rx: 4.5, ry: 6, ang: 0.2, top: 420 },
  { x: 124, y: 60, rx: 5.5, ry: 4, ang: -0.4, top: 360 },
  { x: 47, y: 50.5, rx: 3.2, ry: 4.6, ang: 0.1, top: 330 },
  { x: 93, y: 84, rx: 0.1, ry: 0.1, ang: 0, top: 0 },
  { x: 136, y: 84, rx: 5, ry: 3.4, ang: 0.5, top: 300 },
  { x: 109, y: 64.5, rx: 3, ry: 2.2, ang: 0, top: 260 },
];
const tors: { x: number; y: number; r: number; top: number; mesa: boolean; ax: number; ang: number }[] = [];

function mountainDepth(x: number, y: number): number {
  return Math.max((y - southFoot(x)) / 33, (westFoot(y) - x) / 30);
}

function land(x: number, y: number): number {
  const wx = x + 3 * n3.fbm(x / 18, y / 18, 2), wy = y + 3 * n3.fbm(x / 18 + 9, y / 18 + 4, 2);
  let h = 470 + 190 * ss(45, 100, y) + 70 * n1.fbm(x / 34, y / 34, 3) + 22 * n1.fbm(x / 5, y / 5, 3);

  const m = mountainDepth(wx, wy);
  if (m > -0.4) {
    const rid = n2.ridged(x / 15, y / 15, 5);
    const foot = 380 * ss(-0.4, 0, m) * (0.5 + 0.5 * rid);
    const wall = (650 + 4800 * Math.pow(sat(m), 1.15)) * (0.5 + 0.5 * rid) * ss(0, 0.16, m);
    h += foot + wall;
  }

  const sx = wx - 86, sy = wy - 77;
  const sd = Math.hypot(sx, sy * 1.15) / 11.5;
  if (sd < 1) {
    const body = 2300 * Math.pow(1 - sd, 1.35) * (0.72 + 0.28 * n2.ridged(x / 7, y / 7, 4));
    const spire = 1500 * Math.pow(sat(1 - Math.hypot(x - 86, y - 77) / 2.6), 1.2);
    h += body * 1.1 + spire * 1.25;
  }

  {
    const c = Math.cos(-0.1), s = Math.sin(-0.1);
    const px = (wx - 86) * c - (wy - 50) * s, py = (wx - 86) * s + (wy - 50) * c;
    const e = Math.hypot(px / 33, py / 14) + 0.22 * n3.fbm(x / 11, y / 11, 3);
    const south = ss(1.0, 0.45, e);
    const rid = n4.ridged(x / 9, y / 9, 4);
    h += south * (500 + 1100 * rid);
  }

  {
    const d = segDist(wx, wy, [[6, 18], [22, 25], [35, 31.5]]);
    h += 760 * ss(4.6, 0.6, d) * (0.7 + 0.3 * n4.ridged(x / 6, y / 6, 3));
  }

  {
    const d = segDist(wx, wy, [[40, 47], [43, 58]]);
    const d2 = segDist(wx, wy, [[45, 68], [43, 80], [47, 90]]);
    const rid = 0.6 + 0.4 * n4.ridged(x / 6 + 3, y / 6, 3);
    h += 560 * ss(4.5, 0.5, d) * rid + 640 * ss(5, 0.5, d2) * rid;
  }

  {
    const edge = 79 + 3.5 * n3.fbm(x / 14, 2.2, 2);
    const p = ss(edge - 0.2, edge + 2.2, y) * ss(96, 100, x) * ss(146, 118, x);
    h += p * (430 + 60 * n1.fbm(x / 10, y / 10, 2));
    const basin = ss(1, 0.3, Math.hypot((x - 119) / 6.5, (y - 97) / 3.6));
    h -= basin * 130 * p;
  }

  {
    const marsh = ss(1, 0.35, Math.hypot((x - 54) / 11, (y - 40.5) / 8.5));
    h = lerp(h, 55 + 25 * n1.fbm(x / 6, y / 6, 2) + 4 * (y - 36), marsh);
    const lake = ss(1, 0.4, Math.hypot((x - 60) / 7.5, (y - 83) / 3.6));
    h = lerp(h, 430, lake);
  }

  const divides: { pts: P[]; width: number; rise: number }[] = [
    { pts: [[34, 44], [43, 48], [51, 55], [55, 62]], width: 5, rise: 1800 },
    { pts: [[45, 87], [48, 78], [52, 73]], width: 5, rise: 1500 },
    { pts: [[59, 49], [65, 55], [70, 59], [74, 64]], width: 4.2, rise: 1750 },
    { pts: [[103, 79], [111, 73], [116, 64]], width: 4.5, rise: 1900 },
    { pts: [[113, 47], [125, 45], [133, 51], [137, 58]], width: 4, rise: 1400 },
    { pts: [[106, 94], [117, 91], [126, 94], [133, 100]], width: 5, rise: 1600 },
    { pts: [[23, 34], [28, 43], [25, 55]], width: 5, rise: 2200 },
  ];
  for (const r of divides) {
    const d = segDist(wx, wy, r.pts);
    const apron = ss(r.width * 1.7, 0, d);
    const crest = Math.pow(sat(1 - d / r.width), 0.7);
    const ribs = 0.78 + 0.22 * n4.ridged(x / 3.8, y / 3.8, 3);
    h += r.rise * (0.2 * apron + 0.8 * crest) * ribs;
  }
  for (const [cx, cy, rx, ry, rise] of [[64, 43, 14, 9, 800], [111, 52, 18, 12, 650]]) {
    const e = Math.hypot((wx - cx) / rx, (wy - cy) / ry);
    h += rise * ss(1.12, 0.82, e);
  }
  for (const m of massifs) {
    const d = segDist(wx, wy, m.pts) / m.r;
    if (d < 1) h += m.top * 1.15 * Math.pow(1 - d, 1.25) * (0.62 + 0.38 * n4.ridged(x / 5 + m.r, y / 5, 4));
  }
  for (const t of tables) {
    const dx = x - t.x, dy = y - t.y, c = Math.cos(t.ang), s = Math.sin(t.ang);
    const d = Math.hypot((dx * c - dy * s) / t.rx, (dx * s + dy * c) / t.ry) + 0.32 * n3.fbm(x / 5 + t.x, y / 5, 3);
    if (d < 1.1) h += ss(1.0, 0.86, d) * (t.top + 35 * n1.fbm(x / 6, y / 6, 2)) + ss(1.1, 0.9, d) * 60;
  }
  for (const t of tors) {
    const dx = x - t.x, dy = y - t.y, c = Math.cos(t.ang), s = Math.sin(t.ang);
    const d = Math.hypot((dx * c - dy * s) / t.ax, dx * s + dy * c) / t.r + 0.3 * n3.fbm(x / 2.5, y / 2.5, 2);
    if (d >= 1) continue;
    h += t.top * (t.mesa ? ss(1, 0.55, d) : Math.pow(1 - d, 1.5) * (0.8 + 0.2 * n4.ridged(x / 3, y / 3, 2)));
  }

  for (const p of peninsulas) {
    const d = segDist(x, y, p.pts);
    if (d < p.w * 2.2) h = Math.max(h, lerp(h, p.top * (0.8 + 0.25 * n1.fbm(x / 4, y / 4, 2)), ss(p.w * 2.2, p.w * 0.5, d)));
  }
  const basinR = Math.hypot((wx - 130) / 12, (wy - 39) / 10) + 0.2 * n3.fbm(x / 9 + 40, y / 9, 3);
  h = lerp(h, 660 + 45 * n1.fbm(x / 6, y / 6, 2), ss(0.9, 0.58, basinR));
  h += 1550 * (0.4 + 0.6 * sat(0.55 + 1.3 * n2.fbm(x / 11 + 3, y / 11 + 8, 2))) * Math.exp(-Math.pow((basinR - 1.03) / 0.2, 2))
    * (0.85 + 0.15 * n4.ridged(x / 4, y / 4, 3));
  return h;
}

function craterInside(x: number, y: number): number {
  let inside = CRATER_R - Math.hypot(x - CRATER[0], y - CRATER[1]) + 7 * n3.fbm(x / 26, y / 26, 3) + 2.4 * n3.fbm(x / 8, y / 8, 3);
  for (const p of peninsulas) {
    const root = Math.hypot(x - p.pts[0][0], y - p.pts[0][1]);
    inside = Math.min(inside, segDist(x, y, p.pts) - p.w * (0.7 + 1.5 * ss(9, 0, root) + 0.9 * n1.fbm(x / 4 + 5, y / 4, 3)));
  }
  for (const s of stacks) inside = Math.min(inside, Math.hypot(x - s.x, y - s.y) - s.r * (0.8 + 0.35 * n1.fbm(x / 2, y / 2 + 7, 2)));
  return inside;
}

{
  const free = (x: number, y: number) => mountainDepth(x, y) < -0.25 && craterInside(x, y) < -4 && Math.hypot(x - 86, (y - 77) * 1.15) > 15
    && Math.hypot((x - 86) / 31, (y - 50) / 12) > 1.05 && Math.hypot((x - 54) / 11, (y - 40.5) / 8.5) > 1.1 && Math.hypot((x - 60) / 7.5, (y - 83) / 3.6) > 1.4;
  let tries = 0;
  while (tors.length < 28 && tries++ < 6000) {
    const x = 24 + rnd() * (W - 24), y = 30 + rnd() * (H - 50);
    if (!free(x, y) || tors.some((t) => Math.hypot(t.x - x, t.y - y) < 5)) continue;
    const east = ss(108, 128, x);
    const mesa = rnd() < 0.25 + 0.5 * east;
    tors.push({ x, y, r: 1.4 + rnd() * 2.6, top: (mesa ? 160 : 180) + rnd() * (mesa ? 240 : 420), mesa, ax: 1 + rnd() * 1.6, ang: rnd() * Math.PI });
  }
}

const h = new Float32Array(NX * NY);
for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) h[j * NX + i] = land(i * KM, j * KM);

const sample = (x: number, y: number) => {
  const fx = Math.min(NX - 1.001, Math.max(0, x / KM)), fy = Math.min(NY - 1.001, Math.max(0, y / KM));
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, k = j * NX + i;
  return (h[k] * (1 - u) + h[k + 1] * u) * (1 - v) + (h[k + NX] * (1 - u) + h[k + NX + 1] * u) * v;
};

interface Cut { pts: P[]; depth: number; bed: number; wall: number; mouth?: number; mouthGrad?: number; meander?: number }
function carve(c: Cut) {
  const line: { x: number; y: number; z: number }[] = [];
  let run = 0;
  for (let i = 0; i < c.pts.length - 1; i++) {
    const [ax, ay] = c.pts[i], [bx, by] = c.pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay), steps = Math.ceil(len / 0.3);
    for (let s = 0; s < steps; s++) {
      const t = s / steps, off = (c.meander ?? 0.9) * n4.fbm((run + len * t) / 5, c.pts[0][0] * 1.7, 2);
      line.push({ x: lerp(ax, bx, t) - ((by - ay) / len) * off, y: lerp(ay, by, t) + ((bx - ax) / len) * off, z: 0 });
    }
    run += len;
  }
  let z = Infinity;
  line.forEach((p, i) => {
    z = Math.min(z, sample(p.x, p.y) - c.depth);
    if (c.mouth !== undefined) z = Math.min(z, c.mouth + (line.length - 1 - i) * 0.3 * (c.mouthGrad ?? 12));
    p.z = z;
  });
  const reach = 9 / KM;
  const target = new Float32Array(NX * NY).fill(Infinity);
  for (const p of line) {
    const ci = Math.round(p.x / KM), cj = Math.round(p.y / KM);
    for (let j = Math.max(0, cj - reach); j <= Math.min(NY - 1, cj + reach); j++) for (let i = Math.max(0, ci - reach); i <= Math.min(NX - 1, ci + reach); i++) {
      const d = Math.hypot(i * KM - p.x, j * KM - p.y);
      if (d > 9) continue;
      const t = p.z + c.wall * Math.max(0, d - c.bed) + 90 * Math.pow(Math.max(0, d - 2.5), 2) + 14 * n1.fbm(i * KM / 2.5, j * KM / 2.5, 2) * Math.min(1, d);
      const k = j * NX + i;
      if (t < target[k]) target[k] = t;
    }
  }
  for (let k = 0; k < h.length; k++) if (target[k] < h[k]) h[k] = target[k];
}

carve({ pts: [[66, 83], [72, 78], [75, 70], [90, 66], [104, 63], [113, 55], [119, 45], [120.5, 37], [119, 31]], depth: 45, bed: 0.5, wall: 70, mouth: 15, mouthGrad: 16 });
carve({ pts: [[31, 104], [28, 92], [28, 80], [31, 66], [33, 52], [37, 42], [42.5, 36], [46, 32]], depth: 60, bed: 0.6, wall: 300, mouth: 15, mouthGrad: 14 });
carve({ pts: [[54, 83], [47, 81.5], [40, 81], [31, 80]], depth: 50, bed: 0.4, wall: 110 });
carve({ pts: [[3, 60], [10, 66], [13, 74], [21, 76], [28, 80]], depth: 150, bed: 0.35, wall: 280, meander: 1.1 });
carve({ pts: [[14, 44], [22, 47], [33, 52]], depth: 120, bed: 0.3, wall: 800, meander: 1.4 });
carve({ pts: [[50, 62], [44.5, 63], [39, 63], [31, 66]], depth: 40, bed: 0.5, wall: 160 });
carve({ pts: [[80, 62], [81, 52], [79, 45], [80.5, 39], [80, 35]], depth: 60, bed: 0.4, wall: 420, mouth: 15, mouthGrad: 45, meander: 1.2 });
carve({ pts: [[104, 63], [104, 55], [106, 47], [105, 40], [106.5, 35]], depth: 40, bed: 0.3, wall: 520, mouth: 15, mouthGrad: 60, meander: 1.2 });
carve({ pts: [[66, 122], [65, 108], [62, 96], [60, 86]], depth: 200, bed: 0.4, wall: 520, meander: 1.3 });
carve({ pts: [[119, 97], [112, 92], [103, 90], [98, 92], [86, 91], [76, 88], [68, 85]], depth: 70, bed: 0.4, wall: 380 });
carve({ pts: [[118, 78], [117, 70], [113, 62], [113, 55]], depth: 40, bed: 0.4, wall: 200 });
carve({ pts: [[12, 111], [16, 104], [24, 101], [31, 104]], depth: 220, bed: 0.3, wall: 250, meander: 1.0 });

carve({ pts: [[56, 62], [60, 58], [58, 51], [60, 44], [62, 36], [60, 30]], depth: 180, bed: 0.35, wall: 1050, mouth: 20, mouthGrad: 25 });
carve({ pts: [[93, 81], [95, 73], [91, 68], [90, 66]], depth: 170, bed: 0.4, wall: 850 });
carve({ pts: [[130, 39], [129, 44], [132, 48], [129, 53], [124, 56], [128, 61]], depth: 80, bed: 0.35, wall: 950, mouth: 410, mouthGrad: 3, meander: 0.35 });
carve({ pts: [[48, 74], [54, 70], [58, 65], [65, 64], [75, 70]], depth: 100, bed: 0.45, wall: 650 });

for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
  const x = i * KM, y = j * KM, k = j * NX + i;
  const hidden = ss(1, 0.5, Math.hypot((x - 11) / 5, (y - 112) / 4));
  h[k] = lerp(h[k], 1150 + 30 * n1.fbm(x / 4, y / 4, 2), hidden);

  const dry = ss(112, 134, x + 6 * n3.fbm(x / 20, y / 20 + 3, 2)) * ss(-0.05, -0.5, mountainDepth(x, y));
  if (dry > 0) {
    const wx = x + 2.2 * n3.fbm(x / 9, y / 9, 2) + 0.25 * y;
    const crest = Math.pow(1 - Math.abs(Math.sin((Math.PI * wx) / 3.3)), 1.7);
    const big = Math.pow(sat(0.5 + 0.9 * n2.fbm(x / 13, y / 13, 2)), 2);
    h[k] += dry * ss(126, 140, x) * (40 + 150 * big) * crest + dry * 180 * big * ss(118, 140, x);
  }

  const inside = craterInside(x, y);
  if (inside > -1.2) {
    const floor = 34 - 0.55 * Math.max(0, inside) + 7 * n1.fbm(x / 9, y / 9, 3) - 10 * Math.pow(1 - Math.abs(n3.fbm(x / 12, y / 12 + 20, 2)), 6);
    const step = h[k] > 650 ? lerp(h[k], h[k] * 0.55, ss(-0.2, 0.25, inside) * ss(0.9, 0.5, inside)) : h[k];
    const wall = h[k] > 650 ? ss(0.5, 1.15, inside) : ss(0, 0.75, inside);
    h[k] = lerp(lerp(h[k], step, ss(-0.2, 0.3, inside)), floor, wall);
  }
}

const markers = [
  { x: 43.5, y: 27.3, note: 'Dark City: on the headland over the crater, the start lookout' },
  { x: 86, y: 77, note: 'The Spine: lone peak, seen from everywhere' },
  { x: 53, y: 37, note: 'Wetland slope: the one place you walk down into the crater' },
  { x: 46, y: 32.5, note: 'West river mouth: a ravine by day, a fjord at night' },
  { x: 74, y: 28, note: 'Hook peninsula with stacks beyond its tip' },
  { x: 80.3, y: 41, note: 'Pass through the northern highland to a hidden cove' },
  { x: 120, y: 38, note: 'East river gorge: the long way down to the crater' },
  { x: 116, y: 21, note: 'North-east cape: shelters a bay you only see from its ridge' },
  { x: 41.5, y: 63, note: 'Gap in the hill range: first view of the central plain from the west valley' },
  { x: 60, y: 83, note: 'Lake basin under the south wall' },
  { x: 66, y: 110, note: 'Southern approach: a broader, gentler valley into the Hollow Mountains' },
  { x: 11, y: 112, note: 'Hidden high valley: approached through the widened southwest canyon' },
  { x: 8, y: 64, note: 'Canyon into the western Hollow Mountains' },
  { x: 108, y: 80.5, note: 'Edge of the south-east tableland: lookout over the east' },
  { x: 138, y: 70, note: 'Dunes: the mountains fall back and the east stays open' },
  { x: 60, y: 51, note: 'Split Crown ravine: sheer shelves hide the next bend; climb out for a coastal reveal' },
  { x: 54, y: 70, note: 'Folded valley: the west divide hides the Spine until the eastern saddle' },
  { x: 108, y: 75.5, note: 'Knife ridge: high traverse or the river loop around its northern foot' },
  { x: 129, y: 53, note: 'Bent Gate: follow the dogleg ravine north into the enclosed upland' },
  { x: 130, y: 39, note: 'Hidden northeast basin: sheltered floor above the tide, behind the northern separator' },
].map((m) => ({ ...m, by: 'Dramba' }));

writeFileSync(`${out}.bin`, Buffer.from(h.buffer));
writeFileSync(`${out}.json`, JSON.stringify({ nx: NX, ny: NY, kmPerPx: KM, seaLevelM: DAY_SEA, markers }, null, 1));

if (preview) {
  const rgba = new Uint8Array(NX * NY * 4);
  const ramp: [number, number[]][] = [[0, [120, 140, 150]], [60, [150, 160, 140]], [250, [176, 170, 130]], [600, [150, 140, 105]], [1500, [120, 105, 90]], [3000, [200, 200, 205]], [5500, [255, 255, 255]]];
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i, v = h[k];
    let c = ramp[ramp.length - 1][1];
    for (let r = 0; r < ramp.length - 1; r++) if (v < ramp[r + 1][0]) { const t = sat((v - ramp[r][0]) / (ramp[r + 1][0] - ramp[r][0])); c = ramp[r][1].map((a, q) => lerp(a, ramp[r + 1][1][q], t)); break; }
    const gx = (h[j * NX + Math.min(NX - 1, i + 1)] - h[j * NX + Math.max(0, i - 1)]) / (2000 * KM);
    const gy = (h[Math.min(NY - 1, j + 1) * NX + i] - h[Math.max(0, j - 1) * NX + i]) / (2000 * KM);
    const len = Math.hypot(gx * 2, gy * 2, 1);
    const shade = sat(0.25 + 0.95 * ((gx * 2 * 0.6 + gy * 2 * 0.5 + 0.62) / len));
    for (let q = 0; q < 3; q++) rgba[k * 4 + q] = Math.round(sat((c[q] / 255) * (0.35 + 0.9 * shade)) * 255);
  }
  for (const m of markers) for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) {
    const k = (Math.round(m.y / KM) + b) * NX + Math.round(m.x / KM) + a;
    rgba[k * 4] = 230; rgba[k * 4 + 1] = 150; rgba[k * 4 + 2] = 0;
  }
  writeFileSync(preview, await encodeRGB8(NX, NY, rgba, async (d) => new Uint8Array(deflateSync(d))));
}
let lo = Infinity, hi = -Infinity;
for (const v of h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
console.log(`${NX}x${NY} at ${KM} km, ${W.toFixed(0)}x${H.toFixed(0)} km, ${Math.round(lo)}..${Math.round(hi)} m, ${tors.length} hills, ${stacks.length} stacks`);
