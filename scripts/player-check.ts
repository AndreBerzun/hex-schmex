import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { BrowserPage } from './browser';
const server=await createServer({server:{port:5195,strictPort:false},logLevel:'error'});await server.listen();
const page=await BrowserPage.launch({width:1280,height:720});
try {
  await page.navigate(`${server.resolvedUrls!.local[0]}?world=forgotten-shore`);
  await page.waitFor('window.__tp');await page.evaluate('window.__tp.finish()');
  assert(await page.evaluate(`['Hexes','Labels','Player'].every(t=>[...document.querySelectorAll('#toolbar button')].some(b=>b.textContent===t)) && getComputedStyle(document.getElementById('stats')).display!=='none'`));
  await page.evaluate(`document.querySelectorAll('#toolbar button')[3].click()`);
  assert(await page.evaluate('window.__tp.app.ground.enabled'));
  // Deterministic terrain path to verify accelerated movement and exact campaign-time accounting.
  const journey=await page.evaluate<{distance:number;seconds:number;hour:number;eye:number}>(`(() => {
    const a=window.__tp.app;a.running=false;a.camera.position.set(67.33,0,66.83);a.ground.placeCamera();
    a.settings.timeOfDay=10;a.ground.goTo(67.38,66.83);
    for(let i=0;i<100&&a.ground.destination;i++)a.frame();
    // frame() is wall-clock driven; advance via the same travel component with explicit frame durations.
    for(let i=0;i<100&&a.ground.destination;i++) {
      const sec=a.ground.update(.05);a.settings.timeOfDay+=sec/3600;
    }
    const p=a.camera.position;
    return {distance:a.ground.distanceKm,seconds:a.ground.elapsedSeconds,hour:a.settings.timeOfDay,
      eye:p.y*1000-a.terrain.surfaceHeightAt(p.x,p.z,(x,z)=>a.surfaceAt(x,z))};
  })()`);
  assert(journey.distance>=.049 && journey.distance<.06);
  assert(Math.abs(journey.seconds-journey.distance/4*3600)<1e-7);
  assert(Math.abs(journey.eye-1.7)<1e-6);
  console.log('ok ground distance, marching time and eye height',journey);
  // True click on visible terrain schedules a destination; a drag changes view without scheduling one.
  await page.evaluate(`(() => {
    const a=window.__tp.app,p=a.camera.position;
    a.camera.lookAt(p.x+.1,a.surfaceAt(p.x+.1,p.z)/1000,p.z);a.render();
  })()`);
  for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,x:640,y:520,button:'left',clickCount:1});
  assert(await page.evaluate('!!window.__tp.app.ground.destination'));
  await page.evaluate('window.__tp.app.ground.stop()');
  const blocked=await page.evaluate(`(() => {
    const a=window.__tp.app;a.setSettings({tide:1});a.camera.position.set(74.83,0,114.83);a.ground.placeCamera();a.ground.goTo(74.93,114.83);a.ground.update(.05);
    return !a.ground.destination&&a.ground.message.includes('Water');
  })()`);assert(blocked);
  // Full day/night renders, including the automatically linked flood.
  for(const [name,time] of [['player-day',12],['player-night',22]] as const){
    await page.evaluate(`(() => {
      const a=window.__tp.app;a.ground.leave();a.ground.enter();a.camera.position.set(66.43,0,65.83);a.camera.lookAt(50.33,.9,81.83);a.setSettings({timeOfDay:${time},tide:${time>18?1:0}});a.ground.placeCamera();a.render();
    })()`);
    const daylight=await page.evaluate<number>('window.__tp.app.uniforms.uDaylight.value');
    assert(time===12?daylight>.99:daylight<.01);
    await page.evaluate('window.__tp.app.start();window.__tp.app.invalidate()');
    await page.evaluate('new Promise(r=>setTimeout(r,700))');
    const png=await page.send('Page.captureScreenshot',{format:'png'}) as {data:string};
    writeFileSync(`shots/forgotten-shore--${name}.png`,Buffer.from(png.data,'base64'));
    await page.evaluate('window.__tp.app.running=false');
  }
  // Exercise the reported scenario on the real GPU: repeated flooding, at low eye height.
  const stress=await page.evaluate<{lost:boolean;error:number;pixels:number;maxQueue:number}>(`(async()=>{
    const a=window.__tp.app;a.ground.leave();a.freeFlight.setEnabled(true);a.start();
    let maxQueue=0;
    for(let i=0;i<100;i++){
      a.setSettings({tide:(Math.sin(i*.22)+1)/2,timeOfDay:16.5});
      a.camera.position.set(44.83+i*.002,(a.surfaceAt(44.83+i*.002,42.83)+2)/1000,42.83);
      a.camera.lookAt(40,.5,36.5);a.invalidate();
      await new Promise(r=>setTimeout(r,30));
      maxQueue=Math.max(maxQueue,a.terrain.nodeCount);
      if(a.contextLost)break;
    }
    return {lost:a.contextLost,error:a.renderer.getContext().getError(),pixels:a.renderer.domElement.width*a.renderer.domElement.height,maxQueue};
  })()`);
  assert(!stress.lost && stress.error===0);assert(stress.pixels<=1805000);
  console.log('ok real-GPU shoreline stress',stress);
  // Verify the pixel budget on a high-DPI full-HD viewport as well.
  await page.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:2,mobile:false});
  await page.evaluate('window.__tp.app.resize()');
  assert(await page.evaluate('document.getElementById("view").width*document.getElementById("view").height<=1805000'));
  await page.evaluate('window.__tp.app.renderer.getContext().getExtension("WEBGL_lose_context").loseContext()');
  await page.waitFor('window.__tp.app.contextLost');
  assert(await page.evaluate('!!document.querySelector("button.recovery") && window.__tp.app.stage === "error"'));
  console.log('ok visible graphics-context recovery');
  console.log('all player checks passed');
}finally{await page.close();await server.close();}
