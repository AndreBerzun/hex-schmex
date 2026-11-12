import * as THREE from 'three';
import coralSandUrl from './textures/coral-sand.jpg';
import coralTurfUrl from './textures/coral-turf.jpg';
import coralRockUrl from './textures/coral-rock.jpg';
import downsGrassUrl from './textures/downs-grass.jpg';
import downsEarthUrl from './textures/downs-earth.jpg';
import downsRockUrl from './textures/downs-rock.jpg';
import mountainRockUrl from './textures/mountain-rock.jpg';
import mountainScreeUrl from './textures/mountain-scree.jpg';
import mountainSnowUrl from './textures/mountain-snow.jpg';

export const TEXTURE_ANCHOR_KM = 1;
const SIZE = 1024;

const LAYERS = [
  ['CORAL_SAND', coralSandUrl],
  ['CORAL_TURF', coralTurfUrl],
  ['CORAL_ROCK', coralRockUrl],
  ['DOWNS_GRASS', downsGrassUrl],
  ['DOWNS_EARTH', downsEarthUrl],
  ['DOWNS_ROCK', downsRockUrl],
  ['MOUNTAIN_ROCK', mountainRockUrl],
  ['MOUNTAIN_SCREE', mountainScreeUrl],
  ['MOUNTAIN_SNOW', mountainSnowUrl],
] as const;

export const GROUND_GLSL = /* glsl */ `
uniform highp sampler2DArray uGround;
${LAYERS.map(([name], i) => `const float L_${name} = ${i.toFixed(1)};`).join('\n')}
vec3 groundTex(float layer, vec2 uv) { return texture(uGround, vec3(uv, layer)).rgb; }
vec3 groundTexLod(float layer, vec2 uv, float lod) { return textureLod(uGround, vec3(uv, layer), lod).rgb; }
`;

export interface GroundTextures {
  uniforms: Record<string, THREE.IUniform>;
  ready: Promise<void>;
  setAnisotropy(level: number): void;
  follow(camera: THREE.Vector3): void;
}

async function decode(url: string): Promise<Uint8ClampedArray> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, SIZE, SIZE);
  return g.getImageData(0, 0, SIZE, SIZE).data;
}

export function loadGroundTextures(): GroundTextures {
  const data = new Uint8Array(SIZE * SIZE * 4 * LAYERS.length);
  const texture = new THREE.DataArrayTexture(data, SIZE, SIZE, LAYERS.length);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  const ready = Promise.all(LAYERS.map(async ([, url], i) => data.set(await decode(url), i * SIZE * SIZE * 4)))
    .then(() => { texture.needsUpdate = true; });
  const origin = new THREE.Vector2();
  return {
    uniforms: { uGround: { value: texture }, uTexOrigin: { value: origin } },
    ready,
    setAnisotropy(level: number) { texture.anisotropy = level; texture.needsUpdate = true; },
    follow(camera: THREE.Vector3) {
      origin.set(Math.floor(camera.x / TEXTURE_ANCHOR_KM) * TEXTURE_ANCHOR_KM, Math.floor(camera.z / TEXTURE_ANCHOR_KM) * TEXTURE_ANCHOR_KM);
    },
  };
}
