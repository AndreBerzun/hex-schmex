// Hover readout, bake status and frame stats.
import type { App } from '../app/app';
import { h } from './dom';

export function mountHud(app: App) {
  const hover = document.getElementById('hover')!;
  const status = document.getElementById('status')!;
  const stats = document.getElementById('stats')!;
  const label = h('span', { text: '' });
  const bar = h('i');
  status.append(label, h('div', { class: 'bar' }, bar));

  app.onHover = (s) => {
    if (!s) { hover.classList.add('hidden'); return; }
    hover.classList.remove('hidden');
    hover.replaceChildren(
      h('div', { class: 'hid', text: `Hex ${s.id}` }),
      h('div', { text: `elev  ${Math.round(s.minM)}–${Math.round(s.maxM)} m` }),
      h('div', { text: `mean  ${Math.round(s.meanM)} m` }),
      h('div', { text: `slope ${s.meanSlopeDeg.toFixed(1)}°` }),
      h('div', { text: `cover ${s.dominant}${s.water > 0.05 ? ` · ${Math.round(s.water * 100)}% water` : ''}` }),
      h('div', { text: `moist ${s.moisture.toFixed(2)}` }),
    );
  };

  const setStatus = (stage: string, info: string) => {
    const er = app.erosion;
    if (stage === 'ready') {
      label.textContent = 'ready';
      bar.style.width = '100%';
      status.style.opacity = '0.55';
    } else {
      status.style.opacity = '1';
      label.textContent = info || stage;
      bar.style.width = stage === 'eroding' && er ? `${Math.round(er.progress * 100)}%` : stage === 'hydrology' ? '100%' : '8%';
    }
    if (stage === 'error') label.textContent = `error: ${info.slice(0, 120)}`;
  };
  app.onStage = setStatus;
  setStatus(app.stage, app.stageInfo);

  let acc = 0;
  app.onFrame = (dt) => {
    acc += dt;
    if (acc < 0.5) return;
    acc = 0;
    const t = app.timings;
    const cam = app.camera.position;
    const agl = (cam.y / (0.001 * app.settings.exag) - app.surfaceAt(cam.x, cam.z)) / 1000;
    stats.textContent = `${app.frameGpuMs.toFixed(1)} ms gpu · ${app.terrain.nodeCount} patches · alt ${agl.toFixed(1)} km` +
      (t.evaluate ? ` · ops ${t.evaluate.toFixed(0)} ms` : '') +
      (t.erosion ? ` · erosion ${(t.erosion / 1000).toFixed(1)} s` : '') +
      (t.hydrology ? ` · hydro ${t.hydrology.toFixed(0)} ms` : '');
  };
}
