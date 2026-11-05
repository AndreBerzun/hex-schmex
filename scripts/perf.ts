import { readdirSync } from 'node:fs';
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
const [W, H] = opt('size', '1280x720').split('x').map(Number);
const worlds = args.length ? args : readdirSync('worlds').filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));

const FRAME_RECORDER = `
window.__perf = { t0: performance.now(), stages: [], gaps: [] };
(() => {
  let last = performance.now(), stage = '';
  const tick = () => {
    const now = performance.now();
    window.__perf.gaps.push([now - window.__perf.t0, now - last]);
    last = now;
    const app = window.__tp && window.__tp.app;
    if (app && app.stage !== stage) {
      stage = app.stage;
      window.__perf.stages.push([now - window.__perf.t0, stage]);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

const VIEW_COSTS = `(async () => {
  const tp = window.__tp, app = tp.app, gl = app.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const px = new Uint8Array(4);
  app.running = false;
  await sleep(100);
  const out = {};
  for (const view of tp.viewNames) {
    tp.setView(view);
    const samples = [];
    for (let i = 0; i < 12; i++) {
      if (!app.settings.mapMode) app.controls.update();
      const q = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      app.render();
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let k = 0; k < 200 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await sleep(5);
      samples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
    samples.splice(0, 4);
    samples.sort((a, b) => a - b);
    out[view] = { gpuMs: samples[samples.length >> 1], triangles: app.renderer.info.render.triangles };
  }
  tp.setView('region-oblique');
  app.running = false;
  app.start();
  return out;
})()`;

const ORBIT = `(async () => {
  const app = window.__tp.app;
  app.controls.autoRotate = true;
  app.controls.autoRotateSpeed = 6;
  const before = app.renderedFrames;
  const gaps = [];
  let last = performance.now();
  await new Promise((resolve) => {
    const t0 = last;
    const tick = () => {
      const now = performance.now();
      gaps.push(now - last);
      last = now;
      if (now - t0 > 4000) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  app.controls.autoRotate = false;
  return { gaps, rendered: app.renderedFrames - before };
})()`;

const IDLE = `(async () => {
  const app = window.__tp.app;
  await new Promise((r) => setTimeout(r, 1500));
  const before = app.renderedFrames;
  await new Promise((r) => setTimeout(r, 2000));
  return app.renderedFrames - before;
})()`;

interface Recorded {
  stages: [number, string][];
  gaps: [number, number][];
  renderer: string;
  size: [number, number];
  timings: Record<string, number>;
  lighting: boolean;
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const stats = (values: number[]) => {
  const s = values.slice().sort((a, b) => a - b);
  return `median ${pct(s, 0.5).toFixed(0)} ms, p95 ${pct(s, 0.95).toFixed(0)} ms, worst ${s[s.length - 1].toFixed(0)} ms`;
};

const server = await createServer({ server: { port: 5198, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5198/';
const page = await BrowserPage.launch({ width: W, height: H });
await page.addInitScript(FRAME_RECORDER);
try {
  for (const world of worlds) {
    await page.navigate(`${url}?shot=1&world=${world}`);
    await page.waitFor('window.__tp');
    await page.waitFor("window.__tp.app.stage === 'ready' && !window.__tp.app.derived.fullPending");
    await page.evaluate('new Promise((r) => setTimeout(r, 500))');
    const rec = await page.evaluate<Recorded>(`(() => {
      const gl = window.__tp.app.renderer.getContext();
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const c = document.getElementById('view');
      return { ...window.__perf, renderer: gl.getParameter(info.UNMASKED_RENDERER_WEBGL), size: [c.width, c.height], timings: window.__tp.app.timings };
    })()`);
    console.log(`\n${world}  (${rec.size.join('x')}, ${rec.renderer})`);
    console.log(`  ops ${rec.timings.evaluate?.toFixed(0)} ms, drainage ${rec.timings.fluvial?.toFixed(0)} ms, gpu erosion ${rec.timings.erosion?.toFixed(0)} ms, readback ${rec.timings.readback?.toFixed(0)} ms, hydrology ${rec.timings.hydrology?.toFixed(0)} ms`);
    rec.stages.forEach(([t, stage], i) => {
      const end = rec.stages[i + 1]?.[0] ?? Infinity;
      const gaps = rec.gaps.filter(([at]) => at >= t && at < end).map(([, gap]) => gap);
      if (gaps.length) console.log(`  ${stage.padEnd(11)} ${end === Infinity ? '' : `${((end - t) / 1000).toFixed(1)} s, `}frame gaps ${stats(gaps)}`);
    });
    const idleFrames = await page.evaluate<number>(IDLE);
    console.log(`  idle        ${idleFrames} frames drawn in 2 s`);
    const orbit = await page.evaluate<{ gaps: number[]; rendered: number }>(ORBIT);
    console.log(`  orbit       ${(orbit.rendered / 4).toFixed(0)} frames/s drawn, frame gaps ${stats(orbit.gaps)}`);
    const views = await page.evaluate<Record<string, { gpuMs: number; triangles: number }>>(VIEW_COSTS);
    for (const [view, v] of Object.entries(views)) console.log(`  ${view.padEnd(15)} ${v.gpuMs.toFixed(1).padStart(6)} ms gpu  ${(v.triangles / 1000).toFixed(0).padStart(5)}k triangles`);
  }
} finally {
  await page.close();
  await server.close();
}
