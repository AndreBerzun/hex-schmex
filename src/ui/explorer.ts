import { DEBUG_NAMES, type App } from '../app/app';
import type { Store } from '../app/store';
import { advanceClock, clockTide } from '../core/travel';
import { h } from './dom';

export function mountExplorer(el: HTMLElement, app: App, store: Store) {
  app.freeFlight.setEnabled(true);
  const title = h('span', { class: 'title', text: store.world.meta.name });
  const player = h('button', { class: 'btn', text: 'Player', onclick: () => {
    if(app.stage!=='ready')return;
    app.ground.enter();app.autoTide=true;
    app.setSettings({tide:clockTide(app.settings.timeOfDay)});sync();
  } });
  const fly = h('button', { class: 'btn on', text: 'Fly', onclick: () => {
    app.ground.leave();app.setSettings({ mapMode: false });app.freeFlight.setEnabled(true);app.controls.enabled = false;sync();
  } });
  const orbit = h('button', { class: 'btn', text: 'Orbit', onclick: () => {
    app.ground.leave();app.freeFlight.setEnabled(false);app.setSettings({ mapMode: false });sync();
  } });
  const map = h('button', { class: 'btn', text: 'Map', onclick: () => {
    app.ground.leave();app.freeFlight.setEnabled(false);app.setSettings({ mapMode: !app.settings.mapMode });sync();
  } });
  const visit = h('select', { 'aria-label': 'Visit landmark', onchange: () => {
    const v = store.world.meta.views?.[visit.value];if (v) app.setView(v);visit.value = '';sync();
  } });
  const sunText = h('span');
  const sun = h('input', { type: 'range', min: 0, max: 23.99, step: 0.05, value: app.settings.timeOfDay,
    'aria-label': 'Sun time', oninput: () => {
      app.setSettings({ timeOfDay: Number(sun.value), ...(app.autoTide?{tide:clockTide(Number(sun.value))}:{}) });sync();
    } });
  const sea = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: app.settings.tide,
    'aria-label': 'Sea level', oninput: () => {app.autoTide=false;app.setSettings({ tide: Number(sea.value) });sync();} });
  const seaControl = h('label', { class: 'inline' }, 'Sea', sea);
  const tideAuto=h('input',{type:'checkbox',onchange:()=>{app.autoTide=tideAuto.checked;if(app.autoTide)app.setSettings({tide:clockTide(app.settings.timeOfDay)});}});
  const tideControl=h('label',{class:'inline'},tideAuto,'Night tide');
  const speed = h('select', { 'aria-label': 'Flight speed', onchange: () => { app.freeFlight.speed = Number(speed.value) / 1000; } },
    ...[5, 15, 30, 100, 250].map(v => h('option', { value: v, text: `${v} m/s` })));
  speed.value = '30';
  const acceleration=h('select',{'aria-label':'Travel acceleration',onchange:()=>{app.ground.acceleration=Number(acceleration.value);}},
    ...[60,300,600,1800].map(v=>h('option',{value:v,text:`${v}× travel`})));
  acceleration.value='600';
  const pause=h('button',{class:'btn',text:'Stop',onclick:()=>{app.ground.stop('Travel paused.');sync();}});
  const wait=h('button',{class:'btn',text:'+1 h',title:'Wait one hour in the world',onclick:()=>{
    app.ground.stop('Waiting');const t=advanceClock(app.settings.timeOfDay,3600);
    app.setSettings({timeOfDay:t,...(app.autoTide?{tide:clockTide(t)}:{})});sync();
  }});
  const journey=h('span',{class:'journey'});
  const travelControls=h('div',{class:'group'},acceleration,pause,journey);
  const hexes=h('button',{class:'btn',text:'Hexes',onclick:()=>{app.setSettings({hexGrid:!app.settings.hexGrid});sync();}});
  const labels=h('button',{class:'btn',text:'Labels',onclick:()=>{app.setSettings({labels:!app.settings.labels});sync();}});
  const debug=h('select',{'aria-label':'Debug view',onchange:()=>app.setSettings({debug:Number(debug.value)})},...DEBUG_NAMES.map((v,i)=>h('option',{value:i,text:i?`debug: ${v}`:'Shaded'})));
  const help = h('div', { class: 'flight-help' });document.getElementById('viewport')!.append(help);
  el.append(title,h('div',{class:'group'},fly,orbit,map,player,visit),h('div',{class:'group'},hexes,labels,debug),
    h('div',{class:'group'},h('label',{class:'inline'},'Flight',speed),h('label',{class:'inline'},'Time',sun,sunText),wait,seaControl,tideControl),travelControls);
  function sync() {
    title.textContent=store.world.meta.name;
    fly.classList.toggle('on',app.freeFlight.enabled&&!app.settings.mapMode);
    orbit.classList.toggle('on',!app.freeFlight.enabled&&!app.settings.mapMode&&!app.ground.enabled);
    player.classList.toggle('on',app.ground.enabled);map.classList.toggle('on',app.settings.mapMode);
    hexes.classList.toggle('on',app.settings.hexGrid);labels.classList.toggle('on',app.settings.labels);
    seaControl.hidden=tideControl.hidden=!store.world.environment?.tide;
    tideAuto.checked=app.autoTide;sea.value=String(app.settings.tide);sun.value=String(app.settings.timeOfDay);
    const mins=Math.floor(app.settings.timeOfDay*60)%1440;
    sunText.textContent=`${Math.floor(mins/60).toString().padStart(2,'0')}:${(mins%60).toString().padStart(2,'0')}`;
    travelControls.hidden=!app.ground.enabled;
    const minutes=Math.floor(app.ground.elapsedSeconds/60);
    journey.textContent=`${app.ground.distanceKm.toFixed(2)} km · ${Math.floor(minutes/60)}h ${minutes%60}m · ${app.ground.message||'4 km/h march'}`;
    help.hidden=app.settings.mapMode||(!app.freeFlight.enabled&&!app.ground.enabled);
    help.textContent=app.ground.enabled?'Drag to look · Click ground to travel at 4 km/h · Esc or Stop to pause':app.freeFlight.locked?'WASD fly · Space ↑ · Shift ↓ · Ctrl faster · Esc release mouse':'Click the landscape to fly · Mouse look · WASD · Space ↑ · Shift ↓ · Ctrl faster';
  }
  function rebuild(){visit.replaceChildren(h('option',{value:'',text:'Visit…'}),...Object.keys(store.world.meta.views??{}).map(k=>h('option',{value:k,text:k.replaceAll('-',' ')})));sync();}
  app.freeFlight.onChange=sync;store.subscribe(()=>queueMicrotask(rebuild));
  const previous=app.onFrame;let elapsed=0;
  app.onFrame=dt=>{previous(dt);elapsed+=dt;if(elapsed>.15){elapsed=0;sync();}};
  app.controls.enabled=false;rebuild();
}
