// Apply a prompt to a world file headlessly (BRIEF §5):
//   npm run prompt -- worlds/foo.json "add a volcanic peak in 1208" [--out other.json] [--model claude-opus-5-5]
//                     [--effort low|medium|high] [--mock] [--no-image] [--dry-run] [--image-out map.png]
// Uses ANTHROPIC_API_KEY. The terrain the model sees is the CPU op stack (no GPU erosion in Node).
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { evaluate } from '../src/core/ops';
import { encodeRGB8 } from '../src/core/png';
import { loadWorld, serializeWorld } from '../src/core/world';
import { AnthropicProvider, DEFAULT_MODEL, type Effort } from '../src/llm/anthropicProvider';
import { renderMapImage } from '../src/llm/mapImage';
import { MockProvider } from '../src/llm/mockProvider';
import { fieldProbe } from '../src/llm/probe';
import { runPrompt } from '../src/llm/prompter';
import type { LLMProvider } from '../src/llm/provider';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (name: string) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const out = flag('--out');
const model = flag('--model') ?? DEFAULT_MODEL;
const effort = (flag('--effort') ?? 'medium') as Effort;
const imageOut = flag('--image-out');
const mock = bool('--mock'), noImage = bool('--no-image'), dryRun = bool('--dry-run');
const [file, ...rest] = args;
const prompt = rest.join(' ').trim();
if (!file || !prompt) {
  console.error('usage: npm run prompt -- <world.json> "<prompt>" [--out file] [--model id] [--effort low|medium|high] [--mock] [--no-image] [--dry-run]');
  process.exit(2);
}

let provider: LLMProvider;
if (mock) provider = new MockProvider();
else {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { console.error('ANTHROPIC_API_KEY is not set (or use --mock)'); process.exit(2); }
  provider = new AnthropicProvider({ apiKey: key, model, effort });
}

const world = loadWorld(JSON.parse(readFileSync(file, 'utf8')));
const t0 = performance.now();
const hf = evaluate(world, { res: 384 });
const probe = fieldProbe(world, hf);
let image: string | undefined;
if (!noImage) {
  const r = renderMapImage(world, probe, 800);
  const png = await encodeRGB8(r.width, r.height, r.rgba, async (d) => deflateSync(d));
  if (imageOut) writeFileSync(imageOut, png);
  image = Buffer.from(png).toString('base64');
}
console.error(`context ready in ${((performance.now() - t0) / 1000).toFixed(1)} s; asking ${mock ? 'mock' : model}…`);
const res = await runPrompt({ world, prompt, provider, probe, imagePngBase64: image, onProgress: (m) => console.error(`  ${m}`) });
for (const l of res.log) console.error(`${l.ok ? '✓' : '✗'} ${l.name} ${l.result.split('\n')[0].slice(0, 160)}`);
if (res.warning) console.error(`warning: ${res.warning}`);
console.log(res.explanation);
console.error(`tokens: in ${res.usage.input} (cache read ${res.usage.cacheRead}, write ${res.usage.cacheWrite}), out ${res.usage.output}${res.model ? `, model ${res.model}` : ''}`);
if (res.changed && !dryRun) {
  writeFileSync(out ?? file, serializeWorld(res.world) + '\n');
  console.error(`wrote ${out ?? file} (${res.changedOps.length} ops changed, ${res.removedOps.length} removed)`);
} else if (!res.changed) console.error('no changes');
