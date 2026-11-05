// Headless screenshots of the camera presets (BRIEF §11).
// Usage: npm run shots -- [world | maps/<name>.json ...] [--eres 512] [--iters 160] [--size 1280x720] [--views a,b] [--software]
// A bare name is an example in worlds/; a maps/ path renders that map file (via the dev server's map link).
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createServer } from 'vite';
import { BrowserPage } from './browser';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const eres = opt('eres', '');
const iters = opt('iters', '');
const [W, H] = opt('size', '1280x720').split('x').map(Number);
const viewsArg = opt('views', '');
const extra = opt('params', '');
const software = flag('software');
const worlds = args.length ? args : readdirSync('worlds').filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));

const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5199/';
const page = await BrowserPage.launch({ width: W, height: H, software });
mkdirSync('shots', { recursive: true });
const log: string[] = [];
try {
  for (const arg of worlds) {
    const isMap = arg.endsWith('.json') || arg.includes('/');
    const world = isMap ? basename(arg, '.json') : arg;
    const src = isMap ? `file=${encodeURIComponent(world)}` : `world=${world}`;
    const t0 = Date.now();
    const query = [`shot=1`, src, eres && `eres=${eres}`, iters && `iters=${iters}`, extra].filter(Boolean).join('&');
    await page.navigate(`${url}?${query}`);
    await page.waitFor('window.__tp');
    await page.evaluate('window.__tp.finish()');
    const timings = await page.evaluate<unknown>('window.__tp.timings()');
    const bakeS = ((Date.now() - t0) / 1000).toFixed(1);
    const names = viewsArg ? viewsArg.split(',') : await page.evaluate<string[]>('window.__tp.viewNames');
    for (const name of names) {
      const ok = await page.evaluate<boolean>(`window.__tp.setView(${JSON.stringify(name)})`);
      if (!ok) { console.log(`[${world}] no view ${name}`); continue; }
      await page.evaluate('window.__tp.renderFrames(3)');
      const data = await page.evaluate<string>("document.getElementById('view').toDataURL('image/png')");
      const file = join('shots', `${world}--${name}.png`);
      writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
      console.log(`wrote ${file}`);
    }
    log.push(`${world}: bake ${bakeS}s (${eres ? `eres ${eres}` : 'world resolution'}, ${software ? 'SwiftShader' : 'GPU'}) timings ${JSON.stringify(timings)}`);
  }
} finally {
  await page.close();
  await server.close();
}
console.log(log.join('\n'));
