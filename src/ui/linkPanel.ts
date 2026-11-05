// Right panel: link the app to a map file that Claude Code edits through the terrain CLI.
import type { Store } from '../app/store';
import { MapLink } from '../app/mapLink';
import { h } from './dom';
import { slug } from './toolbar';

export function mountLinkPanel(el: HTMLElement, store: Store, link: MapLink | null) {
  const head = h('div', { class: 'panel-head' }, h('h2', { text: 'Map file' }));
  if (!link) {
    el.replaceChildren(head, h('div', { class: 'link-body' }, h('p', { class: 'muted', text: 'Live file linking needs the dev server (npm run dev). In this build, use Open/Save in the toolbar.' })));
    return;
  }
  const sel = h('select', { title: 'Map files in maps/', onchange: () => {
    if (sel.value === '') link.unlink();
    else void link.link(sel.value).catch((e) => { link.status = String(e); render(); });
  } });
  const newBtn = h('button', { class: 'btn', text: 'Save as map file…', title: 'Write the current world to maps/<name>.json and link to it', onclick: async () => {
    const name = prompt('Map file name (maps/<name>.json):', slug(store.world.meta.name));
    if (!name) return;
    const n = slug(name);
    const existing = await link.list();
    if (existing.includes(n) && !confirm(`maps/${n}.json exists. Overwrite it with the current world?`)) return;
    await link.link(n, { create: true }).catch((e) => { link.status = String(e); });
    await refreshList();
  } });
  const status = h('div', { class: 'link-status' });
  const edits = h('div', { class: 'prompt-history' });
  const help = h('details', { class: 'link-help' },
    h('summary', { text: 'Editing with Claude Code' }),
    h('p', { text: 'Open Claude Code in this repository and ask for terrain changes ("a volcanic island off the west coast of maps/my-marches"). It edits the linked file with the terrain CLI (see TERRAIN_AGENT.md); each edit appears here and in the 3D view as one undoable step.' }),
    h('pre', { text: 'npm run terrain -- context <map>\nnpm run terrain -- map <map> --ops\nnpm run terrain -- add <map> \'{"type":"peak",…}\' --label "…"' }),
  );

  el.replaceChildren(head, h('div', { class: 'link-body' }, h('div', { class: 'link-row' }, sel, newBtn), status, help), edits);

  async function refreshList() {
    const names = await link!.list().catch(() => [] as string[]);
    sel.replaceChildren(h('option', { value: '', text: names.length ? '— not linked —' : '— no map files yet —' }), ...names.map((n) => h('option', { value: n, text: `maps/${n}.json` })));
    sel.value = link!.name ?? '';
  }

  function render() {
    sel.value = link!.name ?? '';
    status.textContent = link!.name ? link!.status : 'Not linked. Pick a map file, or save the current world as one.';
    edits.replaceChildren(...[...link!.edits].reverse().map((e) => h('div', { class: `prompt-entry${e.reverted ? ' reverted' : ''}` },
      h('div', { class: 'p', text: e.label }),
      e.changedOps.length ? h('div', { class: 'chips' }, ...e.changedOps.map((id) => h('span', { class: 'chip', text: id }))) : null,
      h('div', { class: 'meta' }, h('span', { text: new Date(e.at).toLocaleTimeString() + (e.reverted ? ' · reverted' : '') }),
        !e.reverted && e.txId !== undefined ? h('button', { class: 'btn', text: 'Revert', title: 'Undo just this edit (later edits are kept)', onclick: () => link!.revert(e) }) : null),
    )));
  }

  link.onChange(() => { void refreshList(); render(); });
  void refreshList();
  render();
}
