// Sidebar panels: collapsible, closable, drag to reorder, drag to resize.
// Slim mode has one column, Wide mode two. The layout is a per-browser
// preference kept in localStorage.

import { el, $ } from './ui.js';
import { icon } from './icons.js';

export const PANELS = [
  { id: 'props', title: 'Properties' },
  { id: 'layers', title: 'Layers' },
  { id: 'palette', title: 'Palette' },
  { id: 'glyphs', title: 'Glyphs' },
  { id: 'snippets', title: 'Snippets' },
];
const IDS = PANELS.map(p => p.id);

const DEFAULT = {
  v: 1,
  mode: 'slim',
  width: { slim: 300, wide: 600 },
  cols: {
    slim: [['props', 'layers', 'palette', 'glyphs', 'snippets']],
    wide: [['props', 'layers'], ['palette', 'snippets', 'glyphs']],
  },
  collapsed: ['glyphs', 'snippets'],
  closed: [],
  size: { props: 1.4, layers: 0.8, palette: 1, glyphs: 1, snippets: 1.2 },
};

let L = load();
const sections = {};
const listeners = [];
export const onLayout = fn => listeners.push(fn);

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem('otis:layout') || 'null');
    if (saved?.v === 1) {
      const l = { ...structuredClone(DEFAULT), ...saved };
      // make sure every panel appears exactly once in each mode
      for (const mode of ['slim', 'wide']) {
        const seen = new Set(l.cols[mode].flat());
        for (const id of IDS) if (!seen.has(id)) l.cols[mode][l.cols[mode].length - 1].push(id);
        l.cols[mode] = l.cols[mode].map(c => c.filter(id => IDS.includes(id)));
      }
      return l;
    }
  } catch {}
  return structuredClone(DEFAULT);
}

function save() {
  try { localStorage.setItem('otis:layout', JSON.stringify(L)); } catch {}
}

export const layout = () => L;
export const isOpen = id => !L.closed.includes(id);
export const isCollapsed = id => L.collapsed.includes(id);

export function setMode(mode) {
  L.mode = mode;
  apply();
}

export function togglePanel(id, open = !isOpen(id)) {
  L.closed = L.closed.filter(x => x !== id);
  if (!open) L.closed.push(id);
  else L.collapsed = L.collapsed.filter(x => x !== id);
  apply();
}

export function toggleCollapsed(id, collapsed = !isCollapsed(id)) {
  L.collapsed = L.collapsed.filter(x => x !== id);
  if (collapsed) L.collapsed.push(id);
  apply();
}

// Open, expand and scroll a panel into view.
export function showPanel(id) {
  L.closed = L.closed.filter(x => x !== id);
  L.collapsed = L.collapsed.filter(x => x !== id);
  apply();
  sections[id]?.scrollIntoView({ block: 'nearest' });
}

export function resetLayout() {
  L = structuredClone(DEFAULT);
  apply();
}

// A panel's content element. It exists even while the panel is closed (and
// out of the page), so panels can keep rendering into it.
export const panelBody = id => sections[id]?.querySelector('.panel-body') || null;

// Panel modules set their own header title and action buttons.
export function setHeader(id, title, actions = []) {
  const s = sections[id];
  if (!s) return;
  s.querySelector('.panel-title').textContent = title;
  s.querySelector('.panel-actions').replaceChildren(...actions);
}

function build(p) {
  const head = el('header.panel-head', { title: 'Drag to move · double-click to collapse' },
    el('button.icon.twist', { type: 'button', title: 'Collapse / expand', onclick: () => toggleCollapsed(p.id) }, icon('chevron', 14)),
    el('h3.panel-title', {}, p.title),
    el('div.panel-actions'),
    el('button.icon.panel-close', { type: 'button', title: `Close ${p.title} (reopen from the View menu)`, onclick: () => togglePanel(p.id, false) }, icon('close', 14)),
  );
  head.addEventListener('dblclick', e => { if (!e.target.closest('button')) toggleCollapsed(p.id); });
  head.addEventListener('pointerdown', e => startMove(e, p.id));
  const s = el('section.panel', { id: 'panel-' + p.id }, head, el('div.panel-body', { id: p.id }));
  sections[p.id] = s;
}

function apply() {
  const root = $('#sidebar');
  const cols = L.cols[L.mode];
  const open = cols.flat().filter(isOpen);
  document.documentElement.style.setProperty('--sidebar-w', open.length ? L.width[L.mode] + 'px' : '0px');
  root.classList.toggle('empty', !open.length);
  root.dataset.mode = L.mode;
  const colEls = cols.map(list => {
    const col = el('div.col');
    let prev = null;
    for (const id of list) {
      if (!isOpen(id)) continue;
      const s = sections[id];
      const collapsed = isCollapsed(id);
      s.classList.toggle('collapsed', collapsed);
      s.style.flexGrow = collapsed ? '' : String(L.size[id] ?? 1);
      if (prev) col.append(splitter());
      col.append(s);
      prev = s;
    }
    if (!col.children.length) col.append(el('div.col-empty', {}, 'Drag panels here'));
    return col;
  });
  root.querySelector('.sidebar-cols').replaceChildren(...colEls);
  document.querySelectorAll('#sidebar-mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === L.mode));
  save();
  listeners.forEach(fn => fn(L));
}

// ── Resizing ─────────────────────────────────────────────────────────────────

function splitter() {
  const sp = el('div.splitter', { title: 'Drag to resize' });
  sp.addEventListener('pointerdown', e => {
    e.preventDefault();
    // the nearest expanded panels above and below
    const find = dir => {
      let n = sp;
      while ((n = dir < 0 ? n.previousElementSibling : n.nextElementSibling))
        if (n.classList.contains('panel') && !n.classList.contains('collapsed')) return n;
      return null;
    };
    const a = find(-1), b = find(1);
    if (!a || !b) return;
    // weights become pixel heights so the drag maps 1:1 to the mouse
    // (measure every panel first, then set — setting one changes the others)
    const open = [...sp.parentElement.querySelectorAll('.panel:not(.collapsed)')];
    const heights = open.map(s => s.getBoundingClientRect().height);
    open.forEach((s, i) => { s.style.flexGrow = String(heights[i]); L.size[s.id.slice(6)] = heights[i]; });
    const ha = a.getBoundingClientRect().height, hb = b.getBoundingClientRect().height, y0 = e.clientY;
    sp.setPointerCapture(e.pointerId);
    sp.classList.add('active');
    const move = ev => {
      const dy = Math.max(60 - ha, Math.min(hb - 60, ev.clientY - y0));
      L.size[a.id.slice(6)] = ha + dy;
      L.size[b.id.slice(6)] = hb - dy;
      a.style.flexGrow = String(ha + dy);
      b.style.flexGrow = String(hb - dy);
    };
    const up = () => {
      sp.classList.remove('active');
      sp.removeEventListener('pointermove', move);
      sp.removeEventListener('pointerup', up);
      // back from pixels to weights that average 1, so a collapsed panel
      // expanded later (default weight ~1) gets a fair share
      const mean = heights.reduce((a, h) => a + h, 0) / open.length;
      for (const s of open) L.size[s.id.slice(6)] = +(L.size[s.id.slice(6)] / mean).toFixed(3);
      apply();
    };
    sp.addEventListener('pointermove', move);
    sp.addEventListener('pointerup', up);
  });
  return sp;
}

function widthResizer() {
  const r = el('div.sidebar-resizer', { title: 'Drag to resize the sidebar' });
  r.addEventListener('pointerdown', e => {
    e.preventDefault();
    const w0 = L.width[L.mode], x0 = e.clientX;
    const [min, max] = L.mode === 'wide' ? [420, 1100] : [220, 640];
    r.setPointerCapture(e.pointerId);
    r.classList.add('active');
    const move = ev => {
      L.width[L.mode] = Math.round(Math.max(min, Math.min(max, w0 - (ev.clientX - x0))));
      document.documentElement.style.setProperty('--sidebar-w', L.width[L.mode] + 'px');
    };
    const up = () => {
      r.classList.remove('active');
      r.removeEventListener('pointermove', move);
      r.removeEventListener('pointerup', up);
      save();
    };
    r.addEventListener('pointermove', move);
    r.addEventListener('pointerup', up);
  });
  return r;
}

// ── Reordering ───────────────────────────────────────────────────────────────

function startMove(e, id) {
  if (e.button !== 0 || e.target.closest('button, input, select')) return;
  const head = e.currentTarget;
  const x0 = e.clientX, y0 = e.clientY;
  let ghost = null, marker = null, target = null;
  head.setPointerCapture(e.pointerId);

  // Which column, and which panel to insert before, for a pointer position.
  const dropTarget = (x, y) => {
    const cols = [...document.querySelectorAll('#sidebar .col')];
    let ci = cols.findIndex(c => { const r = c.getBoundingClientRect(); return x >= r.left && x < r.right; });
    if (ci < 0) ci = x < cols[0].getBoundingClientRect().left ? 0 : cols.length - 1;
    const cr = cols[ci].getBoundingClientRect();
    const panels = [...cols[ci].querySelectorAll('.panel')].filter(p => p.id !== 'panel-' + id);
    let before = null;
    let lineY = panels.length ? panels[panels.length - 1].getBoundingClientRect().bottom : cr.top;
    for (const p of panels) {
      const r = p.getBoundingClientRect();
      if (y < r.top + r.height / 2) { before = p.id.slice(6); lineY = r.top; break; }
    }
    const list = L.cols[L.mode][ci].filter(x => x !== id);
    return { ci, pos: before ? list.indexOf(before) : list.length, lineY, left: cr.left, width: cr.width };
  };

  const move = ev => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      ghost = el('div.panel-ghost', {}, head.querySelector('.panel-title').textContent);
      marker = el('div.drop-marker');
      document.body.append(ghost, marker);
      sections[id].classList.add('moving');
    }
    ghost.style.left = ev.clientX + 12 + 'px';
    ghost.style.top = ev.clientY + 8 + 'px';
    target = dropTarget(ev.clientX, ev.clientY);
    Object.assign(marker.style, { left: target.left + 'px', width: target.width + 'px', top: target.lineY - 2 + 'px' });
  };
  const up = () => {
    head.removeEventListener('pointermove', move);
    head.removeEventListener('pointerup', up);
    if (!ghost) return;
    ghost.remove();
    marker.remove();
    sections[id].classList.remove('moving');
    if (target) {
      const cols = L.cols[L.mode].map(c => c.filter(x => x !== id));
      cols[target.ci].splice(target.pos, 0, id);
      L.cols[L.mode] = cols;
      apply();
    }
  };
  head.addEventListener('pointermove', move);
  head.addEventListener('pointerup', up);
}

// ── Setup ────────────────────────────────────────────────────────────────────

export function initSidebar() {
  const root = $('#sidebar');
  PANELS.forEach(build);
  root.replaceChildren(widthResizer(), el('div.sidebar-cols'));
  document.querySelectorAll('#sidebar-mode button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  apply();
}
