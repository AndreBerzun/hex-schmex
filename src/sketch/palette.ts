import { medianColour, type Rgb } from './paint';

export interface Swatch { key: string; biome: string; label: string; url: string; rgb: Rgb }

const urls = import.meta.glob('../render/textures/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const BIOMES: [string, string][] = [
  ['ash', 'Sea of Ash'],
  ['mire', 'Silt Mires'],
  ['downs', 'Black earth'],
  ['coral', 'Crimson coral labyrinth'],
  ['tidal', 'Tidal flats and channels'],
  ['mountain', 'Hollow Mountains'],
];

export function swatchName(path: string): { key: string; biome: string; label: string; rank: number } {
  const key = path.replace(/^.*\//, '').replace(/\.jpg$/, '');
  const prefix = key.split('-')[0];
  const rank = BIOMES.findIndex(([p]) => p === prefix);
  return { key, biome: rank < 0 ? prefix : BIOMES[rank][1], label: key.slice(prefix.length + 1) || key, rank: rank < 0 ? BIOMES.length : rank };
}

async function median(url: string): Promise<Rgb> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  return medianColour(g.getImageData(0, 0, canvas.width, canvas.height).data);
}

export async function loadSwatches(): Promise<Swatch[]> {
  const named = Object.entries(urls).map(([path, url]) => ({ ...swatchName(path), url }));
  named.sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
  return Promise.all(named.map(async ({ key, biome, label, url }) => ({ key, biome, label, url, rgb: await median(url) })));
}
