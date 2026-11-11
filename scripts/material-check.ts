// Repeatable material views and GPU timings. Local pages only; no downloaded assets.
// TP_BROWSER_OFFLINE=1 npm run check:materials -- before|after [world ...]
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { BrowserPage } from './browser';
import type { ViewSpec } from '../src/core/types';

const [label = 'after', ...requested] = process.argv.slice(2);
assert(/^[a-z0-9-]+$/i.test(label), 'Use a simple comparison label');
const worlds = requested.length ? requested : ['alpine-valley', 'coastal-marches', 'forgotten-shore'];
const outDir = `shots/_tmp/materials-${label}`;
mkdirSync(outDir, { recursive: true });
const closeups: Record<string, Record<string, ViewSpec>> = {
  'alpine-valley': {
    'lowland': { from: '0808', fromAglM: 100, to: '0807' },
    'forest': { from: '0305', fromAglM: 100, to: '0304' },
    'ground': { from: [75, 80], fromAglM: 2, to: [75.12, 80], toAglM: -2 },
  },
  'coastal-marches': {
    'forest': { from: '0506', fromAglM: 100, to: '0505' },
    'marsh': { from: '0609', fromAglM: 100, to: '0608' },
  },
  'forgotten-shore': {
    'ground': { from: [44.83, 42.83], fromAglM: 2, to: [44.68, 42.83], toAglM: -2 },
  },
};
const server = await createServer({ server: { host: '127.0.0.1', port: 5191, strictPort: false }, logLevel: 'error' });
await server.listen();
const page = await BrowserPage.launch({ width: 1280, height: 720 });
const report: Record<string, unknown> = {};
try {
  for (const world of worlds) {
    await page.navigate(`${server.resolvedUrls!.local[0]}?shot=1&world=${encodeURIComponent(world)}&nohex=1&exag=1`);
    await page.waitFor('window.__tp');
    await page.evaluate('window.__tp.finish()');
    // No animated camera or active timer query while collecting controlled samples.
    await page.evaluate('window.__tp.app.running = false');
    const views = ['region-oblique', 'region-topdown', 'valley-low', ...Object.keys(closeups[world] ?? {})];
    const timings: Record<string, unknown> = {};
    for (const name of views) {
      const spec = closeups[world]?.[name];
      await page.evaluate(`(() => {
        const a = window.__tp.app;
        a.setSettings({ mapMode: false, hexGrid: false, labels: false });
        a.controls.maxPolarAngle = Math.PI;
        ${spec ? `a.setView(${JSON.stringify(spec)});` : `window.__tp.setView(${JSON.stringify(name)});`}
        ${spec ? `a.camera.near = ${Math.max(0.0002, Math.min(2, (spec.fromAglM ?? 3000) / 4000))};
        a.camera.position.y = (a.standHeightAt(a.camera.position.x, a.camera.position.z) + ${spec.fromAglM ?? 3000}) * 0.001;
        a.camera.lookAt(a.controls.target);
        a.camera.updateProjectionMatrix();` : 'a.keepAboveGround();'}
        a.controls.enabled = false;
        a.render();
      })()`);
      const result = await page.evaluate<{ gpuMs: number | null; triangles: number; programs: number; renderer: string }>(`(async () => {
        const a = window.__tp.app, gl = a.renderer.getContext();
        const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        const samples = [];
        if (ext) for (let i = 0; i < 12; i++) {
          const q = gl.createQuery();
          gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
          a.render();
          gl.endQuery(ext.TIME_ELAPSED_EXT);
          gl.flush();
          let ready = false;
          for (let k = 0; k < 400; k++) {
            if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) { ready = true; break; }
            await new Promise(r => setTimeout(r, 5));
          }
          if (ready && !gl.getParameter(ext.GPU_DISJOINT_EXT) && i >= 4)
            samples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(q);
        }
        samples.sort((a,b) => a-b);
        return { gpuMs: samples.length ? samples[samples.length >> 1] : null,
          triangles: a.renderer.info.render.triangles,
          programs: a.renderer.info.programs.filter(p => p.diagnostics && !p.diagnostics.runnable).length,
          renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
      })()`);
      assert.equal(result.programs, 0, `${world}/${name}: shader compilation failed`);
      const data = await page.evaluate<string>("document.getElementById('view').toDataURL('image/png')");
      await page.evaluate('window.__tp.app.render()');
      assert.equal(await page.evaluate("document.getElementById('view').toDataURL('image/png')"), data,
        `${world}/${name}: unchanged camera and world must render deterministically`);
      assert.equal(await page.evaluate('window.__tp.app.renderer.getContext().getError()'), 0,
        `${world}/${name}: WebGL error`);
      writeFileSync(`${outDir}/${world}--${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
      timings[name] = result;
      console.log(`${world}/${name}: ${result.gpuMs?.toFixed(1) ?? 'unavailable'} ms GPU`);
    }
    report[world] = timings;
  }
  writeFileSync(`${outDir}/timings.json`, JSON.stringify(report, null, 2) + '\n');
} finally {
  await page.close();
  await server.close();
}
