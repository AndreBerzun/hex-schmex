import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { BrowserPage } from './browser';

const prototype = process.argv.includes('--prototype');
const out = process.argv.slice(2).find(a => !a.startsWith('--')) ?? (prototype ? 'shots/_tmp/fps-composition' : 'shots/_tmp/fps-baseline');
mkdirSync(out, { recursive: true });
const route = JSON.parse(readFileSync('scripts/fps-route.json', 'utf8'));
const server = await createServer({ server: { port: 5197, strictPort: false }, logLevel: 'error' });
await server.listen();
const page = await BrowserPage.launch({ width: 1280, height: 720 });
try {
  await page.navigate(`${server.resolvedUrls!.local[0]}?shot=1&world=forgotten-shore${prototype ? '&prototype=downs-walk' : ''}`);
  await page.waitFor('window.__tp');
  await page.evaluate('window.__tp.finish()');
  await page.evaluate(`(() => {
    const a = window.__tp.app; a.running = false; a.autoTide = false;
    a.setSettings({ exag: 1, timeOfDay: 12, tide: 0, mapMode: false });
    a.sceneryBudgetMs = 4; a.ground.enter(); a.ground.acceleration = ${route.acceleration};
    window.__route = ${JSON.stringify(route)};
    window.__place = (p) => {
      a.ground.stop(); a.camera.position.set(p[0], 0, p[1]); a.ground.placeCamera();
      a.camera.lookAt(p[0], a.camera.position.y, p[1] + 1);
      a.camera.near = 0.0002; a.camera.updateProjectionMatrix();
    };
  })()`);
  await page.evaluate('window.__tp.finish()');
  const spots = await page.evaluate<unknown[]>(`window.__route.cameras.map(c => window.__tp.app.sceneryCells.source.ground.describe(...c.from))`);
  console.log('Route spots', JSON.stringify(spots));
  // Use the normal travel/routing code, but freeze lighting and the campaign clock.
  // A single controlled RAF loop renders once per callback, without app.start().
  const runs: unknown[] = [];
  for (const cold of [true, false]) {
    const run = await page.evaluate<{ arrived: boolean; [key: string]: unknown }>(`(async () => {
      const a = window.__tp.app, r = window.__route;
      if (${cold}) a.refreshScenery();
      window.__place(r.start);
      const generatedBefore = a.sceneryCells.generated;
      const distanceBefore = a.ground.distanceKm;
      const t0 = performance.now();
      const ok = a.ground.goTo(...r.end);
      const planningMs = performance.now() - t0;
      if (!ok) throw new Error(a.ground.message);
      const rows = []; let last = performance.now(); const start = last;
      await new Promise((resolve, reject) => {
        const tick = (now) => {
          const gap = now - last; last = now;
          const gpuMs = a.timer.poll();
          const t = performance.now(); a.ground.update(Math.min(gap / 1000, .05));
          const travelMs = performance.now() - t;
          a.render();
          rows.push({ gap, gpuMs, travelMs, position: a.camera.position.toArray(), ...a.scenery.stats,
            drawCalls: a.renderer.info.render.calls, totalTriangles: a.renderer.info.render.triangles });
          if (!a.ground.destination) resolve();
          else if (now - start > 60000) reject(new Error('route timed out'));
          else requestAnimationFrame(tick);
        }; requestAnimationFrame(tick);
      });
      return { cold: ${cold}, planningMs, generatedCells: a.sceneryCells.generated - generatedBefore,
        elapsedMs: performance.now() - start, arrived: a.ground.message === 'Arrived', message: a.ground.message,
        walkedM: (a.ground.distanceKm - distanceBefore) * 1000, end: a.camera.position.toArray(), rows };
    })()`);
    assert(run.arrived, JSON.stringify(run)); runs.push(run);
    console.log(cold ? 'Cold traversal complete' : 'Warm traversal complete');
  }
  const captures: unknown[] = [];
  const cameras = [...route.cameras, { name: 'knoll-close', from: [40.89, 45.975] }, ...(prototype ? [
    { name: 'passage-west', from: [40.802, 46.065] },
    { name: 'passage-exit', from: [40.805, 46.105] },
  ] : [])];
  for (const c of cameras) {
    const shot = await page.evaluate<{ png: string; [key: string]: unknown }>(`(async () => {
      const a = window.__tp.app; window.__place(${JSON.stringify(c.from)});
      for (let i = 0; i < 500; i++) {
        a.render(); a.timer.poll();
        await new Promise(r => requestAnimationFrame(r));
        if (!a.scenery.stats.pending) break;
      }
      const samples = [];
      for (let i = 0; i < 16; i++) {
        a.render();
        await new Promise(r => setTimeout(r, 35));
        const ms = a.timer.poll(); if (i >= 4 && ms !== null) samples.push(ms);
      }
      return { name: ${JSON.stringify(c.name)}, camera: a.camera.position.toArray(), fov: a.camera.fov,
        gpuSamplesMs: samples, ...a.sceneryReport(), draw: { ...a.renderer.info.render },
        png: a.renderer.domElement.toDataURL('image/png') };
    })()`);
    writeFileSync(`${out}/${c.name}.png`, Buffer.from(shot.png.split(',')[1], 'base64'));
    const { png: _png, ...capture } = shot; captures.push(capture);
  }
  const context = await page.evaluate(`(() => { const a = window.__tp.app, gl = a.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable',
      seed: a.world.seed, settings: a.settings, glError: gl.getError(), resolution: [a.renderer.domElement.width, a.renderer.domElement.height] };
  })()`);
  assert.equal((context as { glError: number }).glError, 0, 'WebGL health');
  const result = { date: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    prototype, worldSha256: createHash('sha256').update(readFileSync('worlds/forgotten-shore.json')).digest('hex'), route, context, spots, runs, captures };
  writeFileSync(`${out}/results.json`, JSON.stringify(result, null, 2));
  console.log(`Saved baseline to ${out}`);
} finally { await page.close(); await server.close(); }
