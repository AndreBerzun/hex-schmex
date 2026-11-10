import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { BrowserPage } from './browser';

const server = await createServer({ server: { port: 5194, strictPort: false }, logLevel: 'error' });
await server.listen();
const page = await BrowserPage.launch({ width: 1280, height: 720 });
try {
  await page.navigate(`${server.resolvedUrls!.local[0]}?shot=1&world=forgotten-shore`);
  await page.waitFor('window.__tp');
  await page.evaluate('window.__tp.finish()');

  const shot = `(() => { window.__tp.setView('coral-to-spire'); window.__tp.renderFrames(3); return document.getElementById('view').toDataURL('image/png'); })()`;
  const a = await page.evaluate<string>(shot);
  await page.evaluate('window.__tp.app.refreshScenery()');
  const b = await page.evaluate<string>(shot);
  assert.equal(a, b, 'a rebuilt cell cache draws the same picture');
  await page.evaluate('window.__tp.app.sceneryOn = false');
  const off = await page.evaluate<string>(shot);
  await page.evaluate('window.__tp.app.sceneryOn = true');
  assert.notEqual(a, off, 'the middle layer draws something in the coral');
  const report = await page.evaluate<{ stats: { instances: number; triangles: number } }>('window.__tp.app.sceneryReport()');
  assert(report.stats.instances > 500, `coral view has ${report.stats.instances} objects`);
  console.log('ok deterministic redraw after cache rebuild', report.stats);

  const march = await page.evaluate<{ ok: boolean; reason?: string; straight?: number; walked?: number; steps?: number; message?: string }>(`(() => {
    const app = window.__tp.app, cells = app.sceneryCells;
    const cam = app.camera.position;
    const k = 0.32, cx = Math.floor(cam.x / k), cz = Math.floor(cam.z / k);
    const walls = [];
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) walls.push(...cells.get('mid', cx + di, cz + dj).objects.filter((o) => o.kind === 'coral-wall'));
    const ok = (x, z) => !app.sceneryBlocked(x, z) && app.surfaceAt(x, z) - app.heightAt(x, z) < 0.3;
    for (const w of walls) {
      const nx = Math.sin(w.yaw), nz = Math.cos(w.yaw);
      const ax = w.x - nx * 0.012, az = w.z - nz * 0.012, bx = w.x + nx * 0.012, bz = w.z + nz * 0.012;
      if (!ok(ax, az) || !ok(bx, bz)) continue;
      app.ground.enter();
      app.camera.position.set(ax, 0, az);
      app.ground.placeCamera();
      app.ground.acceleration = 60;
      if (!app.ground.goTo(bx, bz)) continue;
      let walked = 0, px = ax, pz = az, steps = 0;
      for (; steps < 4000 && app.ground.destination; steps++) {
        app.ground.update(0.05);
        const p = app.camera.position;
        if (app.sceneryBlocked(p.x, p.z)) return { ok: false, reason: 'walked into a wall', steps };
        walked += Math.hypot(p.x - px, p.z - pz); px = p.x; pz = p.z;
      }
      const msg = app.ground.message;
      if (msg !== 'Arrived') continue;
      return { ok: true, straight: Math.hypot(bx - ax, bz - az), walked, steps, message: msg };
    }
    return { ok: false, reason: 'no wall with free ground on both sides that could be crossed' };
  })()`);
  assert(march.ok, march.reason);
  assert(march.walked! > march.straight! * 1.05, `the march went round the wall (${march.walked} vs ${march.straight} km)`);
  console.log('ok march routes round a coral wall', march);

  const health = await page.evaluate<{ error: number; programs: boolean }>(`(() => {
    const app = window.__tp.app;
    const gl = app.renderer.getContext();
    return { error: gl.getError(), programs: app.renderer.info.programs.every((p) => !p.diagnostics || p.diagnostics.runnable) };
  })()`);
  assert.equal(health.error, 0);
  assert(health.programs, 'all shader programs compiled');
  await page.evaluate(`(() => { const a = window.__tp.app; a.ground.leave(); window.__tp.setView('coral-to-spire'); a.start(); })()`);
  await page.evaluate('new Promise((r) => setTimeout(r, 1500))');
  const idle = await page.evaluate<number>(`new Promise((r) => { const a = window.__tp.app, n = a.renderedFrames; setTimeout(() => r(a.renderedFrames - n), 2000); })`);
  assert.equal(idle, 0, 'no redraws while idle');
  console.log('ok shaders, GL errors and zero idle redraws');
  console.log('all scenery checks passed');
} finally {
  await page.close();
  await server.close();
}
