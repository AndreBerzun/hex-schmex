// Terrain material: CDLOD vertex shader + rule-based surface materials, lighting, water, haze, hex overlay.

import { ATMOS, LANDMARK_SHADOW, TIDE } from './glsl';
import { NOISE_LUT } from './noiseLut';
import { CANOPY_TILE_KM } from './canopyLut';
import { DETAIL_GLSL } from '../core/detail';

export const TERRAIN_VS = TIDE + /* glsl */ `
attribute vec4 aNode; // x0, z0 (km), size (km), level
uniform sampler2D uHeight;
uniform float uHeightScale;
uniform sampler2D uWaterTex;
uniform vec2 uWorldKm;
uniform vec2 uGridKm;
uniform float uGridN;
uniform float uLeafRange;
uniform float uMinLevel;
uniform float uCoarseKm;
uniform vec2 uOrigin;
uniform float uExag;
uniform float uDetailOn;
varying vec3 vWorld;
varying vec2 vUv;
varying float vLevel;
varying float vOut;
varying vec4 vDetail;
varying float vKnoll;
varying vec4 vCover;
` + DETAIL_GLSL + /* glsl */ `
vec2 gridUv(vec2 xz) { return (1.0 - abs(mod(xz / uWorldKm, 2.0) - 1.0)) * uWorldKm / uGridKm; }

float surf(vec2 uv) {
  float h = texture2D(uHeight, uv).r * uHeightScale;
  float w = max(texture2D(uWaterTex, uv).r, tideAt(uv * uGridKm));
  return w - h > 0.25 ? w : h;
}
float surfAt(vec2 xz) { return surf(gridUv(xz)); }
float coarseSurf(vec2 xz) {
  vec2 g = (xz - uOrigin) / uCoarseKm;
  vec2 i = floor(g), t = g - i;
  vec2 o = uOrigin + i * uCoarseKm;
  float a = surfAt(o), b = surfAt(o + vec2(uCoarseKm, 0.0)), c = surfAt(o + vec2(0.0, uCoarseKm)), d = surfAt(o + vec2(uCoarseKm));
  if (mod(i.x + i.y, 2.0) > 0.5) return t.x + t.y <= 1.0 ? a + (b - a) * t.x + (c - a) * t.y : d + (c - d) * (1.0 - t.x) + (b - d) * (1.0 - t.y);
  return t.x >= t.y ? a + (b - a) * t.x + (d - b) * t.y : a + (d - c) * t.x + (c - a) * t.y;
}

void main() {
  vec2 g = position.xz * uGridN;
  float size = aNode.z;
  float level = aNode.w;
  vec2 xz = aNode.xy + g / uGridN * size;
  vec2 uv = gridUv(xz);
  vec3 wp = vec3(xz.x, surf(uv) * 0.001 * uExag, xz.y);
  float range = uLeafRange * exp2(level);
  float prev = level > uMinLevel + 0.5 ? range * 0.5 : 0.0;
  float mStart = mix(prev, range, 0.6);
  float k = clamp((distance(cameraPosition, wp) - mStart) / max(1e-4, range - mStart), 0.0, 1.0);
  vec2 gm = g - fract(g * 0.5) * 2.0 * k;
  xz = aNode.xy + gm / uGridN * size;
  uv = gridUv(xz);
  vDetail = groundDetail(xz, size * 1000.0 / uGridN * (1.0 + k));
  vKnoll = dKnoll * vDetail.w;
  vCover = dCover;
  float base = level < -0.5 ? coarseSurf(xz) : surf(uv);
  wp = vec3(xz.x, (base + vDetail.x) * 0.001 * uExag, xz.y);
  vWorld = wp;
  vUv = uv;
  vec2 o = max(-xz, xz - uWorldKm);
  vOut = max(o.x, o.y);
  vLevel = level;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

export const TERRAIN_FS = ATMOS + LANDMARK_SHADOW + TIDE + NOISE_LUT + /* glsl */ `
uniform sampler2D uHeight;
uniform float uHeightScale;
uniform sampler2D uSurf;      // rg slope, b curvature (>0 concave), a mean slope magnitude
uniform sampler2D uData;      // r moisture, g log10 drainage km², b deposition m, a river-op mask
uniform sampler2D uPaintA;
uniform sampler2D uPaintB;
uniform float uPaintOn;
uniform vec4 uBrush;
uniform float uBrushCore;
uniform sampler2D uWaterTex;  // water surface level, m
uniform sampler2D uShadowTex;
uniform sampler2D uAOTex;
uniform vec2 uWorldKm;
uniform vec2 uGridKm;
uniform float uSea;
uniform float uMaxElev;
uniform float uSnowline;
uniform float uTreeline;
uniform float uTemp;
uniform float uAshen;
uniform float uTidal;
uniform float uHasHydro;
uniform sampler2D uCanopy;
uniform int uDebug;
uniform float uRiverMinLog;   // log10 km² where streams start to show
// hex overlay
uniform float uHexOn;
uniform float uHexOpacity;
uniform float uHexSize;       // centre-to-vertex km
uniform float uHexFlat;       // 1 = flat-top
uniform vec2 uHexOrigin;      // centre of hex 0101, km
uniform vec2 uHexGrid;        // cols, rows
uniform vec2 uHexHover;       // 1-based col,row (0 = none)
uniform vec2 uHexSel;
uniform float uDetailOn;
uniform float uSurroundKm;
varying vec3 vWorld;
varying vec2 vUv;
varying float vLevel;
varying float vOut;
varying vec4 vDetail;
varying float vKnoll;
varying vec4 vCover;

float H(vec2 uv) { return texture2D(uHeight, uv).r * uHeightScale; }

float sdHexFlat(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}

// returns (col, row) 1-based in xy, signed edge distance (km, <0 inside) in z
vec3 hexAt(vec2 xz) {
  vec2 p = xz - uHexOrigin;
  float s = uHexSize;
  float q, r;
  if (uHexFlat > 0.5) { q = (2.0 / 3.0 * p.x) / s; r = (-1.0 / 3.0 * p.x + 0.57735027 * p.y) / s; }
  else { q = (0.57735027 * p.x - 1.0 / 3.0 * p.y) / s; r = (2.0 / 3.0 * p.y) / s; }
  float x = q, z = r, y = -x - z;
  float rx = floor(x + 0.5), ry = floor(y + 0.5), rz = floor(z + 0.5);
  float dx = abs(rx - x), dy = abs(ry - y), dz = abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
  vec2 c; float col, row;
  if (uHexFlat > 0.5) {
    c = vec2(s * 1.5 * rx, s * 1.7320508 * (rz + rx * 0.5));
    col = rx; row = rz + (rx - mod(rx, 2.0)) * 0.5;
  } else {
    c = vec2(s * 1.7320508 * (rx + rz * 0.5), s * 1.5 * rz);
    col = rx + (rz - mod(rz, 2.0)) * 0.5; row = rz;
  }
  vec2 lp = p - c;
  if (uHexFlat < 0.5) lp = lp.yx;
  float d = sdHexFlat(lp, s * 0.8660254);
  return vec3(col + 1.0, row + 1.0, d);
}

vec3 matColor(float id) {
  // debug palette for material ids
  if (id < 0.5) return vec3(0.3, 0.6, 0.2);
  if (id < 1.5) return vec3(0.05, 0.3, 0.08);
  if (id < 2.5) return vec3(0.5, 0.5, 0.5);
  if (id < 3.5) return vec3(1.0);
  if (id < 4.5) return vec3(0.75, 0.6, 0.35);
  if (id < 5.5) return vec3(0.9, 0.85, 0.5);
  if (id < 6.5) return vec3(0.35, 0.4, 0.2);
  if (id < 7.5) return vec3(0.75, 0.35, 0.15);
  if (id < 8.5) return vec3(0.1, 0.3, 0.8);
  return vec3(0.55, 0.5, 0.65);
}

// One filtered lookup supplies both colour breakup and height derivatives.
// Fade each physical scale before it becomes subpixel, including at grazing angles.
#ifdef SURFACE_DETAIL
uniform float uSurfaceFade;
vec3 groundDetail(vec2 xz, float wavelength) {
  float visible = uDetailOn * uSurfaceFade * (1.0 - smoothstep(wavelength * 0.12, wavelength * 0.65, gFw));
  if (visible <= 0.0) return vec3(0.0);
  vec4 texel = lutFetch(xz, wavelength);
  vec2 gradient = ((texel.gb - 0.5) * 12.0) * LUT_ROT;
  return vec3((texel.r - 0.5) * 3.0, gradient) * visible;
}
#endif

void main() {
  vec2 uv = vUv;
  vec3 camToFrag = vWorld - cameraPosition;
  float dist = length(camToFrag);
  vec3 V = -camToFrag / max(dist, 1e-5);
  vec2 xz = vWorld.xz;
  float fw = max(length(fwidth(xz)), 1e-5); // km per pixel here
  gFw = fw;

  float h = H(uv) + vDetail.x;
  float outside = 1.0 - exp(-max(vOut, 0.0) / 30.0);
  vec4 surf = texture2D(uSurf, uv);
  vec2 grad = surf.rg * sign(1.0 - mod(xz / uWorldKm, 2.0)) + vDetail.yz;
  float lap = surf.b;

  // close-up procedural detail: ridged micro-relief on slopes, fading where it would alias
  float detailFade = uDetailOn * (1.0 - smoothstep(0.004, 0.03, fw)) * (1.0 - vDetail.w);
  vec2 dgrad = vec2(0.0);
  if (detailFade > 0.0) {
    float ws = 0.18; // km
    float amp = 14.0 * (0.3 + 1.6 * clamp(length(grad), 0.0, 1.0));
    dgrad = noiseGradAt(xz, ws) / (ws * 1000.0) * amp * detailFade;
  }
  float g = max(surf.a, length(grad + dgrad * 0.5));
  float gR = max(surf.a, length(grad - vDetail.yz + dgrad * 0.5));
  vec3 n = normalize(vec3(-(grad.x + dgrad.x) * uExag, 1.0, -(grad.y + dgrad.y) * uExag));

  vec4 data = uHasHydro > 0.5 ? texture2D(uData, uv) : vec4(0.5, 0.0, 0.0, 0.0);
  float moist = data.r;
  float logA = data.g;
  float dep = data.b;
  float riverOp = max(data.a, 0.0);
  float playa = smoothstep(-0.3, -0.8, data.a);
  float wl = uHasHydro > 0.5 ? texture2D(uWaterTex, uv).r : -1e5;
  wl = max(wl, tideAt(xz));
  float depth = wl - h;

  // ---- noise fields (km space)
  float nBig = noiseAt(xz, 9.0);      // regional patchiness
  float nMid = noiseAt(xz, 1.3);      // stands, meadows
  float nFine = noiseAt(xz, 0.12);    // texture

  float pCov = 0.0;
  vec4 pA = vec4(0.0);
  vec4 pB = vec4(0.0);
  if (uPaintOn > 0.5) {
    vec2 puv = uv + noiseGradAt(xz, 1.3) * 0.14 / uGridKm;
    pA = texture2D(uPaintA, puv);
    pB = texture2D(uPaintB, puv);
    float raw = pB.a;
    pCov = smoothstep(0.12, 0.88, raw + nMid * 1.2 * raw * (1.0 - raw));
    float inv = 1.0 / max(raw, 1e-3);
    pA = clamp(pA * inv, 0.0, 1.0);
    pB.rgb = clamp(pB.rgb * inv, 0.0, 1.0);
  }

  // ---- materials (sRGB-authored, converted to linear)
  vec3 cGrass = srgb(mix(vec3(0.36, 0.40, 0.25), vec3(0.155, 0.15, 0.15), uAshen));
  vec3 cMeadow = srgb(mix(vec3(0.45, 0.46, 0.30), vec3(0.19, 0.18, 0.18), uAshen));
  vec3 cDry = srgb(mix(vec3(0.59, 0.53, 0.36), vec3(0.27, 0.26, 0.255), uAshen));
  vec3 cSand = srgb(mix(vec3(0.78, 0.7, 0.5), vec3(0.48, 0.47, 0.455), uAshen));
  vec3 cBad = srgb(mix(vec3(0.66, 0.36, 0.2), vec3(0.46, 0.44, 0.43), uAshen));
  vec3 cForest = srgb(mix(vec3(0.22, 0.28, 0.18), vec3(0.40, 0.09, 0.10), uAshen));
  vec3 cConifer = srgb(mix(vec3(0.17, 0.23, 0.19), vec3(0.25, 0.05, 0.065), uAshen));
  vec3 cAlpine = srgb(mix(vec3(0.47, 0.46, 0.3), vec3(0.28, 0.27, 0.27), uAshen));
  vec3 cRock = srgb(mix(vec3(0.46, 0.44, 0.41), vec3(0.31, 0.31, 0.33), uAshen));
  vec3 cRockDark = srgb(mix(vec3(0.3, 0.29, 0.28), vec3(0.16, 0.16, 0.18), uAshen));
  vec3 cScree = srgb(mix(vec3(0.55, 0.53, 0.5), vec3(0.34, 0.335, 0.33), uAshen));
  vec3 cSnow = srgb(vec3(0.93, 0.95, 0.98));
  vec3 cMarsh = srgb(mix(vec3(0.27, 0.32, 0.16), vec3(0.11, 0.12, 0.13), uAshen));
  vec3 cMarshWet = srgb(mix(vec3(0.2, 0.3, 0.3), vec3(0.17, 0.155, 0.14), uAshen));
  vec3 cGravel = srgb(mix(vec3(0.62, 0.6, 0.56), vec3(0.36, 0.35, 0.34), uAshen));
  vec3 cSoil = srgb(mix(vec3(0.42, 0.36, 0.25), vec3(0.14, 0.13, 0.13), uAshen));
  vec3 cTidal = srgb(vec3(0.30, 0.285, 0.265));

  float elev = h - uSea;
  float drySide = clamp(1.0 - moist * 1.6 + uTemp * 0.3, 0.0, 1.0);
  vec3 col = mix(mix(cGrass, cMeadow, smoothstep(-0.3, 0.4, nMid)), cDry, smoothstep(0.35, 0.75, drySide + nBig * 0.15));
  // Soil between clumps; the fine layers below survive the ashen palette too.
  float gt = noiseAt(xz, 0.02);
  col *= 0.88 + 0.24 * (gt * 0.5 + 0.5);
  col = mix(col, cSoil, smoothstep(0.55, 0.85, noiseAt(xz + 0.75, 0.25)) * 0.35);
  // above the treeline: thin alpine turf, browner and stonier
  float alpine = smoothstep(uTreeline - 50.0, uTreeline + 350.0, elev + nMid * 120.0);
  col = mix(col, cAlpine * (0.9 + 0.2 * nFine), alpine * (1.0 - drySide * 0.5));
  // desert sands and badlands where very dry
  float desert = smoothstep(0.78, 0.92, drySide + nBig * 0.1) * (1.0 - smoothstep(0.25, 0.5, g));
  desert = mix(desert, pA.b, pCov);
  col = mix(col, cSand * (0.92 + 0.12 * nMid), desert);
  float bad = smoothstep(0.7, 0.85, drySide) * smoothstep(0.18, 0.4, g);
  bad = mix(bad, pA.a, pCov);
  vec3 badCol = mix(cBad, cBad * mix(vec3(1.2, 1.05, 0.9), vec3(0.8, 0.79, 0.8), uAshen), 0.5 + 0.5 * sin(h / 18.0 + nMid * 2.0));
  col = mix(col, badCol, bad);
  float id = desert > 0.5 ? 5.0 : bad > 0.5 ? 7.0 : 0.0;

  // marsh: flat, wet, low
  float marsh = smoothstep(0.72, 0.85, moist + nMid * 0.08) * (1.0 - smoothstep(0.015, 0.05, g)) * (1.0 - smoothstep(250.0, 500.0, elev));
  marsh = mix(marsh, pA.g, pCov);
  col = mix(col, mix(cMarsh, cMarshWet, smoothstep(0.2, 0.6, nFine) * 0.5), marsh);
  if (marsh > 0.5) id = 6.0;

  // forest canopy: below the treeline, moist enough, not too steep, clumped
  float tl = uTreeline + nBig * 180.0;
  float forest = smoothstep(0.44, 0.68, moist + nBig * 0.18 + nMid * 0.09)
               * (1.0 - smoothstep(tl - 150.0, tl + 60.0, elev))
               * (1.0 - smoothstep(0.55, 0.85, g))
               * (1.0 - marsh * 0.8) * (1.0 - desert);
  forest = smoothstep(0.1, 0.9, forest);
  forest = mix(forest, pA.r, pCov);
  forest *= mix(1.0, smoothstep(-0.45, 0.05, noiseAt(xz + 2.3, 0.35)), uAshen);
  vec3 fcol = mix(cForest, cConifer, smoothstep(tl - 900.0, tl - 200.0, elev));
  fcol *= 0.92 + 0.16 * nFine + 0.08 * nMid;
  col = mix(col, fcol, forest);
  if (forest > 0.5) id = 1.0;

  // rock on steep slopes, more on convex ridges, banded strata hint
  float rockAmt = smoothstep(0.55, 0.95, gR + nMid * 0.12 - lap * 0.6 + nFine * 0.05 + alpine * 0.25);
  float strataH = h + dot(xz, vec2(21.0, 28.0)) + nBig * 260.0;
  float beds = 0.5 * sin(strataH / 40.0 + nMid * 3.0) + 0.35 * sin(strataH / 113.0 + nBig * 2.0) + 0.15 * sin(strataH / 17.0);
  vec3 rcol = mix(cRockDark, cRock, 0.5 + 0.4 * beds * clamp(0.55 + 0.45 * nBig, 0.15, 1.0));
  rockAmt = mix(rockAmt, pB.r, pCov);
  rcol *= 0.85 + 0.3 * (nFine * 0.5 + 0.5);
  col = mix(col, rcol, rockAmt);
  float outcrop = 0.0;
  if (uAshen > 0.5) {
    float coverOn = (1.0 - desert) * (1.0 - marsh) * (1.0 - smoothstep(0.05, 0.3, forest)) * (1.0 - rockAmt) * (1.0 - smoothstep(0.5, 0.75, drySide + nBig * 0.15)) * (1.0 - smoothstep(uSnowline - 700.0, uSnowline - 300.0, elev));
    float n4 = noiseAt(xz + 5.3, 0.004), n2 = noiseAt(xz + 1.1, 0.0016), n1 = noiseAt(xz + 6.1, 0.0008);
    float tuft = noiseAt(xz + 7.7, 0.012) * 0.5 + 0.5;
    float e = n4 * 0.7 + n2 * 0.3;
    outcrop = smoothstep(0.85, 0.91, vCover.x + e * 0.07);
    float apron = smoothstep(0.35, 0.75, vCover.y + e * 0.35 + gt * 0.4) * (1.0 - outcrop) * coverOn;
    float hollow = vCover.z * (1.0 - outcrop) * coverOn;
    float grass = smoothstep(-0.06, 0.09, vCover.w + e * 0.12 + gt * 0.06) * (1.0 - outcrop) * (1.0 - apron) * coverOn;
    vec3 cEarth = srgb(mix(vec3(0.3, 0.25, 0.18), vec3(0.215, 0.19, 0.165), uAshen)) * (0.86 + 0.28 * (gt * 0.5 + 0.5));
    col = mix(col, cEarth * (1.0 - 0.22 * hollow) * (1.0 - 0.3 * smoothstep(0.0, 0.4, n1)) * (1.0 + 0.3 * smoothstep(0.15, 0.5, -n2)), coverOn * 0.85);
    vec3 cGold = mix(srgb(vec3(0.43, 0.37, 0.23)), srgb(vec3(0.31, 0.31, 0.19)), hollow * 0.8) * (0.85 + 0.3 * tuft);
    col = mix(col, cGold, grass * (0.6 + 0.4 * tuft));
    vec3 cPebble = srgb(mix(vec3(0.55, 0.53, 0.5), vec3(0.32, 0.315, 0.3), uAshen)) * (0.72 + 0.4 * (e * 0.5 + 0.5));
    col = mix(col, cPebble, apron * 0.6);
    col *= 1.0 - grass * smoothstep(-0.05, 0.35, n2) * 0.35;
    col *= 1.0 - apron * smoothstep(0.0, 0.4, n1) * 0.35;
    vec3 slab = mix(cRock, cRockDark, 0.45 + 0.3 * sin(h * 1.3 + gt * 2.0)) * (0.8 + 0.4 * smoothstep(-0.2, 0.8, n2));
    col = mix(col, slab, outcrop);
  }
  rockAmt = max(rockAmt, outcrop);
  if (rockAmt > 0.5) id = 2.0;

  // scree / talus: deposition on moderate slopes at altitude, and at the foot of cliffs
  float scree = smoothstep(2.0, 12.0, dep) * smoothstep(0.12, 0.35, gR) * (1.0 - smoothstep(0.75, 1.0, gR)) * smoothstep(tl - 400.0, tl + 200.0, elev);
  scree *= 1.0 - pCov;
  col = mix(col, cScree * (0.9 + 0.2 * nFine), scree * 0.8);
  if (scree > 0.5) id = 4.0;

  // snow: altitude + aspect (more on north/shaded faces) + slope (sheds off cliffs)
  float north = clamp(-n.z, -1.0, 1.0); // north is -z
  float sl = uSnowline - north * 260.0 + nBig * 160.0 + nMid * 90.0 - lap * 900.0;
  float snow = smoothstep(sl - 120.0, sl + 160.0, elev) * (1.0 - smoothstep(1.0, 1.6, g + nFine * 0.15));
  snow = mix(snow, pB.g, pCov);
  col = mix(col, cSnow * (0.94 + 0.06 * nFine), snow);
  if (snow > 0.5) id = 3.0;

  // playa: salt-crusted dry lake bed
  col = mix(col, srgb(mix(vec3(0.86, 0.83, 0.76), vec3(0.42, 0.41, 0.40), uAshen)) * (0.94 + 0.08 * nMid), playa);

  // beaches near sea level
  float beach = (1.0 - smoothstep(1.5, 6.0, elev + nMid * 3.0)) * (1.0 - smoothstep(0.03, 0.12, g)) * step(-1.0, elev);
  col = mix(col, cSand, beach * (1.0 - snow) * (1.0 - uAshen) * (1.0 - pCov));
  float tidal = uAshen * (1.0 - smoothstep(uTidal * 0.55, uTidal, elev + nMid * 10.0)) * (1.0 - smoothstep(0.04, 0.14, g)) * step(-1.0, elev) * (1.0 - forest * 0.85) * (1.0 - marsh);
  tidal = mix(tidal, pB.b, pCov);
  col = mix(col, cTidal * (0.9 + 0.2 * nFine) * (0.85 + 0.3 * smoothstep(-0.4, 0.6, nMid)), tidal);
  if (tidal > 0.5) id = 9.0;

  // streams and rivers from flow accumulation (+ explicit river ops)
  float area = uHasHydro > 0.5 ? smoothstep(uRiverMinLog, uRiverMinLog + 0.6, logA) : 0.0;
  // explicit channels: the mask is a soft ~1 px line at hydro resolution; keep only its core
  float river = max(area, smoothstep(0.45, 0.8, riverOp)) * (1.0 - smoothstep(0.35, 0.8, g));
  float bed = smoothstep(uRiverMinLog - 0.6, uRiverMinLog, logA) * (1.0 - smoothstep(0.1, 0.3, g)) * (1.0 - forest * 0.6);
  col = mix(col, cGravel * (0.85 + 0.2 * nFine), bed * 0.55 * (1.0 - snow));
  // gully darkening
  col *= 1.0 - clamp(lap * 2.5, 0.0, 0.25) * (1.0 - snow * 0.7);

  // Surface relief affects lighting, not geography, classification or picking.
  vec2 surfaceGrad = grad + dgrad;
  float canopyAO = 1.0;
  #ifdef SURFACE_DETAIL
  float canopyWeight = forest * (1.0 - rockAmt) * (1.0 - snow);
  if (fw < 0.0039 && uDetailOn > 0.0) {
    vec3 tufts = groundDetail(xz, 0.006);    // six-metre tussocks / mineral rubble
    vec3 soil = groundDetail(xz + 1.7, 0.0009); // decimetre soil / gravel
    vec3 grain = groundDetail(xz + 3.1, 0.00012); // fine grit
    float groundTone = tufts.x * 0.24 + soil.x * 0.18 + grain.x * 0.12;
    vec2 microGrad = tufts.yz * 0.045 + soil.yz * 0.035 + grain.yz * 0.035;
    surfaceGrad += microGrad * (1.0 - snow * 0.8) * (1.0 - canopyWeight * 0.85);
    col *= 1.0 + groundTone * (1.0 - canopyWeight * 0.85) * (1.0 - snow * 0.7);
    float bare = smoothstep(0.05, 0.32, tufts.x + soil.x * 0.4) * 0.35;
    bare *= (1.0 - canopyWeight) * (1.0 - rockAmt) * (1.0 - snow) * (1.0 - marsh) * (1.0 - uAshen);
    col = mix(col, srgb(vec3(0.38, 0.33, 0.25)), bare);
  }
  if (canopyWeight > 0.01 && fw < 0.02 && uDetailOn > 0.0) {
    float crownVis = uDetailOn * uSurfaceFade * (1.0 - smoothstep(0.004, 0.02, fw));
    vec4 crown = texture2DLodEXT(uCanopy, LUT_ROT * xz / ${CANOPY_TILE_KM.toFixed(3)}, log2(max(fw * ${(512 / CANOPY_TILE_KM).toFixed(3)}, 1.0)));
    vec2 crownGrad = ((crown.rg - 0.5) * 8.0) * LUT_ROT;
    surfaceGrad += crownGrad * crownVis * canopyWeight * 0.35;
    col *= mix(1.0, 0.88 + 0.24 * crown.a, crownVis * canopyWeight);
    canopyAO = mix(1.0, mix(0.7, 1.0, smoothstep(0.08, 0.6, crown.b)), canopyWeight * crownVis);
  }
  #endif
  n = normalize(vec3(-surfaceGrad.x * uExag, 1.0, -surfaceGrad.y * uExag));

  // ---- lighting
  float shadow = texture2D(uShadowTex, uv).r * landmarkShadow(vWorld);
  float ao = texture2D(uAOTex, uv).r * canopyAO;
  float ndl = max(dot(n, uSunDir), 0.0);
  shadow = mix(shadow, 1.0, outside * 0.7);
  vec3 skyAmb = mix(srgb(vec3(0.3, 0.29, 0.24)), uSkyZenith * 1.15, n.y * 0.5 + 0.5);
  vec3 light = uSunColor * ndl * shadow * 3.1 + skyAmb * (0.2 + 0.8 * ao) * 0.62;
  vec3 c = col * light;
  // snow and wet surfaces: a bit of specular
  vec3 Hh = normalize(uSunDir + V);
  c += uSunColor * pow(max(dot(n, Hh), 0.0), 40.0) * 0.15 * snow * shadow;

  // ---- water: sea and lakes (depth-tinted), rivers (shader-painted channels)
  bool isWater = depth > 0.0;
  if (isWater || river > 0.01) {
    float d = isWater ? depth : 4.0;
    vec3 shallow = isWater ? srgb(vec3(0.2, 0.52, 0.52)) : srgb(vec3(0.24, 0.38, 0.4));
    vec3 deep = srgb(mix(vec3(0.03, 0.13, 0.27), vec3(0.015, 0.022, 0.04), uAshen));
    shallow = mix(shallow, srgb(vec3(0.07, 0.08, 0.10)), uAshen);
    vec3 wcol = mix(shallow, deep, 1.0 - exp(-d / 25.0));
    vec2 ripple = noiseGradAt(xz, 0.08) * 0.008;
    vec3 wn = normalize(vec3(ripple.x, 1.0, ripple.y));
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(wn, V), 0.0), 5.0);
    vec3 refl = skyColor(reflect(-V, wn));
    vec3 wc = wcol * (uSunColor * max(dot(wn, uSunDir), 0.0) * shadow * 1.4 + skyAmb * 0.7);
    wc = mix(wc, refl, fres * 0.85);
    wc += uSunColor * pow(max(dot(reflect(-uSunDir, wn), V), 0.0), 200.0) * 3.0 * shadow;
    // shoreline: shallow water shows the bed, plus a faint foam line on the sea
    float shore = isWater ? 1.0 - smoothstep(0.0, 3.0, depth) : 0.0;
    wc = mix(wc, c * 0.8 + wcol * 0.3, shore * 0.6);
    float foam = isWater && wl <= uSea + 0.5 ? (1.0 - smoothstep(0.0, 1.2, depth)) * (0.6 + 0.4 * nFine) : 0.0;
    wc = mix(wc, vec3(0.85), foam * 0.35);
    float wa = isWater ? smoothstep(0.0, 0.4, depth) : river;
    c = mix(c, wc, wa);
    if (wa > 0.5) id = 8.0;
  }

  // ---- debug views
  if (uDebug == 1) c = srgb(vec3(clamp(h / uMaxElev, 0.0, 1.0)));
  else if (uDebug == 2) c = srgb(vec3(clamp(g, 0.0, 1.5) / 1.5));
  else if (uDebug == 3) c = srgb(mix(vec3(0.05), vec3(0.2, 0.6, 1.0), clamp((logA + 1.0) / 4.0, 0.0, 1.0)));
  else if (uDebug == 4) c = srgb(mix(vec3(0.7, 0.45, 0.2), vec3(0.1, 0.4, 0.9), moist));
  else if (uDebug == 5) c = srgb(matColor(id)) * (0.5 + 0.5 * ndl);
  else if (uDebug == 6) c = srgb(vec3(shadow * (0.3 + 0.7 * ao)));
  else if (uDebug == 7) c = srgb(vec3(clamp(dep / 30.0, 0.0, 1.0), clamp(-lap * 3.0, 0.0, 1.0), clamp(lap * 3.0, 0.0, 1.0)));

  if (uDebug == 0) c = applyAtmosphere(c, vWorld, cameraPosition);
  // outside the map: desaturate and fade into haze so the region doesn't read as a slab
  if (vOut > 0.0) {
    float lum = dot(c, vec3(0.3, 0.55, 0.15));
    c = mix(c, vec3(lum), outside * 0.6);
    // fade fully into the sky colour seen along this ray before the surround ends
    vec3 vd = normalize(vWorld - cameraPosition);
    vec3 skyC = skyColor(normalize(vec3(vd.x, max(vd.y, 0.0), vd.z)));
    c = mix(c, skyC, max(outside * 0.45, smoothstep(uSurroundKm * 0.45, uSurroundKm * 0.92, vOut)));
  }
  // map border
  float fwo = max(fwidth(vOut), 1e-5);
  if (uHexOn > 0.5) c = mix(c, srgb(vec3(0.12, 0.1, 0.08)), (1.0 - smoothstep(fwo * 0.8, fwo * 2.2, abs(vOut))) * 0.65);

  // ---- hex overlay (after haze so it stays legible; fades gently with distance)
  if (uHexOn > 0.5) {
    vec3 hx = hexAt(xz);
    bool inGrid = hx.x >= 1.0 && hx.y >= 1.0 && hx.x <= uHexGrid.x && hx.y <= uHexGrid.y;
    float ed = -hx.z;
    float fwd = max(fwidth(hx.z), 1e-6);
    float line = 1.0 - smoothstep(0.7 * fwd, 1.7 * fwd, ed);
    float fade = mix(1.0, 0.55, smoothstep(50.0, 300.0, dist));
    if (inGrid) {
      c = mix(c, srgb(vec3(0.06, 0.06, 0.05)), line * uHexOpacity * fade);
      if (abs(hx.x - uHexHover.x) < 0.5 && abs(hx.y - uHexHover.y) < 0.5) c = mix(c, srgb(vec3(1.0, 0.95, 0.75)), 0.12 + line * 0.5);
      if (abs(hx.x - uHexSel.x) < 0.5 && abs(hx.y - uHexSel.y) < 0.5) c = mix(c, srgb(vec3(1.0, 0.8, 0.3)), line * 0.9);
    }
  }
  if (uBrush.w > 0.5) {
    float bd = length(xz - uBrush.xy);
    float ring = 1.0 - smoothstep(fw * 1.0, fw * 2.6, abs(bd - uBrush.z));
    float inner = (1.0 - smoothstep(fw * 0.8, fw * 2.0, abs(bd - uBrushCore))) * 0.55;
    vec3 bc = srgb(vec3(1.0, 0.88, 0.55));
    c = mix(c, bc, (1.0 - smoothstep(uBrushCore, uBrush.z, bd)) * 0.07);
    c = mix(c, bc, max(ring, inner) * 0.9);
  }
  gl_FragColor = vec4(toDisplay(c), 1.0);
}`;
