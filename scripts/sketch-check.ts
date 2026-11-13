import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { BrowserPage } from './browser';
const out = process.argv[2];
const server = await createServer({ server: { port: 5198, strictPort: false }, logLevel: 'error' });
await server.listen();
const page = await BrowserPage.launch({ width: 1400, height: 820 });
const shot = async (n: string) => { await new Promise((r) => setTimeout(r, 500)); const s = await page.send('Page.captureScreenshot', { format: 'png' }) as { data: string }; writeFileSync(`${out}/${n}.png`, Buffer.from(s.data, 'base64')); };
const mouse = (type: string, x: number, y: number, buttons = 0) => page.send('Input.dispatchMouseEvent', { type, x, y, button: buttons ? 'left' : 'none', buttons, clickCount: 1 });
try {
  await page.navigate(`${server.resolvedUrls?.local[0]}sketch.html?name=selftest`);
  await page.waitFor('window.__sketch && window.__sketch.ready', 60000);
  await shot('1-overview');
  await mouse('mouseMoved', 700, 430);
  await mouse('mousePressed', 700, 430, 1);
  await mouse('mouseMoved', 705, 432, 1);
  await new Promise((r) => setTimeout(r, 1500));
  await mouse('mouseReleased', 705, 432, 1);
  await shot('2-raised');
  await page.evaluate('window.__sketch.stand([46, 58])');
  await shot('3-stand');
  await new Promise((r) => setTimeout(r, 1200));
} finally { await page.close(); await server.close(); }
