// Shared GLSL chunks for the renderer.

export const ATMOS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform float uHazeDensity;  // extinction per km at sea level
uniform float uHazeScaleH;   // scale height, km
uniform float uExag;

vec3 skyColor(vec3 dir) {
  float y = clamp(dir.y, 0.0, 1.0);
  vec3 c = mix(uSkyHorizon, uSkyZenith, pow(y, 0.5));
  float sd = max(dot(dir, uSunDir), 0.0);
  c += uSunColor * (pow(sd, 5.0) * 0.12 + pow(sd, 48.0) * 0.3);
  if (dir.y < 0.0) c = mix(uSkyHorizon, uSkyHorizon * vec3(0.9, 0.93, 0.97), clamp(-dir.y * 4.0, 0.0, 1.0));
  return c;
}

// Analytic aerial perspective: exponential-height haze integrated along the view ray.
vec3 applyAtmosphere(vec3 col, vec3 worldPos, vec3 camPos) {
  vec3 v = worldPos - camPos;
  float dist = length(v);
  vec3 dir = v / max(dist, 1e-6);
  float h0 = camPos.y / uExag, h1 = worldPos.y / uExag;
  float Hs = uHazeScaleH;
  float dh = h1 - h0;
  float e0 = exp(-max(h0, -1.0) / Hs), e1 = exp(-max(h1, -1.0) / Hs);
  // path length uses true (un-exaggerated) geometry so exaggeration doesn't thicken the haze
  float dTrue = length(vec3(v.x, v.y / uExag, v.z));
  float od = abs(dh) > 1e-3 ? uHazeDensity * dTrue * (e0 - e1) / (dh / Hs) : uHazeDensity * dTrue * e0;
  vec3 T = exp(-od * vec3(0.62, 0.8, 1.0));
  vec3 scat = skyColor(normalize(vec3(dir.x, max(dir.y, 0.015), dir.z)));
  float sd = max(dot(dir, uSunDir), 0.0);
  scat += uSunColor * pow(sd, 8.0) * 0.2;
  return col * T + scat * (1.0 - T);
}

vec3 acesTonemap(vec3 x) {
  x *= 0.9;
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 toDisplay(vec3 c) { return pow(acesTonemap(c), vec3(1.0 / 2.2)); }
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
`;

