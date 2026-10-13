// App state, undo/redo and a tiny event bus.
//
// Events:
//   'doc'       the project changed (re-composite and redraw)
//   'project'   a different project was loaded
//   'tab'       a different tab is open ({ resized } if its canvas size differs)
//   'selection' selection or active layer changed
//   'tool'      tool or brush changed
//   'view'      pan/zoom/grid changed (redraw only)
//   'library'   snippets or saved palettes changed
//   'dirty'     there are unsaved changes
//   'deleted'   a project was deleted (its id)

import { FORMAT_VERSION, makeProject, makeLayer, walk, fitText, cellFrame } from './model.js';
import { THEMES } from './themes.js';

const listeners = {};
export function on(evt, fn) { (listeners[evt] ||= []).push(fn); }
// A listener that throws is logged, and the others still run.
export function emit(evt, data) {
  for (const fn of listeners[evt] || []) {
    try { fn(data); } catch (e) { console.error(e); }
  }
}

export const state = {
  project: null,
  tabId: null,            // the open tab; each window has its own
  activeLayerId: null,
  selection: [],          // ids of top-level objects
  tool: 'select',
  brush: {
    fg: null, bg: null, glyph: '█', box: 'single', line: 'single', start: 'none', end: 'arrow',
    tableCols: 3, tableRows: 4, tableBorder: 'single', tableRowLines: false,
  },
  view: { zoom: 1, x: 40, y: 40, grid: false, blink: true },
  editing: null,          // { id, caret } while typing into a text object
  library: { snippets: [], palettes: [] },
  dirty: false,
  rev: 0,                 // goes up with every edit, so a save can tell what it missed
};

export function defaultPalette() {
  const t = THEMES.find(t => t.id === 'phosphor-wolf') || THEMES[0];
  return { ...structuredClone(t), source: 'builtin:' + t.id };
}

// Fill in anything an older or hand-written file is missing. Files from
// before tabs (format 1) had one canvas; it becomes the tab "Main".
export function normalizeProject(p) {
  const { tabs: _, ...d } = makeProject();
  const { cols, rows, layers, ...rest } = p;
  p = { ...d, ...rest, otis: FORMAT_VERSION };
  p.font = { ...d.font, ...(p.font || {}) };
  if (!p.palette) p.palette = defaultPalette();
  // older files: link the palette back to the built-in theme it came from
  if (!p.palette.source && THEMES.some(t => t.id === p.palette.id)) p.palette.source = 'builtin:' + p.palette.id;
  if (!Array.isArray(p.tabs) || !p.tabs.length) p.tabs = [{ id: 'main', name: 'Main', cols, rows, layers }];
  p.tabs.forEach((t, i) => {
    t.id = String(t.id || (i ? 'tab' + (i + 1) : 'main'));
    t.name ||= i ? `Tab ${i + 1}` : 'Main';
    t.cols ||= 100;
    t.rows ||= 30;
    if (!Array.isArray(t.layers) || !t.layers.length) t.layers = [makeLayer('Layer 1')];
    for (const l of t.layers) {
      l.objects ||= [];
      l.visible ??= true;
      l.locked ??= false;
      for (const o of walk(l.objects)) {
        o.attrs ||= {};
        if ((o.type === 'text' || o.type === 'box') && o.autoSize) fitText(o);
      }
    }
  });
  return p;
}

// ── Project + history ────────────────────────────────────────────────────────

const undoStack = [];
const redoStack = [];
let gestureStart = null;
let lastCoalesce = null;

export function setProject(p) {
  state.project = normalizeProject(p);
  state.tabId = state.project.tabs[0].id;
  tabLayers.clear();
  state.activeLayerId = defaultLayerId();
  state.selection = [];
  state.editing = null;
  undoStack.length = redoStack.length = 0;
  gestureStart = lastCoalesce = null;
  state.dirty = false;
  emit('project');
  emit('doc');
  emit('selection');
}

function snapshot() { return JSON.stringify(state.project); }

function pushUndo(snap) {
  undoStack.push(snap);
  if (undoStack.length > 300) undoStack.shift();
  redoStack.length = 0;
}

export function markDirty() {
  state.rev++;
  state.dirty = true;
  emit('dirty');
}

// One-shot change: mutate(p => { ... }). Pass `coalesce` (a string) to fold a
// run of changes with the same key (typing in a field) into one undo step.
export function mutate(fn, { coalesce = null } = {}) {
  const before = snapshot();
  fn(state.project);
  const after = snapshot();
  if (before === after) return;
  if (!(coalesce && coalesce === lastCoalesce) && !gestureStart) pushUndo(before);
  lastCoalesce = coalesce;
  markDirty();
  emit('doc');
}

// Gestures (drags, typing sessions) record one undo step for many changes.
export function beginGesture() {
  if (!gestureStart) gestureStart = snapshot();
  lastCoalesce = null;
}
export function changed() { markDirty(); emit('doc'); }
export function endGesture() {
  if (gestureStart && gestureStart !== snapshot()) pushUndo(gestureStart);
  gestureStart = null;
}

export const gestureActive = () => !!gestureStart;

// Swap in a newer copy of the open project, saved by the AI or another
// window. The version being replaced goes on the undo stack, so Ctrl+Z
// brings it back.
export function replaceProject(p) {
  if (state.editing) stopEditing();
  endGesture();
  pushUndo(snapshot());
  const was = activeTab();
  state.project = normalizeProject(p);
  keepTab(was);
  lastCoalesce = null;
  state.dirty = false;
  emit('doc');
  emit('selection');
}

// After the project was swapped out: stay on the open tab if it still
// exists, and drop selections and layers that are gone.
function keepTab(was, to = state.tabId) {
  const tabs = state.project.tabs;
  state.tabId = tabs.some(t => t.id === to) ? to : tabs[0].id;
  const tab = activeTab();
  const ids = new Set(tab.layers.flatMap(l => l.objects.map(o => o.id)));
  state.selection = state.selection.filter(id => ids.has(id));
  if (!tab.layers.some(l => l.id === state.activeLayerId)) state.activeLayerId = defaultLayerId();
  if (tab.id !== was.id) emit('tab', { resized: tab.cols !== was.cols || tab.rows !== was.rows });
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

// Undo and redo show where the change was: if the open tab didn't change but
// another one did, that tab opens.
function restore(snap) {
  const was = activeTab();
  const old = new Map(state.project.tabs.map(t => [t.id, JSON.stringify(t)]));
  state.project = JSON.parse(snap);
  const changed = t => JSON.stringify(t) !== old.get(t.id);
  const here = state.project.tabs.find(t => t.id === state.tabId);
  let to = state.tabId;
  if (!here || !changed(here)) to = state.project.tabs.find(changed)?.id ?? to;
  if (to !== state.tabId) state.selection = [];
  keepTab(was, to);
  state.editing = null;
  lastCoalesce = null;
  markDirty();
  emit('doc');
  emit('selection');
}
export function undo() {
  endGesture();
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
}
export function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

// The open tab: its canvas size and layers are what the editor shows.
export function activeTab() {
  const tabs = state.project.tabs;
  return tabs.find(t => t.id === state.tabId) || tabs[0];
}

const tabLayers = new Map();   // the active layer each tab had when you left it

function defaultLayerId() {
  const layers = activeTab().layers;
  return ([...layers].reverse().find(l => l.visible && !l.locked) || layers[layers.length - 1]).id;
}

// Open another tab. This isn't a change to the project, so it isn't saved
// or undone; other windows stay on their own tab.
export function switchTab(id) {
  const was = activeTab();
  if (id === was.id || !state.project.tabs.some(t => t.id === id)) return;
  if (state.editing) stopEditing();
  endGesture();
  tabLayers.set(was.id, state.activeLayerId);
  state.tabId = id;
  state.selection = [];
  const tab = activeTab();
  const remembered = tabLayers.get(id);
  state.activeLayerId = tab.layers.some(l => l.id === remembered) ? remembered : defaultLayerId();
  lastCoalesce = null;
  emit('tab', { resized: tab.cols !== was.cols || tab.rows !== was.rows });
  emit('doc');
  emit('selection');
}

// ── Lookups ──────────────────────────────────────────────────────────────────

export function activeLayer() {
  const layers = activeTab().layers;
  return layers.find(l => l.id === state.activeLayerId) || layers[layers.length - 1];
}

// Top-level object by id → { obj, layer, index }
export function find(id) {
  for (const layer of activeTab().layers) {
    const index = layer.objects.findIndex(o => o.id === id);
    if (index >= 0) return { obj: layer.objects[index], layer, index };
  }
  return null;
}

// Any object by id, including ones inside groups →
// { obj, layer, top (its top-level object), list (the array holding it) }
export function findDeep(id) {
  const search = (list, layer, top) => {
    for (const o of list) {
      if (o.id === id) return { obj: o, layer, top: top || o, list };
      if (o.type === 'group') { const r = search(o.children, layer, top || o); if (r) return r; }
    }
    return null;
  };
  for (const layer of activeTab().layers) { const r = search(layer.objects, layer, null); if (r) return r; }
  return null;
}

export function selected() {
  return state.selection.map(id => find(id)?.obj).filter(Boolean);
}

export function select(ids, { add = false } = {}) {
  ids = ids.filter(Boolean);
  state.selection = add ? [...new Set([...state.selection, ...ids])] : ids;
  const first = ids.length ? find(ids[ids.length - 1]) : null;
  if (first) state.activeLayerId = first.layer.id;
  emit('selection');
}

export function setTool(tool) {
  if (state.editing) stopEditing();
  state.tool = tool;
  emit('tool');
}

export function setBrush(patch) {
  Object.assign(state.brush, patch);
  emit('tool');
}

// ── Text editing session ─────────────────────────────────────────────────────

// `id` may be a text object inside a group; the group stays selected.
// For a table, `cell` is [row, col].
export function startEditing(id, caret = null, cell = null) {
  const hit = findDeep(id);
  if (!hit || hit.layer.locked) return;
  if (state.editing?.id === id) {
    if (cell) state.editing.cell = cell;
    state.editing.caret = caret ?? Array.from(editTarget().frame.text).length;
    emit('view');
    return;
  }
  if (state.editing) stopEditing();
  beginGesture();
  if (hit.obj.type === 'table') cell ||= [0, 0];
  state.editing = { id, caret: 0, cell };
  state.editing.caret = caret ?? Array.from(editTarget().frame.text).length;
  select([hit.top.id]);
  emit('view');
}

// What's being typed into: { obj, frame, setText }. `frame` has the text
// object fields (x, y, w, h, text, align…); for a table cell it's a stand-in.
export function editTarget() {
  const ed = state.editing;
  const hit = ed && findDeep(ed.id);
  if (!hit) return null;
  const o = hit.obj;
  if (o.type === 'table') {
    const [r, c] = ed.cell || [0, 0];
    return { obj: o, frame: cellFrame(o, r, c), setText: t => { o.cells[r][c] = t; } };
  }
  return { obj: o, frame: o, setText: t => { o.text = t; if (o.autoSize) fitText(o); } };
}

export function stopEditing() {
  const ed = state.editing;
  if (!ed) return;
  state.editing = null;
  const hit = findDeep(ed.id);
  // an empty, borderless text object is just removed
  if (hit && hit.obj.type === 'text' && !hit.obj.text && (!hit.obj.border || hit.obj.border === 'none')) {
    hit.list.splice(hit.list.indexOf(hit.obj), 1);
    state.selection = state.selection.filter(s => s !== ed.id);
    changed();
  }
  endGesture();
  emit('selection');
  emit('view');
}
