import { createServer } from 'vite';
import { BrowserPage } from './browser';

const views = (process.argv[2] ?? '').split(',').filter(Boolean);
const server = await createServer({ server: { port: 5196, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5196/';
const page = await BrowserPage.launch({ width: 1280, height: 720 });
try {
  await page.navigate(`${url}?shot=1&world=forgotten-shore`);
  await page.waitFor('window.__tp');
  await page.evaluate('window.__tp.finish()');
  const names = views.length ? views : await page.evaluate<string[]>('window.__tp.viewNames');
  for (const name of names) {
    await page.evaluate(`window.__tp.setView(${JSON.stringify(name)})`);
    await page.evaluate('window.__tp.renderFrames(3)');
    const r = await page.evaluate<{ spot: Record<string, unknown>; stats: Record<string, number>; kinds: Record<string, number> }>('window.__tp.app.sceneryReport()');
    const sp = r.spot ?? {};
    const f = (v: unknown) => (typeof v === 'number' ? Number(v.toFixed(2)) : v);
    console.log(`${name}: zone ${sp.zone} (${sp.mat}) core ${f(sp.core)} h ${f(sp.h)} slope ${f(sp.slope)} depth ${f(sp.depth)} | ${r.stats.instances} inst, ${(r.stats.triangles / 1000).toFixed(0)}k tri, ${r.stats.batches} batches, ${r.stats.updateMs.toFixed(0)} ms`);
    console.log('   ', Object.entries(r.kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', '));
  }
} finally {
  await page.close();
  await server.close();
}
