import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { BrowserPage } from './browser';
const server = await createServer({ server: { port: 5194, strictPort: false }, logLevel: 'error' });
await server.listen();
const page = await BrowserPage.launch({ width: 1280, height: 720 });
const url = server.resolvedUrls!.local[0];
const key = (type: string, code: string, key: string) => page.send('Input.dispatchKeyEvent', { type, code, key });
try {
  await page.navigate(`${url}?world=forgotten-shore`);
  await page.waitFor('window.__tp');
  await page.evaluate('window.__tp.finish()');
  assert(await page.evaluate(`(() => {
    const a=window.__tp.app;
    return a.freeFlight.enabled && document.getElementById('view').clientWidth === innerWidth &&
      !document.querySelector('#ops-panel button') && !document.querySelector('#toolbar button[title*="erosion"]') &&
      getComputedStyle(document.getElementById('ops-panel')).display === 'none';
  })()`));
  // A trusted click exercises real pointer capture rather than substituting fake lock state.
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
  await page.waitFor('window.__tp.app.freeFlight.locked', 10000);
  await page.evaluate('window.__tp.app.running=false');
  const measure = async (code: string, name: string, boost=false) => {
    const before=await page.evaluate<number[]>('window.__tp.app.camera.position.toArray()');
    if (boost) await key('keyDown','ControlLeft','Control');
    await key('keyDown',code,name);
    await page.evaluate('window.__tp.app.freeFlight.update(0.05)');
    await key('keyUp',code,name);
    if (boost) await key('keyUp','ControlLeft','Control');
    const after=await page.evaluate<number[]>('window.__tp.app.camera.position.toArray()');
    return after.map((v,i)=>v-before[i]);
  };
  const up=await measure('Space',' '), down=await measure('ShiftLeft','Shift'), fast=await measure('Space',' ',true);
  assert(Math.abs(up[1]-.0015)<1e-8 && Math.abs(down[1]+.0015)<1e-8);
  assert(Math.abs(fast[1]/up[1]-10)<1e-8);
  const w=await measure('KeyW','w'), s=await measure('KeyS','s'), a=await measure('KeyA','a'), d=await measure('KeyD','d');
  assert(w.every((v,i)=>Math.abs(v+s[i])<1e-8));
  assert(a.every((v,i)=>Math.abs(v+d[i])<1e-8));
  assert(Math.abs(Math.hypot(...w)-.0015)<1e-8);
  const q=await page.evaluate<number[]>('window.__tp.app.camera.quaternion.toArray()');
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 670, y: 375 });
  const moved=await page.evaluate<number[]>('window.__tp.app.camera.quaternion.toArray()');
  assert(q.some((v,i)=>Math.abs(v-moved[i])>1e-5));
  await key('keyDown','KeyW','w');
  await page.evaluate('window.__tp.app.freeFlight.release()');
  await page.waitFor('!window.__tp.app.freeFlight.locked');
  assert.equal(await page.evaluate('window.__tp.app.freeFlight.update(.05)'),false);
  await key('keyUp','KeyW','w');
  await page.evaluate(`document.querySelectorAll('#toolbar button')[2].click()`);
  assert(await page.evaluate('window.__tp.app.settings.mapMode && !window.__tp.app.freeFlight.enabled'));
  await page.evaluate(`document.querySelectorAll('#toolbar button')[0].click()`);
  assert(await page.evaluate('!window.__tp.app.settings.mapMode && window.__tp.app.freeFlight.enabled'));
  console.log('all flight checks passed: real pointer lock, mouse look, WASD, ascent/descent, 10x boost, release and map transitions');
} finally { await page.close(); await server.close(); }
