import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { BrowserPage } from './browser';

const [query = '', js = '', out = 'shots/_tmp/ui.png'] = process.argv.slice(2);
const server = await createServer({ server: { port: 5197, strictPort: false }, logLevel: 'error' });
await server.listen();
const page = await BrowserPage.launch({ width: 1500, height: 860 });
try {
  await page.navigate(`${server.resolvedUrls?.local[0]}?${query}`);
  await page.waitFor('window.__tp');
  await page.evaluate('window.__tp.finish()');
  if (js) await page.evaluate(js);
  await page.evaluate('window.__tp.renderFrames(2)');
  const shot = await page.send('Page.captureScreenshot', { format: 'png' }) as { data: string };
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`wrote ${out}`);
} finally {
  await page.close();
  await server.close();
}
