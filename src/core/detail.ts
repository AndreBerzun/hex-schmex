export const DETAIL_CELL_KM = 0.25;
export const DETAIL_SLACK_M = 20;

function hash(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 0x8da6b343) + Math.imul(iz, 0xd8163841) + Math.imul(seed, 0xcb1ab31f)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

const out = new Float64Array(3);

function noise(x: number, z: number, seed: number): Float64Array {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const dux = 30 * fx * fx * (fx * (fx - 2) + 1), duz = 30 * fz * fz * (fz * (fz - 2) + 1);
  const ha = hash(ix, iz, seed), hb = hash(ix + 1, iz, seed), hc = hash(ix, iz + 1, seed), hd = hash(ix + 1, iz + 1, seed);
  const gax = (ha & 0xffff) / 32767.5 - 1, gaz = (ha >>> 16) / 32767.5 - 1;
  const gbx = (hb & 0xffff) / 32767.5 - 1, gbz = (hb >>> 16) / 32767.5 - 1;
  const gcx = (hc & 0xffff) / 32767.5 - 1, gcz = (hc >>> 16) / 32767.5 - 1;
  const gdx = (hd & 0xffff) / 32767.5 - 1, gdz = (hd >>> 16) / 32767.5 - 1;
  const va = gax * fx + gaz * fz, vb = gbx * (fx - 1) + gbz * fz;
  const vc = gcx * fx + gcz * (fz - 1), vd = gdx * (fx - 1) + gdz * (fz - 1);
  const k = va - vb - vc + vd;
  out[0] = 1.4 * (va + ux * (vb - va) + uz * (vc - va) + ux * uz * k);
  out[1] = 1.4 * (gax + ux * (gbx - gax) + uz * (gcx - gax) + ux * uz * (gax - gbx - gcx + gdx) + dux * (uz * k + vb - va));
  out[2] = 1.4 * (gaz + ux * (gbz - gaz) + uz * (gcz - gaz) + ux * uz * (gaz - gbz - gcz + gdz) + duz * (ux * k + vc - va));
  return out;
}

function band(wavelengthM: number, quadM: number): number {
  const t = Math.max(0, Math.min(1, (quadM - wavelengthM * 0.25) / (wavelengthM * 0.25)));
  return 1 - t * t * (3 - 2 * t);
}

export interface DetailSample { h: number; gx: number; gz: number; knoll: number; field: number }

export function downsDetail(xKm: number, zKm: number, quadM: number, seed: number, into: DetailSample = { h: 0, gx: 0, gz: 0, knoll: 0, field: -1 }): DetailSample {
  const x = xKm * 1000, z = zKm * 1000;
  let h = 0, gx = 0, gz = 0, knoll = 0, field = -1;
  const add = (lambda: number, amp: number, s: number, ox = 0, oz = 0) => {
    const w = band(lambda, quadM) * amp;
    if (w <= 0) return 0;
    const n = noise((x + ox) / lambda, (z + oz) / lambda, seed + s);
    h += n[0] * w; gx += n[1] * w / lambda; gz += n[2] * w / lambda;
    return w;
  };
  add(230, 8, 1);
  add(95, 3, 2);
  const wg = band(38, quadM) * 2.4;
  if (wg > 0) {
    const wa = noise(x / 700, z / 700, seed + 3);
    const sx = wa[0] * 120, sxx = wa[1] * 120 / 700, sxz = wa[2] * 120 / 700;
    const wb = noise(x / 700, z / 700, seed + 9);
    const sz = wb[0] * 120, szx = wb[1] * 120 / 700, szz = wb[2] * 120 / 700;
    const r = noise((x + sx) / 38, (z + sz) / 38, seed + 4);
    const sign = r[0] < 0 ? -1 : 1;
    const rx = sign * r[1] * wg / 38, rz = sign * r[2] * wg / 38;
    h += (Math.abs(r[0]) - 0.45) * wg;
    gx += rx * (1 + sxx) + rz * szx; gz += rx * sxz + rz * (1 + szz);
  }
  const wk = band(160, quadM);
  if (wk > 0) {
    const a = noise(x / 160, z / 160, seed + 5);
    const k0 = a[0], kx = a[1] / 160, kz = a[2] / 160;
    const b = noise(x / 45, z / 45, seed + 6);
    const lump = band(45, quadM) * 0.35;
    const b0 = b[0], bx = b[1] / 45, bz = b[2] / 45;
    const v = noise(x / 600, z / 600, seed + 10), v0 = v[0], vx = v[1] / 600, vz = v[2] / 600;
    const k = k0 + b0 * lump + 0.08 * v0, dkx = kx + bx * lump + 0.08 * vx, dkz = kz + bz * lump + 0.08 * vz;
    field = k;
    const t = Math.max(0, Math.min(1, (k - 0.28) / 0.16));
    if (t > 0) {
      const s = t * t * (3 - 2 * t), ds = t < 1 ? 6 * t * (1 - t) / 0.16 : 0;
      knoll = s * wk;
      const top = 11 * wk * (0.85 + 0.3 * v0), tx = 11 * wk * 0.3 * vx, tz = 11 * wk * 0.3 * vz;
      h += s * top; gx += ds * dkx * top + s * tx; gz += ds * dkz * top + s * tz;
      const c = noise(x / 12, z / 12, seed + 7);
      const cw = band(12, quadM) * 1.4 * wk;
      h += s * c[0] * cw; gx += (ds * dkx * c[0] + s * c[1] / 12) * cw; gz += (ds * dkz * c[0] + s * c[2] / 12) * cw;
    }
  }
  add(14, 0.35, 8);
  into.h = h; into.gx = gx; into.gz = gz; into.knoll = knoll; into.field = field;
  return into;
}

export interface CoverFields { rock: number; apron: number; hollow: number; grass: number }
export interface Cover extends CoverFields { mask: number; gx: number; gz: number }

export function coverFields(xKm: number, zKm: number, quadM: number, seed: number, d: DetailSample, mask: number, into: CoverFields): CoverFields {
  const x = xKm * 1000, z = zKm * 1000;
  const k = d.knoll, slope = Math.hypot(d.gx, d.gz) * mask, on = Math.min(1, mask * 1.6);
  const n1 = noise(x / 30, z / 30, seed + 21)[0] * band(30, quadM);
  const g1 = noise(x / 26, z / 26, seed + 22)[0] * band(26, quadM);
  const g2 = noise(x / 9, z / 9, seed + 23)[0] * band(9, quadM);
  const hollow = smooth(-0.8, -3, d.h * mask);
  into.rock = (k + n1 * 0.25 + k * smooth(0.35, 0.7, slope) * 0.5) * on;
  into.apron = smooth(0.04, 0.14, k) * (1 - smooth(0.4, 0.6, k)) * (0.75 + 0.5 * n1) * on;
  into.hollow = hollow;
  into.grass = mix(0.02, g1 + 0.5 * g2 + hollow * 0.5 + 0.08, band(26, quadM)) * mask;
  return into;
}

export function coverFrom(f: CoverFields, mask: number, gx: number, gz: number): Cover {
  const rock = smooth(0.84, 0.92, f.rock);
  const apron = smooth(0.4, 0.6, f.apron) * (1 - rock);
  const grass = smooth(-0.03, 0.06, f.grass) * (1 - rock) * (1 - apron) * (mask > 0 ? 1 : 0);
  return { rock, apron, hollow: f.hollow * (1 - rock), grass, mask, gx, gz };
}

function smooth(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export const DETAIL_GLSL = /* glsl */ `
uniform sampler2D uDetailMask;
uniform vec3 uDetailMaskInfo;
uniform int uDetailSeed;

uint dHash(int ix, int iz, int seed) {
  uint h = uint(ix) * 0x8da6b343u + uint(iz) * 0xd8163841u + uint(seed) * 0xcb1ab31fu;
  h ^= h >> 16; h *= 0x7feb352du;
  h ^= h >> 15; h *= 0x846ca68bu;
  h ^= h >> 16;
  return h;
}
vec2 dGrad(uint h) { return vec2(float(h & 0xffffu), float(h >> 16)) / 32767.5 - 1.0; }
vec3 dNoise(vec2 p, int seed) {
  vec2 i = floor(p), f = p - i;
  ivec2 ii = ivec2(i);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = dGrad(dHash(ii.x, ii.y, seed)), gb = dGrad(dHash(ii.x + 1, ii.y, seed));
  vec2 gc = dGrad(dHash(ii.x, ii.y + 1, seed)), gd = dGrad(dHash(ii.x + 1, ii.y + 1, seed));
  float va = dot(ga, f), vb = dot(gb, f - vec2(1.0, 0.0)), vc = dot(gc, f - vec2(0.0, 1.0)), vd = dot(gd, f - vec2(1.0));
  float k = va - vb - vc + vd;
  float v = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k;
  vec2 d = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * k + vec2(vb - va, vc - va));
  return 1.4 * vec3(v, d);
}
float dBand(float lambda, float q) { return 1.0 - smoothstep(lambda * 0.25, lambda * 0.5, q); }
vec3 dOctave(vec2 p, float lambda, float amp, float q, int s) {
  float w = dBand(lambda, q) * amp;
  if (w <= 0.0) return vec3(0.0);
  vec3 n = dNoise(p / lambda, uDetailSeed + s);
  return vec3(n.x * w, n.yz * w / lambda);
}
float dKnoll;
float dField;
vec4 dCover;
vec3 downsDetail(vec2 p, float q) {
  dKnoll = 0.0;
  dField = -1.0;
  vec3 r = dOctave(p, 230.0, 8.0, q, 1) + dOctave(p, 95.0, 3.0, q, 2);
  float wg = dBand(38.0, q) * 2.4;
  if (wg > 0.0) {
    vec3 wa = dNoise(p / 700.0, uDetailSeed + 3) * 120.0;
    vec3 wb = dNoise(p / 700.0, uDetailSeed + 9) * 120.0;
    vec3 g = dNoise((p + vec2(wa.x, wb.x)) / 38.0, uDetailSeed + 4);
    vec2 rg = (g.x < 0.0 ? -1.0 : 1.0) * g.yz * wg / 38.0;
    vec2 jx = vec2(1.0 + wa.y / 700.0, wb.y / 700.0), jz = vec2(wa.z / 700.0, 1.0 + wb.z / 700.0);
    r += vec3((abs(g.x) - 0.45) * wg, dot(rg, jx), dot(rg, jz));
  }
  float wk = dBand(160.0, q);
  if (wk > 0.0) {
    vec3 a = dNoise(p / 160.0, uDetailSeed + 5);
    vec3 b = dNoise(p / 45.0, uDetailSeed + 6);
    float lump = dBand(45.0, q) * 0.35;
    vec3 v = dNoise(p / 600.0, uDetailSeed + 10);
    float k = a.x + b.x * lump + 0.08 * v.x;
    vec2 dk = a.yz / 160.0 + b.yz / 45.0 * lump + 0.08 * v.yz / 600.0;
    dField = k;
    float t = clamp((k - 0.28) / 0.16, 0.0, 1.0);
    if (t > 0.0) {
      float s = t * t * (3.0 - 2.0 * t), ds = t < 1.0 ? 6.0 * t * (1.0 - t) / 0.16 : 0.0;
      dKnoll = s * wk;
      float top = 11.0 * wk * (0.85 + 0.3 * v.x);
      r += vec3(s * top, ds * dk * top + s * 11.0 * wk * 0.3 * v.yz / 600.0);
      vec3 c = dNoise(p / 12.0, uDetailSeed + 7);
      float cw = dBand(12.0, q) * 1.4 * wk;
      r += vec3(s * c.x * cw, (ds * dk * c.x + s * c.yz / 12.0) * cw);
    }
  }
  return r + dOctave(p, 14.0, 0.35, q, 8);
}
float detailMask(vec2 xzKm) {
  vec2 m = (1.0 - abs(mod(xzKm / uWorldKm, 2.0) - 1.0)) * uWorldKm;
  vec2 n = uDetailMaskInfo.xy;
  vec2 f = clamp(m / uDetailMaskInfo.z - 0.5, vec2(0.0), n - 1.001);
  ivec2 i = ivec2(floor(f));
  vec2 t = f - vec2(i);
  float a = texelFetch(uDetailMask, i, 0).r, b = texelFetch(uDetailMask, i + ivec2(1, 0), 0).r;
  float c = texelFetch(uDetailMask, i + ivec2(0, 1), 0).r, d = texelFetch(uDetailMask, i + ivec2(1, 1), 0).r;
  return (a * (1.0 - t.x) + b * t.x) * (1.0 - t.y) + (c * (1.0 - t.x) + d * t.x) * t.y;
}
vec4 coverFields(vec2 p, float q, vec3 d, float m) {
  float k = dKnoll, slope = length(d.yz) * m, on = min(1.0, m * 1.6);
  float n1 = dNoise(p / 30.0, uDetailSeed + 21).x * dBand(30.0, q);
  float g1 = dNoise(p / 26.0, uDetailSeed + 22).x * dBand(26.0, q);
  float g2 = dNoise(p / 9.0, uDetailSeed + 23).x * dBand(9.0, q);
  float hollow = 1.0 - smoothstep(-3.0, -0.8, d.x * m);
  float rock = (k + n1 * 0.25 + k * smoothstep(0.35, 0.7, slope) * 0.5) * on;
  float apron = smoothstep(0.04, 0.14, k) * (1.0 - smoothstep(0.4, 0.6, k)) * (0.75 + 0.5 * n1) * on;
  float grass = mix(0.02, g1 + 0.5 * g2 + hollow * 0.5 + 0.08, dBand(26.0, q)) * m;
  return vec4(rock, apron, hollow, grass);
}
vec4 groundDetail(vec2 xzKm, float q) {
  float m = detailMask(xzKm);
  dKnoll = 0.0;
  dCover = vec4(0.0);
  if (m <= 0.0) return vec4(0.0);
  vec3 d = downsDetail(xzKm * 1000.0, q);
  dCover = coverFields(xzKm * 1000.0, q, d, m);
  return vec4(d * m, m);
}
`;

export class DetailMask {
  constructor(readonly data: Float32Array, readonly nx: number, readonly ny: number, readonly cellKm: number,
    readonly worldW: number, readonly worldH: number) {}

  at(xKm: number, zKm: number): number {
    const x = mirrorKm(xKm, this.worldW), z = mirrorKm(zKm, this.worldH);
    const fx = Math.min(this.nx - 1.001, Math.max(0, x / this.cellKm - 0.5));
    const fz = Math.min(this.ny - 1.001, Math.max(0, z / this.cellKm - 0.5));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * this.nx + i, d = this.data;
    return (d[k] * (1 - tx) + d[k + 1] * tx) * (1 - tz) + (d[k + this.nx] * (1 - tx) + d[k + this.nx + 1] * tx) * tz;
  }
}

function mirrorKm(v: number, size: number): number {
  const u = v / size;
  return (1 - Math.abs((((u % 2) + 2) % 2) - 1)) * size;
}

export function buildDetailMask(worldW: number, worldH: number, seed: number, weightAt: (xKm: number, zKm: number) => number): DetailMask {
  const nx = Math.ceil(worldW / DETAIL_CELL_KM), ny = Math.ceil(worldH / DETAIL_CELL_KM);
  const raw = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) * DETAIL_CELL_KM, z = (j + 0.5) * DETAIL_CELL_KM;
    const w = weightAt(x, z);
    const rugged = Math.max(-1, Math.min(1, noise(x / 2.4, z / 2.4, seed + 11)[0] * 1.6));
    raw[j * nx + i] = w < 0 ? -1 : w * (0.75 + 0.35 * rugged);
  }
  const data = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let sum = 0, forbidden = false;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const v = raw[Math.max(0, Math.min(ny - 1, j + dj)) * nx + Math.max(0, Math.min(nx - 1, i + di))];
      if (v < 0) forbidden = true; else sum += v;
    }
    data[j * nx + i] = forbidden ? 0 : sum / 9;
  }
  return new DetailMask(data, nx, ny, DETAIL_CELL_KM, worldW, worldH);
}
