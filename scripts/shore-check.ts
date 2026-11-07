// Browser regression checks for landmark lifecycle, real camera elevation, and flood sampling.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { BrowserPage } from './browser';

const server = await createServer({ server: { port: 5193, strictPort: false }, logLevel: 'error' });
await server.listen();
const page = await BrowserPage.launch({ width: 1280, height: 720, software: process.argv.includes('--software') });
const url = server.resolvedUrls!.local[0];
mkdirSync('shots', { recursive: true });
try {
  await page.navigate(`${url}?shot=1&world=forgotten-shore`);
  await page.waitFor('window.__tp');
  await page.evaluate('window.__tp.finish()');
  const initial = await page.evaluate<{ meshes: number; parts: number; spire: number; cameraError: number }>(`(() => {
    const a = window.__tp.app;
    window.__tp.setView('city-to-spire');
    return { meshes: a.landmarks.group.children.length,
      parts: a.landmarks.group.children.reduce((n,m) => n+m.count, 0),
      spire: a.uniforms.uSpire.value.w,
      cameraError: Math.abs(a.camera.position.y*1000-a.surfaceAt(46.05,34.45)-65) };
  })()`);
  assert.equal(initial.meshes, 4);
  assert(initial.parts > 1000);
  assert.equal(initial.spire, 1.8);
  assert(initial.cameraError < 1, `low camera moved by ${initial.cameraError} m`);
  console.log('ok landmarks and low camera', initial);
  const high = await page.evaluate<{ floor: number; water: number; outside: number; city: number; shaderWater: number }>(`(() => {
    const a = window.__tp.app;
    a.setSettings({ tide: 1 });
    return { floor: a.heightAt(31,35), water: a.surfaceAt(31,35), city: a.surfaceAt(47,35),
      outside: a.surfaceAt(60,60)-a.heightAt(60,60), shaderWater: a.uniforms.uTide.value.w };
  })()`);
  assert(high.floor < 80 && high.water === 80 && high.shaderWater === 80 && high.city > 300);
  assert.equal(high.outside, 0);
  console.log('ok flood level and dry city', high);
  for (const [name, view, tide, time] of [
    ['high-water', 'range-mid', 1, 16.5],
    ['spire-shadow', 'range-mid', 0, 17.25],
    ['wall-high-water', 'city-to-spire', 1, 17.25],
  ] as const) {
    await page.evaluate(`(window.__tp.app.setSettings({ tide: ${tide}, timeOfDay: ${time} }), window.__tp.setView('${view}'), window.__tp.finish())`);
    await page.evaluate('window.__tp.renderFrames(3)');
    const data = await page.evaluate<string>("document.getElementById('view').toDataURL('image/png')");
    writeFileSync(`shots/forgotten-shore--${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
  }
  // A metadata edit must move the shadow with the mesh, including undo.
  await page.evaluate(`window.__tp.store.commit('move spire', w => { w.features.find(f => f.id === 'crimson-spire').pos[0] += 1; })`);
  assert.equal(await page.evaluate('window.__tp.app.uniforms.uSpire.value.x'), 41);
  await page.evaluate('window.__tp.store.undo()');
  assert.equal(await page.evaluate('window.__tp.app.uniforms.uSpire.value.x'), 40);
  // Loading an ordinary world clears all custom geometry, palette and tide.
  await page.evaluate(`(async () => {
    const w = (await import('/src/worlds.ts')).exampleWorld('alpine-valley');
    w.erosion.enabled = false;
    window.__tp.store.replace(w, 'ordinary world');
    await window.__tp.app.finishNow();
  })()`);
  const cleared = await page.evaluate<number[]>('(() => {const a=window.__tp.app;return [a.landmarks.group.children.length,a.uniforms.uSpire.value.w,a.uniforms.uAshen.value,a.uniforms.uTide.value.z];})()');
  assert.deepEqual(cleared, [0, 0, 0, 0]);
  console.log('ok landmark edit, undo and scene cleanup');
  const errors = await page.evaluate<number>('window.__tp.app.renderer.info.programs.filter(p => p.diagnostics && !p.diagnostics.runnable).length');
  assert.equal(errors, 0);
  console.log('all shore checks passed');
} finally {
  await page.close();
  await server.close();
}
