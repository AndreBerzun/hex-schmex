import * as THREE from 'three';
import coralSandUrl from './textures/coral-sand.jpg';
import coralTurfUrl from './textures/coral-turf.jpg';
import coralRockUrl from './textures/coral-rock.jpg';

export const TEXTURE_ANCHOR_KM = 1;

export interface GroundTextures {
  uniforms: Record<string, THREE.IUniform>;
  ready: Promise<void>;
  setAnisotropy(level: number): void;
  follow(camera: THREE.Vector3): void;
}

export function loadGroundTextures(): GroundTextures {
  const loader = new THREE.TextureLoader();
  const textures: THREE.Texture[] = [];
  const loads: Promise<void>[] = [];
  const paint = (url: string) => {
    const texture = new THREE.Texture();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    textures.push(texture);
    loads.push(new Promise((resolve, reject) => loader.load(url, (loaded) => {
      texture.image = loaded.image;
      texture.needsUpdate = true;
      resolve();
    }, undefined, reject)));
    return texture;
  };
  const origin = new THREE.Vector2();
  const uniforms = {
    uCoralSand: { value: paint(coralSandUrl) },
    uCoralTurf: { value: paint(coralTurfUrl) },
    uCoralRock: { value: paint(coralRockUrl) },
    uTexOrigin: { value: origin },
  };
  return {
    uniforms,
    ready: Promise.all(loads).then(() => undefined),
    setAnisotropy(level: number) {
      for (const t of textures) { t.anisotropy = level; t.needsUpdate = true; }
    },
    follow(camera: THREE.Vector3) {
      origin.set(Math.floor(camera.x / TEXTURE_ANCHOR_KM) * TEXTURE_ANCHOR_KM, Math.floor(camera.z / TEXTURE_ANCHOR_KM) * TEXTURE_ANCHOR_KM);
    },
  };
}
