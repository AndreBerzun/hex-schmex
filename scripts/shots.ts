// Headless screenshots of the camera presets (BRIEF §11).
// Usage: npm run shots -- [world | maps/<name>.json ...] [--eres 512] [--iters 160] [--size 1280x720] [--views a,b]
// A bare name is an example in worlds/; a maps/ path renders that map file (via the dev server's map link).
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const eres = opt('eres', '768');
const iters = opt('iters', '220');
const [W, H] = opt('size', '1280x720').split('x').map(Number);
const viewsArg = opt('views', '');
const extra = opt('params', '');
const worlds = args.length ? args : readdirSync('worlds').filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    // fall back to a globally installed playwright (the cloud dev image ships one)
    const req = createRequire(import.meta.url);
    for (const p of ['/opt/node22/lib/node_modules/playwright', '/usr/local/lib/node_modules/playwright', '/usr/lib/node_modules/playwright']) {
      try { return req(p); } catch { /* next */ }
    }
    throw new Error('playwright not found: npm i -D playwright');
  }
}

const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5199/';
const pw = await loadPlaywright();
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
mkdirSync('shots', { recursive: true });
const log: string[] = [];
try {
  for (const arg of worlds) {
    const isMap = arg.endsWith('.json') || arg.includes('/');
    const world = isMap ? basename(arg, '.json') : arg;
    const src = isMap ? `file=${encodeURIComponent(world)}` : `world=${world}`;
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    page.on('console', (m: { type(): string; text(): string }) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${world}] ${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e: Error) => console.log(`[${world}] pageerror: ${e.message}`));
    const t0 = Date.now();
    await page.goto(`${url}?shot=1&${src}&eres=${eres}&iters=${iters}${extra ? '&' + extra : ''}`);
    await page.waitForFunction(() => !!(window as unknown as { __tp?: unknown }).__tp, null, { timeout: 60000 });
    await page.evaluate(() => (window as unknown as { __tp: { finish(): Promise<void> } }).__tp.finish());
    const timings = await page.evaluate(() => (window as unknown as { __tp: { timings(): unknown } }).__tp.timings());
    const bakeS = ((Date.now() - t0) / 1000).toFixed(1);
    const names: string[] = viewsArg ? viewsArg.split(',') : await page.evaluate(() => (window as unknown as { __tp: { viewNames: string[] } }).__tp.viewNames);
    for (const name of names) {
      const ok = await page.evaluate((n: string) => (window as unknown as { __tp: { setView(n: string): boolean; renderFrames(n: number): void } }).__tp.setView(n), name);
      if (!ok) { console.log(`[${world}] no view ${name}`); continue; }
      await page.evaluate(() => (window as unknown as { __tp: { renderFrames(n: number): void } }).__tp.renderFrames(3));
      const data: string = await page.evaluate(() => (document.getElementById('view') as HTMLCanvasElement).toDataURL('image/png'));
      const file = join('shots', `${world}--${name}.png`);
      writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
      console.log(`wrote ${file}`);
    }
    log.push(`${world}: bake ${bakeS}s (eres ${eres}, ${iters} iterations, SwiftShader) timings ${JSON.stringify(timings)}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(log.join('\n'));
