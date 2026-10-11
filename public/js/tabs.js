// The tab bar above the canvas: one tab per screen of the design. Click to
// open, double-click to rename, drag to reorder, right-click (or ⋯) for more.

import { el, $, confirmDialog } from './ui.js';
import { icon } from './icons.js';
import { state, on, activeTab, switchTab } from './state.js';
import { menuAt } from './library.js';
import * as A from './actions.js';

let renaming = null;     // id of the tab whose name is being edited
let dragging = false;    // no re-render mid-drag
let queued = false;

function queue() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; if (!dragging && !renaming) render(); });
}

// Two clicks on the same tab within 400 ms. (The first click can redraw the
// bar, and then the browser never sends a dblclick.)
let lastClick = { id: null, t: 0 };
function isDoubleClick(id) {
  const now = performance.now();
  const dbl = lastClick.id === id && now - lastClick.t < 400;
  lastClick = dbl ? { id: null, t: 0 } : { id, t: now };
  return dbl;
}

const objectCount = t => t.layers.reduce((n, l) => n + l.objects.length, 0);

async function deleteTab(t) {
  const n = objectCount(t);
  if (n && !(await confirmDialog('Delete tab', `Delete the tab “${t.name}” and the ${n} object${n === 1 ? '' : 's'} on it? Ctrl+Z brings it back.`, 'Delete'))) return;
  A.deleteTab(t.id);
}

function tabMenu(anchor, t) {
  const tabs = state.project.tabs;
  const i = tabs.indexOf(t);
  menuAt(anchor, [
    ['Rename', () => { renaming = t.id; render(); }],
    ['Duplicate', () => A.duplicateTab(t.id)],
    '-',
    ['Move left', () => A.moveTab(t.id, i - 1), i > 0],
    ['Move right', () => A.moveTab(t.id, i + 1), i < tabs.length - 1],
    '-',
    ['Delete', () => deleteTab(t), tabs.length > 1],
  ]);
}

function nameEditor(t) {
  const input = el('input.tab-rename', { type: 'text', value: t.name, spellcheck: false, size: Math.max(4, t.name.length) });
  let done = false;
  const finish = save => {
    if (done) return;
    done = true;
    renaming = null;
    if (save) A.renameTab(t.id, input.value);
    render();
  };
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('input', () => { input.size = Math.max(4, input.value.length); });
  input.addEventListener('blur', () => finish(true));
  requestAnimationFrame(() => { input.focus(); input.select(); });
  return input;
}

// Drag a tab sideways to reorder. Below 5 px it's a click.
function startDrag(e, t, node) {
  if (e.button !== 0 || e.target.closest('button.tab-more, input')) return;
  const x0 = e.clientX;
  let marker = null, to = -1;
  const bar = $('#tabbar');
  const move = ev => {
    if (!marker) {
      if (Math.abs(ev.clientX - x0) < 5) return;
      dragging = true;
      marker = el('div.tab-drop');
      bar.append(marker);
      node.classList.add('moving');
    }
    // the gap nearest the pointer
    const tabs = [...bar.querySelectorAll('.tab')];
    to = tabs.findIndex(n => { const r = n.getBoundingClientRect(); return ev.clientX < r.left + r.width / 2; });
    if (to < 0) to = tabs.length;
    const ref = tabs[to] || tabs[tabs.length - 1];
    const r = ref.getBoundingClientRect(), b = bar.getBoundingClientRect();
    marker.style.left = (tabs[to] ? r.left : r.right) - b.left - 1 + 'px';
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (!marker) return;
    marker.remove();
    dragging = false;
    const from = state.project.tabs.indexOf(t);
    if (to >= 0) A.moveTab(t.id, to > from ? to - 1 : to);
    render();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function render() {
  const p = state.project;
  if (!p) return;
  const open = activeTab();
  const tabs = p.tabs.map(t => {
    const on = t.id === open.id;
    const node = el('div.tab' + (on ? '.on' : ''), {
      role: 'tab', 'aria-selected': on ? 'true' : 'false', title: `${t.name} · ${t.cols}×${t.rows} — double-click to rename, drag to reorder`,
      onclick: e => {
        if (e.target.closest('button, input')) return;
        if (isDoubleClick(t.id)) { renaming = t.id; render(); } else switchTab(t.id);
      },
      oncontextmenu: e => { e.preventDefault(); tabMenu(e.currentTarget, t); },
    },
      renaming === t.id ? nameEditor(t) : el('span.tab-name', {}, t.name),
      el('button.icon.tab-more', { type: 'button', title: 'Tab options', 'aria-label': `Options for ${t.name}`, onclick: e => tabMenu(e.currentTarget, t) }, icon('more', 14)));
    node.addEventListener('pointerdown', e => startDrag(e, t, node));
    return node;
  });
  $('#tabbar').replaceChildren(
    el('div.tabs', { role: 'tablist', 'aria-label': 'Tabs' }, ...tabs),
    el('button.icon.tab-add', { type: 'button', title: 'New tab (the size of the first tab)', 'aria-label': 'New tab', onclick: A.addTab }, icon('plus', 16)));
  $('#tabbar .tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function initTabs() {
  for (const e of ['project', 'tab', 'doc']) on(e, queue);
}
