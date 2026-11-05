// Bundled example worlds (also available in the single-file build).
import { loadWorld } from './core/world';
import type { World } from './core/types';

const files = import.meta.glob('../worlds/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export const EXAMPLES: Record<string, unknown> = Object.fromEntries(
  Object.entries(files).map(([path, json]) => [path.split('/').pop()!.replace(/\.json$/, ''), json]),
);

export function exampleWorld(name: string): World | null {
  const raw = EXAMPLES[name];
  return raw ? loadWorld(JSON.parse(JSON.stringify(raw))) : null;
}
