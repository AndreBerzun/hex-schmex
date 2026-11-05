// Ops panel (filled in for M2).
import type { App } from '../app/app';
import type { Store } from '../app/store';
import { h } from './dom';

export function mountOpsPanel(el: HTMLElement, _app: App, store: Store) {
  const render = () => {
    el.replaceChildren(h('div', { class: 'panel-head' }, h('h2', { text: `Ops (${store.world.ops.length})` })),
      h('ul', { class: 'op-list' }, ...store.world.ops.map((o) => h('li', { class: 'op' }, h('span'), h('span'), h('span', { class: 'op-label', text: o.label }), h('span', { class: 'op-type', text: o.type })))));
  };
  store.subscribe(render);
  render();
}
