import { createServer } from 'vite';
import { BrowserPage } from './browser';

const software = process.argv.includes('--software');
const FAST = 'eres=512&iters=48&world=alpine-valley';

const server = await createServer({ server: { port: 5191, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5191/';
const page = await BrowserPage.launch({ width: 1280, height: 720, software });

let failed = 0;
const check = (name: string, ok: boolean, detail: unknown) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  ${JSON.stringify(detail)}`);
  if (!ok) failed++;
};

const load = async (query: string) => {
  await page.navigate(`${url}?${query}`);
  await page.waitFor('window.__tp');
};
const settled = () => page.waitFor("window.__tp.app.stage === 'ready' || window.__tp.app.stage === 'error'");
const state = () => page.evaluate<{ stage: string; iter: number; total: number; lakes: number; peak: number }>(`(() => {
  const a = window.__tp.app;
  return {
    stage: a.stage,
    iter: a.erosion ? a.erosion.iteration : -1,
    total: a.settings.iterations,
    lakes: a.hydro ? a.hydro.waterKind.reduce((n, k) => n + (k === 1 || k === 2 ? 1 : 0), 0) : 0,
    peak: Math.round(a.heightSrc.cpu.reduce((m, v) => Math.max(m, v), -1e9)),
  };
})()`);
const editHorn = (metres: number) => page.evaluate(`(window.__tp.store.commit('check', (w) => {
  w.ops.find((o) => o.id === 'horn').height += ${metres};
  return ['horn'];
}), 1)`);
const complete = (s: { stage: string; iter: number; total: number; lakes: number }) => s.stage === 'ready' && s.iter === s.total && s.lakes > 0;

try {
  await load(`${FAST}&nohex`);
  await settled();
  const first = await state();
  check('first bake finishes erosion and finds water', complete(first), first);
  for (let i = 1; i <= 3; i++) {
    await editHorn(100);
    await settled();
    const s = await state();
    check(`edit ${i} after a finished bake runs erosion to the end`, complete(s), s);
  }

  await load(`shot=1&${FAST}`);
  await page.evaluate('window.__tp.finish()');
  const scripted = await state();
  check('scripted bake gives the same complete result', complete(scripted) && scripted.peak > 1000, scripted);

  await load(`shot=1&${FAST}`);
  await page.evaluate(`(() => {
    const gc = window.__tp.app.gc;
    gc.readAsync = async (t) => new Float32Array(t.width * t.height * 4);
    return 1;
  })()`);
  const rejected = await page.evaluate<string>("window.__tp.finish().then(() => 'finished', (e) => String(e))");
  const blank = await state();
  check('an empty GPU readback is an error, not a flat map', blank.stage === 'error' && rejected.includes('bake failed') && blank.peak > 1000, { rejected, ...blank });
} finally {
  await page.close();
  await server.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
