import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { BrowserPage } from './browser';
const server = await createServer({ server: { port: 5194, strictPort: false }, logLevel: 'error' });
await server.listen();
const page = await BrowserPage.launch({ width: 1280, height: 720 });
const url = server.resolvedUrls!.local[0];
const SHIFT = 8, CONTROL = 2, ALT = 1, META = 4;
const key = (type: string, code: string, key: string, modifiers = 0) => page.send('Input.dispatchKeyEvent', { type, code, key, modifiers });
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
  const inputStates: unknown[]=[];
  const measure = async (code: string, name: string, boost=false, shiftCode='ShiftLeft') => {
    if (boost) await key('keyDown',shiftCode,'Shift',SHIFT);
    await key('keyDown',code,name,boost?SHIFT:0);
    // Measure this one explicit step atomically, excluding any queued frame or
    // camera adjustment between the keyboard events and the component update.
    const state=await page.evaluate<{delta:number[];keys:string[];locked:boolean;focused:boolean}>(`(() => {
      const a=window.__tp.app,before=a.camera.position.clone();
      a.freeFlight.update(.05);
      return {delta:a.camera.position.clone().sub(before).toArray(),keys:[...a.freeFlight.keys],
        locked:a.freeFlight.locked,focused:document.hasFocus()};
    })()`);
    inputStates.push({code,boost,...state});
    await key('keyUp',code,name,boost?SHIFT:0);
    if (boost) await key('keyUp',shiftCode,'Shift');
    return state.delta;
  };
  const up=await measure('Space',' '), down=await measure('KeyC','c'), fast=await measure('Space',' ',true);
  assert(Math.abs(up[1]-.0015)<1e-8 && Math.abs(down[1]+.0015)<1e-8,JSON.stringify({up,down,fast,inputStates}));
  assert(Math.abs(fast[1]/up[1]-10)<1e-8);
  const w=await measure('KeyW','w'), s=await measure('KeyS','s'), a=await measure('KeyA','a'), d=await measure('KeyD','d');
  assert(w.every((v,i)=>Math.abs(v+s[i])<1e-8));
  assert(a.every((v,i)=>Math.abs(v+d[i])<1e-8));
  assert(Math.abs(Math.hypot(...w)-.0015)<1e-8);
  const fastW=await measure('KeyW','W',true),fastDown=await measure('KeyC','C',true,'ShiftRight');
  assert(fastW.every((v,i)=>Math.abs(v-w[i]*10)<1e-8));
  assert(Math.abs(fastDown[1]-down[1]*10)<1e-8);
  // Modifier flags matter: sending a Control key event alone did not actually
  // exercise Ctrl+movement. Reserved shortcuts must also clear held movement.
  for (const [code,name,modifiers] of [['ControlLeft','Control',CONTROL],['AltLeft','Alt',ALT],['MetaLeft','Meta',META]] as const) {
    await key('keyDown','KeyW','w');
    await key('keyDown',code,name,modifiers);
    await key('keyDown','Space',' ',modifiers);
    assert.equal(await page.evaluate('window.__tp.app.freeFlight.update(.05)'),false);
    await key('keyUp','Space',' ',modifiers);
    await key('keyUp','KeyW','w',modifiers);
    await key('keyUp',code,name);
  }
  // Real rendering while holding Shift+W at the maximum selectable flight speed,
  // near the changing shoreline. The earlier boost test advanced only one step.
  await page.evaluate(`(() => {
    const a=window.__tp.app;
    a.camera.position.set(44.83,(a.surfaceAt(44.83,42.83)+2)/1000,42.83);
    a.camera.lookAt(49.83,.5,42.83);a.freeFlight.speed=.25;a.start();
  })()`);
  await key('keyDown','ShiftLeft','Shift',SHIFT);
  await key('keyDown','KeyW','W',SHIFT);
  await key('keyDown','Space',' ',SHIFT);
  const stress=await page.evaluate<{lost:boolean;error:number;distance:number;frames:number;finite:boolean}>(`(async () => {
    const a=window.__tp.app,start=a.camera.position.clone(),frames=a.renderedFrames;
    for(let i=0;i<20;i++) {
      a.setSettings({tide:(i%5)/4});
      await new Promise(r=>setTimeout(r,100));
    }
    return {lost:a.contextLost,error:a.renderer.getContext().getError(),
      distance:a.camera.position.distanceTo(start),frames:a.renderedFrames-frames,
      finite:a.camera.position.toArray().every(Number.isFinite)};
  })()`);
  await key('keyUp','Space',' ',SHIFT);
  await key('keyUp','KeyW','W',SHIFT);
  await key('keyUp','ShiftLeft','Shift');
  await page.evaluate('window.__tp.app.running=false');
  assert(!stress.lost && stress.error===0 && stress.finite);
  assert(stress.distance>.1 && stress.frames>5,JSON.stringify(stress));
  console.log('ok Shift+W+Space with real modifiers, maximum speed and changing water',stress);
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
  console.log('all flight checks passed: real pointer lock, mouse look, WASD, Space/C vertical movement, Shift 10x boost, reserved modifiers, release and map transitions');
} finally { await page.close(); await server.close(); }
