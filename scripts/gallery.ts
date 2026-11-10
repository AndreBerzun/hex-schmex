import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { BrowserPage } from './browser';

const out = process.env.GALLERY_OUT ?? 'shots/_tmp/gallery';
const sets = (process.argv[2] ?? 'near:0,mid:0,far:0').split(',');
const server = await createServer({ server: { port: 5197, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5197/';
const page = await BrowserPage.launch({ width: 1600, height: 700 });
mkdirSync(out, { recursive: true });
try {
  for (const set of sets) {
    const [tier, lod, variants = '1', kinds = ''] = set.split(':');
    await page.navigate(`${url}gallery.html?tier=${tier}&lod=${lod}&variants=${variants}${kinds ? `&kinds=${kinds.replace(/\+/g, ',')}` : ''}`);
    await page.waitFor('window.__ready === true', 60000);
    const data = await page.evaluate<string>("document.getElementById('view').toDataURL('image/png')");
    const file = `${out}/${tier}-lod${lod}${kinds ? '-' + kinds.replace(/\+/g, '_') : ''}.png`;
    writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
    console.log(`wrote ${file}`, JSON.stringify(await page.evaluate('window.__stats')));
  }
} finally {
  await page.close();
  await server.close();
}
