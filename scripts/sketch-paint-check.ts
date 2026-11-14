import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { BrowserPage } from './browser';

const out = process.argv[2];
const name = process.argv[3] ?? 'selftest-paint';
const scratch = name === 'selftest-paint';
if (!out) throw new Error('usage: npm run check:sketch-paint -- <dir> [sketch]');
mkdirSync(out, { recursive: true });
const files = ['json', 'bin', 'paint.bin'].map((ext) => `sketches/${name}.${ext}`);
if (scratch) files.forEach((f) => rmSync(f, { force: true }));

const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const page = await BrowserPage.launch({ width: 1500, height: 850 });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shot = async (n: string) => { await wait(600); const s = await page.send('Page.captureScreenshot', { format: 'png' }) as { data: string }; writeFileSync(`${out}/${n}.png`, Buffer.from(s.data, 'base64')); };
const mouse = (type: string, x: number, y: number, buttons = 0) => page.send('Input.dispatchMouseEvent', { type, x, y, button: buttons ? 'left' : 'none', buttons, clickCount: 1 });
const click = async (x: number, y: number) => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, 1); await mouse('mouseReleased', x, y, 1); };
const clickOn = async (selector: string) => {
  const [x, y] = await page.evaluate<[number, number]>(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await click(x, y);
};
const drag = async (from: [number, number], to: [number, number]) => {
  await mouse('mouseMoved', from[0], from[1]);
  await mouse('mousePressed', from[0], from[1], 1);
  for (let n = 1; n <= 12; n++) await mouse('mouseMoved', from[0] + ((to[0] - from[0]) * n) / 12, from[1] + ((to[1] - from[1]) * n) / 12, 1);
  await mouse('mouseReleased', to[0], to[1], 1);
};
const painted = () => page.evaluate<Record<string, number>>('window.__sketch.painted()');
const expect = (ok: boolean, what: string) => { if (!ok) throw new Error(`FAILED: ${what}`); console.log(`ok: ${what}`); };
const open = async () => {
  await page.navigate(`${server.resolvedUrls?.local[0]}sketch.html?name=${name}`);
  await page.waitFor('window.__sketch && window.__sketch.ready', 60000);
};

try {
  await open();
  const swatches = await page.evaluate<string[]>('[...document.querySelectorAll("#palette .swatch")].map((b) => b.dataset.swatch)');
  expect(swatches.length === 19 && swatches.includes('coral-turf') && swatches.at(-1) === 'clay', `palette lists 18 textures and clay (${swatches.length})`);
  await shot('1-palette');

  await clickOn('[data-swatch="coral-turf"]');
  expect(await page.evaluate<boolean>('document.querySelector(".tools .on").textContent.includes("Colour")'), 'picking a swatch switches to the colour brush');
  await drag([620, 430], [820, 470]);
  const afterBrush = await painted();
  expect(afterBrush['coral-turf'] > 0, `brush coloured coral turf (${(afterBrush['coral-turf'] * 100).toFixed(2)} % of the map)`);

  await clickOn('[data-swatch="ash-dust"]');
  await drag([560, 520], [900, 540]);
  await clickOn('[data-swatch="clay"]');
  await drag([700, 400], [700, 560]);
  const afterErase = await painted();
  expect(afterErase['coral-turf'] < afterBrush['coral-turf'], 'clay removes colour again');
  await shot('2-brushed');

  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '8', code: 'Digit8', windowsVirtualKeyCode: 56 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '8', code: 'Digit8', windowsVirtualKeyCode: 56 });
  await clickOn('[data-swatch="downs-grass"]');
  await click(1000, 620);
  const afterFill = await painted();
  expect(afterFill['downs-grass'] > 0.05 && afterFill['coral-turf'] === afterErase['coral-turf'], `fill coloured the open ground and stopped at painted ground (${(afterFill['downs-grass'] * 100).toFixed(1)} %)`);
  await shot('3-filled');

  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  const afterUndo = await painted();
  expect(!afterUndo['downs-grass'] && afterUndo['ash-dust'] === afterErase['ash-dust'], 'undo takes back the fill and nothing else');

  await wait(1200);
  expect(existsSync(files[2]) && readFileSync(files[2]).some((v) => v > 0), 'colours are saved next to the sketch');
  await open();
  const reopened = await painted();
  expect(JSON.stringify(reopened) === JSON.stringify(afterUndo), 'a reopened sketch shows the same colours');
  await shot('4-reopened');
} finally {
  await page.close();
  await server.close();
  if (scratch) files.forEach((f) => rmSync(f, { force: true }));
}
