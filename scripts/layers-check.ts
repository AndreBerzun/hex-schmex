import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { ToolExecutor } from '../src/agent/tools';
import { loadWorld, serializeWorld } from '../src/core/world';
import { BrowserPage } from './browser';

const software = process.argv.includes('--software');
const keep = process.argv.includes('--keep');
const NAME = 'zz-layers-check';
const MAP = `maps/${NAME}.json`;
const BAKE = `maps/.bake/${NAME}.bin`;

const w = loadWorld(JSON.parse(readFileSync('worlds/alpine-valley.json', 'utf8')));
w.terrain.erodedRes = 512;
w.erosion.iterations = 48;
w.meta.preview = { ...(w.meta.preview ?? {}), initialView: undefined };
writeFileSync(MAP, serializeWorld(w));
rmSync(BAKE, { force: true });

const server = await createServer({ server: { port: 5192, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5192/';
const page = await BrowserPage.launch({ width: 1280, height: 800, software });

let failed = 0;
const check = (name: string, ok: boolean, detail: unknown) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  ${JSON.stringify(detail)}`);
  if (!ok) failed++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const load = async () => {
  await page.navigate(`${url}?editor&file=${NAME}&nohex`);
  await page.waitFor('window.__tp');
  await page.evaluate(`(() => {
    const a = window.__tp.app; const orig = a.onStage; window.__stages = [];
    a.onStage = (s, i) => { if (window.__stages[window.__stages.length - 1] !== s) window.__stages.push(s); orig(s, i); };
    return 1;
  })()`);
};
const ready = () => page.waitFor("window.__tp.app.stage === 'ready' || window.__tp.app.stage === 'error'");
const stagesSince = async () => page.evaluate<string[]>('(() => { const s = window.__stages; window.__stages = []; return s; })()');
const heightAtHex = (id: string) => page.evaluate<number>(`(() => {
  const a = window.__tp.app; const c = a.grid; const col = Number('${id}'.slice(0, 2)), row = Number('${id}'.slice(2));
  const hexes = window.__tp.app.hexStats(col, row); return Math.round(hexes.meanM);
})()`);
const dominant = (id: string) => page.evaluate<string>(`window.__tp.app.hexStats(Number('${id}'.slice(0, 2)), Number('${id}'.slice(2))).dominant`);
const screenOf = (id: string) => page.evaluate<[number, number]>(`(() => {
  const a = window.__tp.app; const col = Number('${id}'.slice(0, 2)), row = Number('${id}'.slice(2));
  const ox = a.grid.origin[0], oz = a.grid.origin[1];
  const s = a.hexStats(col, row);
  const p = a.camera.position.clone();
  const cx = ox + (col - 1) * a.grid.size * 1.5, cz = oz + (row - 1) * a.grid.flat + (col % 2 === 0 ? a.grid.flat / 2 : 0);
  p.set(cx, a.heightAt(cx, cz) * 0.001 * a.settings.exag, cz).project(a.camera);
  const r = a.renderer.domElement.getBoundingClientRect();
  return [r.left + (p.x + 1) / 2 * r.width, r.top + (1 - p.y) / 2 * r.height];
})()`);
const mouse = (type: string, x: number, y: number, buttons = 1) => page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
const shot = async (file: string) => {
  const r = await page.send('Page.captureScreenshot', { format: 'png' }) as { data: string };
  mkdirSync('shots/_tmp', { recursive: true });
  writeFileSync(`shots/_tmp/${file}`, Buffer.from(r.data, 'base64'));
};

try {
  await load();
  await ready();
  const first = await page.evaluate<{ iter: number; cached: boolean; stage: string }>('({ iter: window.__tp.app.erosion?.iteration ?? -1, cached: !!window.__tp.app.timings.cachedFoundation, stage: window.__tp.app.stage })');
  check('first open erodes the map', first.stage === 'ready' && first.iter === 48 && !first.cached, first);
  for (let i = 0; i < 50 && !existsSync(BAKE); i++) await sleep(200);
  check('the finished bake is written next to the map file', existsSync(BAKE), BAKE);
  await stagesSince();

  const before = await heightAtHex('0505');
  const t0 = Date.now();
  await page.evaluate(`(window.__tp.store.commit('raise 0505', (w) => {
    w.sculpt.push({ id: 'chk-raise', label: 'raise 0505', source: 'prompt', tool: 'raise',
      area: { kind: 'region', region: { kind: 'circle', center: [${'window.__tp.app.grid.origin[0] + 4 * window.__tp.app.grid.size * 1.5'}, ${'window.__tp.app.grid.origin[1] + 4 * window.__tp.app.grid.flat'}], radius: 6 } },
      falloffKm: 1, strength: 1, amountM: 400 });
  }), 1)`);
  await ready();
  const ms = Date.now() - t0;
  const after = await heightAtHex('0505');
  const st1 = await stagesSince();
  check('a sculpt edit lifts the ground without re-eroding', after - before > 300 && !st1.includes('eroding') && !st1.includes('draining'), { before, after, ms, stages: st1 });

  for (let i = 0; i < 40 && !readFileSync(MAP, 'utf8').includes('chk-raise'); i++) await sleep(100);
  const file = loadWorld(JSON.parse(readFileSync(MAP, 'utf8')));
  check('the browser writes the sculpt edit back to the map file', file.sculpt.some((e) => e.id === 'chk-raise'), file.sculpt.map((e) => e.id));
  const ex = new ToolExecutor(file, null, file);
  const r = ex.run('add_paint', { edit: { biome: 'desert', hexes: ['0303', '0304'], falloffKm: 0.5, label: 'desert in 0303' } });
  writeFileSync(MAP, serializeWorld(file));
  await page.waitFor('window.__tp.store.world.paint.length === 1', 15000);
  await sleep(300);
  const st2 = await stagesSince();
  const dom = await dominant('0303');
  check('a paint edit from the terminal shows up live, without a bake', r.ok && dom === 'desert' && st2.length === 0, { dom, stages: st2 });

  await page.evaluate("(window.__tp.app.setView({ from: '0306', fromAglM: 7000, to: '0303' }), 1)");
  await sleep(1500);
  await shot('layers-paint.png');
  await page.evaluate('(window.__tp.app.resetCamera(), 1)');
  await sleep(800);
  await shot('layers-before-brush.png');
  const cam0 = await page.evaluate<number[]>('window.__tp.app.camera.position.toArray()');
  const btn = await page.evaluate<[number, number]>(`(() => { const b = [...document.querySelectorAll('#ops-panel button')].find((x) => x.textContent === 'Raise'); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await mouse('mousePressed', ...btn);
  await mouse('mouseReleased', ...btn, 0);
  const toolOn = await page.evaluate<boolean>(`[...document.querySelectorAll('#ops-panel button')].find((x) => x.textContent === 'Raise').classList.contains('on')`);
  const sculptBefore = await heightAtHex('0708');
  const a = await screenOf('0707'), b = await screenOf('0709');
  await mouse('mouseMoved', ...a, 0);
  await mouse('mousePressed', ...a);
  for (let i = 1; i <= 8; i++) {
    await mouse('mouseMoved', a[0] + ((b[0] - a[0]) * i) / 8, a[1] + ((b[1] - a[1]) * i) / 8);
    await sleep(40);
  }
  await mouse('mouseReleased', ...b, 0);
  await ready();
  await sleep(200);
  const cam1 = await page.evaluate<number[]>('window.__tp.app.camera.position.toArray()');
  const brushEdits = await page.evaluate<{ n: number; label: string; src: string }>('(() => { const s = window.__tp.store.world.sculpt; const e = s[s.length - 1]; return { n: s.length, label: e.label, src: e.source }; })()');
  const sculptAfter = await heightAtHex('0708');
  const st3 = await stagesSince();
  await shot('layers-after-brush.png');
  check('a real mouse stroke with the Raise brush adds one brush edit and does not orbit', toolOn && brushEdits.n === 2 && brushEdits.src === 'brush' && JSON.stringify(cam0) === JSON.stringify(cam1), { toolOn, ...brushEdits, cam0, cam1 });
  check('the brush stroke lifts the ground under it without re-eroding', sculptAfter - sculptBefore > 50 && !st3.includes('eroding'), { sculptBefore, sculptAfter, stages: st3 });

  await page.evaluate('(window.__tp.store.undo(), 1)');
  await ready();
  await sleep(200);
  const undone = await heightAtHex('0708');
  check('undo takes the stroke back', Math.abs(undone - sculptBefore) < 5, { undone, sculptBefore });

  await sleep(800);
  const t1 = Date.now();
  await load();
  await ready();
  const reload = await page.evaluate<{ cached: boolean; sculpt: number; paint: number }>('({ cached: !!window.__tp.app.timings.cachedFoundation, sculpt: window.__tp.store.world.sculpt.length, paint: window.__tp.store.world.paint.length })');
  const st4 = await stagesSince();
  const kept = await heightAtHex('0505');
  check('reopening the map uses the saved bake and keeps the layers', reload.cached && !st4.includes('eroding') && Math.abs(kept - after) < 5 && reload.paint === 1, { ...reload, ms: Date.now() - t1, kept, after, stages: st4 });
} finally {
  await page.close();
  await server.close();
  if (!keep) {
    rmSync(MAP, { force: true });
    rmSync(BAKE, { force: true });
    rmSync(`maps/.history/${NAME}`, { recursive: true, force: true });
  }
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
