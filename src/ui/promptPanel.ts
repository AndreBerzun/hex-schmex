// Prompt panel (filled in for M5).
import type { App } from '../app/app';
import type { Store } from '../app/store';
import { h } from './dom';

export function mountPromptPanel(el: HTMLElement, _app: App, _store: Store) {
  el.replaceChildren(h('div', { class: 'panel-head' }, h('h2', { text: 'Prompt' })), h('div', { class: 'empty', text: 'Coming in M5.' }));
}
