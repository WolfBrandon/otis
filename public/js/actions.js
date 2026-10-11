// Editor actions shared by menus, keyboard shortcuts and panels.

import { state, emit, mutate, find, selected, select, activeLayer, undo, redo } from './state.js';
import { makeLayer, makeGroup, makeText, bounds, unionBounds, translate, cloneObject, walk } from './model.js';
import { compositeObjects } from './composite.js';
import { toast } from './ui.js';

export { undo, redo };

// The active layer if it can be drawn on, else null (with a hint).
export function writableLayer() {
  const l = activeLayer();
  if (!l.visible) { toast(`Layer “${l.name}” is hidden — show it to draw on it.`); return null; }
  if (l.locked) { toast(`Layer “${l.name}” is locked — unlock it to draw on it.`); return null; }
  return l;
}

export function deleteSelection() {
  if (!state.selection.length) return;
  const ids = new Set(state.selection);
  mutate(p => { for (const l of p.layers) l.objects = l.objects.filter(o => !ids.has(o.id) || l.locked); });
  select([]);
}

export function selectAll() {
  const ids = [];
  for (const l of state.project.layers) if (l.visible && !l.locked) ids.push(...l.objects.filter(o => !o.hidden).map(o => o.id));
  select(ids);
}

export function duplicate(dx = 1, dy = 1) {
  const sel = selected();
  if (!sel.length) return;
  const ids = [];
  mutate(() => {
    for (const o of sel) {
      const { layer, index } = find(o.id);
      const c = cloneObject(o);
      translate(c, dx, dy);
      layer.objects.splice(index + 1, 0, c);
      ids.push(c.id);
    }
  });
  select(ids);
}

export function nudge(dx, dy) {
  if (!state.selection.length) return;
  mutate(() => selected().forEach(o => translate(o, dx, dy)), { coalesce: 'nudge' });
}

// Selected objects in drawing order (bottom layer first).
function orderedSelection() {
  const ids = new Set(state.selection);
  return state.project.layers.flatMap(l => l.objects.filter(o => ids.has(o.id)));
}

export function group() {
  const objs = orderedSelection();
  if (objs.length < 2) return toast('Select two or more objects to group them.');
  const g = makeGroup([]);
  mutate(() => {
    const top = find(objs[objs.length - 1].id);
    const layer = top.layer;
    let at = top.index;
    for (const o of objs) {
      const hit = find(o.id);
      if (hit.layer === layer && hit.index < at) at--;
      hit.layer.objects.splice(hit.index, 1);
      g.children.push(o);
    }
    layer.objects.splice(at, 0, g);
  });
  select([g.id]);
}

export function ungroup() {
  const groups = selected().filter(o => o.type === 'group');
  if (!groups.length) return;
  const ids = [];
  mutate(() => {
    for (const g of groups) {
      const { layer, index } = find(g.id);
      layer.objects.splice(index, 1, ...g.children);
      ids.push(...g.children.map(c => c.id));
    }
  });
  select(ids);
}

// z-order inside each object's layer: +1 forward, -1 backward, Infinity front, -Infinity back
export function arrange(step) {
  const sel = selected();
  if (!sel.length) return;
  mutate(() => {
    const list = step > 0 ? [...sel].reverse() : sel;
    for (const o of list) {
      const { layer, index } = find(o.id);
      const n = layer.objects.length;
      const to = step === Infinity ? n - 1 : step === -Infinity ? 0 : Math.max(0, Math.min(n - 1, index + step));
      layer.objects.splice(index, 1);
      layer.objects.splice(to, 0, o);
    }
  });
}

// Align to each other, or a single object to the canvas.
export function align(mode) {
  const sel = selected();
  if (!sel.length) return;
  const p = state.project;
  const ref = sel.length > 1 ? unionBounds(sel.map(bounds)) : { x: 0, y: 0, w: p.cols, h: p.rows };
  mutate(() => sel.forEach(o => {
    const b = bounds(o);
    let dx = 0, dy = 0;
    if (mode === 'left') dx = ref.x - b.x;
    if (mode === 'right') dx = ref.x + ref.w - (b.x + b.w);
    if (mode === 'hcenter') dx = ref.x + Math.floor((ref.w - b.w) / 2) - b.x;
    if (mode === 'top') dy = ref.y - b.y;
    if (mode === 'bottom') dy = ref.y + ref.h - (b.y + b.h);
    if (mode === 'vcenter') dy = ref.y + Math.floor((ref.h - b.h) / 2) - b.y;
    translate(o, dx, dy);
  }));
}

export function moveToLayer(layerId) {
  const sel = orderedSelection();
  mutate(p => {
    const dest = p.layers.find(l => l.id === layerId);
    for (const o of sel) {
      const hit = find(o.id);
      if (hit.layer === dest) continue;
      hit.layer.objects.splice(hit.index, 1);
      dest.objects.push(o);
    }
  });
  state.activeLayerId = layerId;
  emit('selection');
}

// Move top-level objects to a layer (the Layers panel's drag and drop).
// `place` is { above: id } or { below: id } to put them next to an object
// there; without it they go on top of the layer. Objects keep their
// stacking order; locked layers are left alone.
export function moveObjects(ids, layerId, place = null) {
  const dest = state.project.layers.find(l => l.id === layerId);
  if (!dest || dest.locked) return;
  const moving = state.project.layers.flatMap(l => l.locked ? [] : l.objects.filter(o => ids.includes(o.id)));
  const ref = place?.above ?? place?.below;
  if (!moving.length || moving.some(o => o.id === ref)) return;
  mutate(p => {
    for (const l of p.layers) l.objects = l.objects.filter(o => !moving.includes(o));
    const i = ref ? dest.objects.findIndex(o => o.id === ref) : -1;
    const at = i < 0 ? dest.objects.length : place.above ? i + 1 : i;
    dest.objects.splice(at, 0, ...moving);
  });
  state.activeLayerId = dest.id;
  select(moving.map(o => o.id));
}

export function deleteObject(id) {
  const hit = find(id);
  if (!hit || hit.layer.locked) return;
  mutate(() => hit.layer.objects.splice(hit.index, 1));
  if (state.selection.includes(id)) select(state.selection.filter(s => s !== id));
}

// An empty name goes back to the automatic one ("Box “Title”", "Text"…).
export function renameObject(id, name) {
  const hit = find(id);
  if (hit) mutate(() => { hit.obj.name = name.trim(); });
}

// ── Layers ───────────────────────────────────────────────────────────────────

export function addLayer() {
  const l = makeLayer(`Layer ${state.project.layers.length + 1}`);
  mutate(p => {
    const i = p.layers.findIndex(x => x.id === state.activeLayerId);
    p.layers.splice(i + 1, 0, l);
  });
  state.activeLayerId = l.id;
  select([]);
}

export function duplicateLayer() {
  const src = activeLayer();
  const l = { ...makeLayer(src.name + ' copy'), visible: src.visible, objects: src.objects.map(cloneObject) };
  mutate(p => p.layers.splice(p.layers.indexOf(src) + 1, 0, l));
  state.activeLayerId = l.id;
  emit('selection');
}

export function deleteLayer() {
  const p = state.project;
  if (p.layers.length < 2) return toast('A project needs at least one layer.');
  const l = activeLayer();
  const i = p.layers.indexOf(l);
  mutate(p => p.layers.splice(i, 1));
  state.activeLayerId = p.layers[Math.max(0, i - 1)].id;
  select([]);
}

export function moveLayer(step) {
  const p = state.project;
  const l = activeLayer();
  const i = p.layers.indexOf(l), to = i + step;
  if (to < 0 || to >= p.layers.length) return;
  mutate(p => { p.layers.splice(i, 1); p.layers.splice(to, 0, l); });
}

// ── Insert / clipboard ───────────────────────────────────────────────────────

let renderer = null;
export function setRenderer(r) { renderer = r; }

// Top-left cell that centers a w×h block in the visible part of the canvas.
export function viewCenterCell(w = 0, h = 0) {
  const p = state.project;
  let cx = Math.floor(p.cols / 2), cy = Math.floor(p.rows / 2);
  if (renderer) {
    const r = renderer.canvas.getBoundingClientRect();
    const c = renderer.clientToCell(r.left + r.width / 2, r.top + r.height / 2);
    cx = Math.max(0, Math.min(p.cols - 1, c.x));
    cy = Math.max(0, Math.min(p.rows - 1, c.y));
  }
  return {
    x: Math.max(0, Math.min(p.cols - w, cx - Math.floor(w / 2))),
    y: Math.max(0, Math.min(p.rows - h, cy - Math.floor(h / 2))),
  };
}

// Insert copies of `objects` (any coordinates) with their top-left at `at`.
// More than one object becomes a group so it moves as a unit.
export function insertObjects(objects, at = null, { groupName = '' } = {}) {
  const layer = writableLayer();
  if (!layer || !objects.length) return null;
  const copies = objects.map(cloneObject);
  const b = unionBounds(copies.map(bounds));
  at ||= viewCenterCell(b.w, b.h);
  copies.forEach(c => translate(c, at.x - b.x, at.y - b.y));
  const obj = copies.length > 1 ? makeGroup(copies, { name: groupName }) : copies[0];
  if (copies.length === 1 && groupName && !obj.name) obj.name = groupName;
  mutate(() => layer.objects.push(obj));
  select([obj.id]);
  return obj;
}

// Selection as plain text, cropped to the selection.
export function selectionText() {
  const sel = selected();
  if (!sel.length) return '';
  const p = state.project;
  const grid = compositeObjects(sel, p.cols, p.rows, p.mergeJunctions !== false);
  const b = unionBounds(sel.map(bounds));
  const x1 = Math.max(0, b.x), y1 = Math.max(0, b.y);
  const x2 = Math.min(p.cols, b.x + b.w), y2 = Math.min(p.rows, b.y + b.h);
  const lines = [];
  for (let r = y1; r < y2; r++) {
    let s = '';
    for (let c = x1; c < x2; c++) s += grid.ch[r * p.cols + c] ?? ' ';
    lines.push(s.replace(/ +$/, ''));
  }
  return lines.join('\n');
}

let clip = null;   // { text, objects, pastes }

export function copySelection(cut = false) {
  const sel = orderedSelection();
  if (!sel.length) return null;
  const text = selectionText();
  clip = { text, objects: structuredClone(sel), pastes: 0 };
  if (cut) deleteSelection();
  return text;
}

export function paste(text) {
  if (clip && (text == null || text === clip.text)) {
    clip.pastes++;
    const b = unionBounds(clip.objects.map(bounds));
    const ids = [];
    const layer = writableLayer();
    if (!layer) return;
    mutate(() => {
      for (const o of clip.objects) {
        const c = cloneObject(o);
        translate(c, clip.pastes, clip.pastes);
        layer.objects.push(c);
        ids.push(c.id);
      }
    });
    select(ids);
    return b;
  }
  if (!text) return;
  // plain text from outside OTIS (ASCII art, code…) becomes a text object
  const clean = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  const o = makeText(0, 0, clean, { transparent: true });
  insertObjects([o]);
}

export function walkSelected(fn) {
  for (const o of selected()) for (const n of walk([o])) fn(n);
}
