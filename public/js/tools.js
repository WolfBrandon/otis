// Canvas tools: pointer gestures for each tool, text editing keys, wheel
// pan/zoom and keyboard shortcuts.

import {
  state, emit, on, find, findDeep, selected, select, setTool, beginGesture, endGesture, changed,
  startEditing, stopEditing, editTarget, undo, redo, activeTab, switchTab,
} from './state.js';
import {
  makeBox, makeText, makeLine, makeBlock, makeCursor, makePaint, makeTable,
  tableCellAt, cellFrame, tableEdges, fitTableTo, resizeTable,
  bounds, unionBounds, scaleObjects, translate, hitTest, rectsIntersect, cloneObject, fitText, indexAtCell, caretCell, chars,
} from './model.js';
import * as A from './actions.js';
import { toast } from './ui.js';

let R = null;            // renderer
let gesture = null;      // { move(cell, e), up(cell, e) }
let spaceDown = false;
export const pointer = { x: 0, y: 0, inside: false };
export const commands = {};   // filled in by main.js: save, open, export, help

export const TOOL_KEYS = { v: 'select', b: 'box', t: 'text', a: 'line', l: 'line', '#': 'table', c: 'cursor', k: 'block', p: 'pencil', e: 'eraser', h: 'hand' };

// ── Picking ──────────────────────────────────────────────────────────────────

function layerOf(id) { return find(id)?.layer; }
const pickable = o => { const l = layerOf(o.id); return l && l.visible && !l.locked && !o.hidden; };

// What's under the pointer: the object that owns the visible character there,
// else the topmost object whose box contains the cell.
function pickObject(cell) {
  const grid = R.getGrid();
  const p = activeTab();
  if (cell.x >= 0 && cell.y >= 0 && cell.x < p.cols && cell.y < p.rows) {
    const id = grid.owner[cell.y * p.cols + cell.x];
    const hit = id && find(id);
    if (hit && pickable(hit.obj)) return hit.obj;
  }
  for (let li = p.layers.length - 1; li >= 0; li--) {
    const l = p.layers[li];
    if (!l.visible || l.locked) continue;
    for (let i = l.objects.length - 1; i >= 0; i--) {
      const o = l.objects[i];
      if (!o.hidden && hitTest(o, cell.x, cell.y)) return o;
    }
  }
  return null;
}

// The text, box or table to edit at a cell: the object itself, or for a
// group the topmost editable child under the cell.
function editableAt(o, x, y) {
  if (!o) return null;
  if (o.type === 'text' || o.type === 'box' || o.type === 'table') return o;
  if (o.type !== 'group') return null;
  for (let i = o.children.length - 1; i >= 0; i--) {
    const c = o.children[i];
    if (!c.hidden && hitTest(c, x, y)) { const e = editableAt(c, x, y); if (e) return e; }
  }
  return null;
}

function editAt(o, cell) {
  if (o.art) return commands.textArt?.(o);   // TextArt opens its dialog
  setTool('select');
  if (o.type === 'table') {
    const rc = tableCellAt(o, cell.x, cell.y);
    const f = cellFrame(o, ...rc);
    startEditing(o.id, indexAtCell(f, cell.x - f.x, cell.y - f.y), rc);
  } else startEditing(o.id, indexAtCell(o, cell.x - o.x, cell.y - o.y));
}

// A table column or row edge under the pointer → { kind: 'col', i } | { kind: 'row', j }.
// An edge with a line is grabbed anywhere on that line's cells; an edge that's
// just the gap between two cells only right at the gap, so dragging from
// inside a cell still moves the table.
function tableEdgeAt(o, cell) {
  const E = tableEdges(o);
  const near = (d, e) => e.line ? Math.abs(d) <= 0.5 : Math.abs(d) < 0.2;
  const inY = cell.fy >= o.y && cell.fy <= o.y + E.h, inX = cell.fx >= o.x && cell.fx <= o.x + E.w;
  if (inY) for (const c of E.cols) if (near(cell.fx - c.x, c)) return { kind: 'col', i: c.i };
  if (inX) for (const r of E.rows) if (near(cell.fy - r.y, r)) return { kind: 'row', j: r.j };
  return null;
}

function selectedTable() {
  const sel = selected();
  return sel.length === 1 && sel[0].type === 'table' && !state.editing ? sel[0] : null;
}

function handleAt(e) {
  const r = R.canvas.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  return R.handles().find(h => Math.abs(h.x - x) <= 7 && Math.abs(h.y - y) <= 7) || null;
}

const rectFrom = (a, b) => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1,
});

// Cells on a straight line between two cells (Bresenham), for fast strokes.
function cellsBetween(a, b) {
  const out = [];
  let x = a.x, y = a.y;
  const dx = Math.abs(b.x - x), dy = -Math.abs(b.y - y), sx = x < b.x ? 1 : -1, sy = y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push({ x, y });
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return out;
}

// ── Gestures ─────────────────────────────────────────────────────────────────

function panGesture(e) {
  const start = { x: e.clientX, y: e.clientY, vx: state.view.x, vy: state.view.y };
  R.canvas.classList.add('panning');
  return {
    move(_, ev) {
      state.view.x = start.vx + ev.clientX - start.x;
      state.view.y = start.vy + ev.clientY - start.y;
      emit('view');
    },
    up() { R.canvas.classList.remove('panning'); },
  };
}

function moveGesture(start, duplicate) {
  beginGesture();
  if (duplicate) {
    const ids = [];
    for (const o of selected()) {
      const { layer, index } = find(o.id);
      const c = cloneObject(o);
      layer.objects.splice(index + 1, 0, c);
      ids.push(c.id);
    }
    select(ids);
  }
  let last = start;
  return {
    move(cell) {
      const dx = cell.x - last.x, dy = cell.y - last.y;
      if (!dx && !dy) return;
      selected().forEach(o => translate(o, dx, dy));
      last = cell;
      changed();
    },
    up: endGesture,
  };
}

// The rectangle `b0` with the edges of handle `dir` dragged from `start` to
// `cell`. Handles sit on cell boundaries, so the pointer snaps to the nearest.
function dragRect(b0, dir, start, cell, min) {
  const dx = Math.round(cell.fx) - Math.round(start.fx), dy = Math.round(cell.fy) - Math.round(start.fy);
  let x1 = b0.x, y1 = b0.y, x2 = b0.x + b0.w, y2 = b0.y + b0.h;
  if (dir.includes('w')) x1 = Math.min(x2 - min, b0.x + dx);
  if (dir.includes('e')) x2 = Math.max(x1 + min, x2 + dx);
  if (dir.includes('n')) y1 = Math.min(y2 - min, b0.y + dy);
  if (dir.includes('s')) y2 = Math.max(y1 + min, y2 + dy);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function resizeGesture(h, start) {
  const o = selected()[0];
  beginGesture();
  const b0 = { x: o.x, y: o.y, w: o.w, h: o.h };
  if (o.autoSize) o.autoSize = false;
  const min = o.border && o.border !== 'none' ? 2 : 1;
  return {
    move(cell) { Object.assign(o, dragRect(b0, h.dir, start, cell, min)); changed(); },
    up: endGesture,
  };
}

// Several objects (or a group): stretch everything with the outline around them.
function scaleGesture(h, start) {
  const sel = selected();
  beginGesture();
  const originals = structuredClone(sel);
  const b0 = unionBounds(sel.map(bounds));
  return {
    move(cell) {
      const to = dragRect(b0, h.dir, start, cell, 1);
      scaleObjects(originals, b0, to).forEach((c, i) => Object.assign(sel[i], c));
      changed();
    },
    up: endGesture,
  };
}

// Drag a table edge: that column (or row) grows or shrinks, like a spreadsheet.
function tableEdgeGesture(o, edge, start) {
  beginGesture();
  const key = edge.kind === 'col' ? 'colWidths' : 'rowHeights';
  const idx = edge.kind === 'col' ? edge.i : edge.j;
  const v0 = o[key][idx];
  return {
    move(cell) {
      const d = edge.kind === 'col' ? Math.round(cell.fx - start.fx) : Math.round(cell.fy - start.fy);
      const v = Math.max(1, v0 + d);
      if (v !== o[key][idx]) { o[key][idx] = v; changed(); }
    },
    up: endGesture,
  };
}

function pointGesture(h) {
  const o = selected()[0];
  beginGesture();
  return {
    move(cell) {
      const p = o.points[h.index];
      if (p[0] === cell.x && p[1] === cell.y) return;
      o.points[h.index] = [cell.x, cell.y];
      changed();
    },
    up: endGesture,
  };
}

function marqueeGesture(start, add) {
  const base = add ? [...state.selection] : [];
  return {
    move(cell) {
      const r = rectFrom(start, cell);
      R.overlay.marquee = r;
      const ids = [];
      for (const l of activeTab().layers) {
        if (!l.visible || l.locked) continue;
        for (const o of l.objects) if (!o.hidden && rectsIntersect(bounds(o), r)) ids.push(o.id);
      }
      state.selection = [...new Set([...base, ...ids])];
      emit('selection');
    },
    up() { R.overlay.marquee = null; R.invalidate(); },
  };
}

// Shape tools share this: drag out a rectangle, click for a default size.
function rectTool(make, { clickSize, after = 'select' }) {
  return cell => {
    const layer = A.writableLayer();
    if (!layer) return null;
    beginGesture();
    const o = make(cell);
    layer.objects.push(o);
    select([o.id]);
    changed();
    let moved = false;
    return {
      move(c) {
        if (c.x === cell.x && c.y === cell.y && !moved) return;
        moved = true;
        Object.assign(o, rectFrom(cell, c));
        changed();
      },
      up() {
        if (!moved) { o.w = clickSize[0]; o.h = clickSize[1]; }
        else if (o.border && o.border !== 'none') { o.w = Math.max(2, o.w); o.h = Math.max(2, o.h); }
        changed();
        endGesture();
        if (after) setTool(after);
      },
    };
  };
}

const TOOLS = {
  select(cell, e) {
    if (state.editing) {
      const t = editTarget();
      if (t && hitTest(t.obj, cell.x, cell.y)) {
        if (t.obj.type === 'table') state.editing.cell = tableCellAt(t.obj, cell.x, cell.y);
        state.editing.fresh = false;
        const f = editTarget().frame;
        state.editing.caret = indexAtCell(f, cell.x - f.x, cell.y - f.y);
        emit('view');
        return null;
      }
      stopEditing();
    }
    const tbl = selectedTable();
    const edge = tbl && tableEdgeAt(tbl, cell);
    if (edge) return tableEdgeGesture(tbl, edge, cell);
    const h = handleAt(e);
    if (h) return h.kind === 'point' ? pointGesture(h) : h.kind === 'scale' ? scaleGesture(h, cell) : resizeGesture(h, cell);
    const o = pickObject(cell);
    if (o) {
      if (e.shiftKey) {
        state.selection = state.selection.includes(o.id)
          ? state.selection.filter(id => id !== o.id) : [...state.selection, o.id];
        emit('selection');
        return null;
      }
      if (!state.selection.includes(o.id)) select([o.id]);
      else { state.activeLayerId = layerOf(o.id).id; emit('selection'); }
      return moveGesture(cell, e.altKey);
    }
    if (!e.shiftKey) select([]);
    return marqueeGesture(cell, e.shiftKey);
  },

  box: rectTool(c => makeBox(c.x, c.y, 1, 1, {
    border: state.brush.box, fg: state.brush.fg, bg: state.brush.bg,
  }), { clickSize: [16, 5] }),

  block: rectTool(c => makeBlock(c.x, c.y, 1, 1, state.brush.glyph || '█', {
    fg: state.brush.fg, bg: state.brush.bg,
  }), { clickSize: [1, 1], after: null }),

  text(cell) {
    const hit = editableAt(pickObject(cell), cell.x, cell.y);
    if (hit) { editAt(hit, cell); return null; }
    const layer = A.writableLayer();
    if (!layer) return null;
    beginGesture();
    const o = makeText(cell.x, cell.y, '', { fg: state.brush.fg, bg: state.brush.bg });
    layer.objects.push(o);
    changed();
    return {
      move(c) {
        if (c.x === cell.x && c.y === cell.y && o.autoSize) return;
        o.autoSize = false;
        Object.assign(o, rectFrom(cell, c));
        changed();
      },
      up() { setTool('select'); startEditing(o.id, 0); },
    };
  },

  line(cell) {
    const layer = A.writableLayer();
    if (!layer) return null;
    beginGesture();
    const b = state.brush;
    const o = makeLine(cell.x, cell.y, cell.x, cell.y, { style: b.line, start: b.start, end: b.end, fg: b.fg, bg: b.bg });
    layer.objects.push(o);
    select([o.id]);
    changed();
    let routed = false;
    return {
      move(c) {
        const dx = c.x - cell.x, dy = c.y - cell.y;
        if (!routed && (Math.abs(dx) > 0 || Math.abs(dy) > 0)) { o.route = Math.abs(dx) >= Math.abs(dy) ? 'hv' : 'vh'; routed = true; }
        o.points[1] = [c.x, c.y];
        changed();
      },
      up() {
        const [[x1, y1], [x2, y2]] = o.points;
        if (x1 === x2 && y1 === y2) {
          layer.objects.splice(layer.objects.indexOf(o), 1);
          select([]);
          toast('Drag to draw an arrow.');
        }
        changed();
        endGesture();
        setTool('select');
      },
    };
  },

  table(cell) {
    const layer = A.writableLayer();
    if (!layer) return null;
    beginGesture();
    const b = state.brush;
    const o = makeTable(cell.x, cell.y, b.tableCols, b.tableRows, {
      border: b.tableBorder, rowLines: b.tableRowLines, fg: b.fg, bg: b.bg,
    });
    layer.objects.push(o);
    select([o.id]);
    changed();
    let moved = false;
    return {
      move(c) {
        if (!moved && c.x === cell.x && c.y === cell.y) return;
        moved = true;
        const r = rectFrom(cell, c);
        o.x = r.x; o.y = r.y;
        fitTableTo(o, r.w, r.h);
        changed();
      },
      up() {
        endGesture();
        setTool('select');
        startEditing(o.id, null, [0, 0]);
        state.editing.fresh = true;
      },
    };
  },

  cursor(cell) {
    const layer = A.writableLayer();
    if (!layer) return null;
    beginGesture();
    const g = state.brush.glyph && state.brush.glyph !== ' ' ? state.brush.glyph : '█';
    const o = makeCursor(cell.x, cell.y, g, { fg: state.brush.fg, bg: state.brush.bg });
    layer.objects.push(o);
    select([o.id]);
    changed();
    return {
      move(c) { o.x = c.x; o.y = c.y; changed(); },
      up() { endGesture(); setTool('select'); },
    };
  },

  pencil(cell) {
    const layer = A.writableLayer();
    if (!layer) return null;
    beginGesture();
    let o = selected()[0];
    if (!(o && o.type === 'paint' && layerOf(o.id) === layer)) {
      o = makePaint(cell.x, cell.y);
      layer.objects.push(o);
      select([o.id]);
    }
    const index = new Map(o.cells.map((c, i) => [c[0] + ',' + c[1], i]));
    const { glyph, fg, bg } = state.brush;
    const { cols, rows } = activeTab();
    const paint = ({ x, y }) => {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return;
      const dx = x - o.x, dy = y - o.y, key = dx + ',' + dy;
      const v = [dx, dy, glyph || '█', fg, bg];
      if (index.has(key)) o.cells[index.get(key)] = v;
      else { index.set(key, o.cells.length); o.cells.push(v); }
    };
    paint(cell);
    changed();
    let last = cell;
    return {
      move(c) { cellsBetween(last, c).forEach(paint); last = c; changed(); },
      up: endGesture,
    };
  },

  eraser(cell) {
    const layer = A.writableLayer();
    if (!layer) return null;
    beginGesture();
    let erased = false;
    const erase = ({ x, y }) => {
      for (const o of layer.objects) {
        if (o.type !== 'paint' || o.hidden) continue;
        const n = o.cells.length;
        o.cells = o.cells.filter(c => o.x + c[0] !== x || o.y + c[1] !== y);
        if (o.cells.length !== n) erased = true;
      }
    };
    erase(cell);
    changed();
    let last = cell;
    return {
      move(c) { cellsBetween(last, c).forEach(erase); last = c; changed(); },
      up() {
        const empty = layer.objects.filter(o => o.type === 'paint' && !o.cells.length).map(o => o.id);
        if (empty.length) {
          layer.objects = layer.objects.filter(o => !empty.includes(o.id));
          state.selection = state.selection.filter(id => !empty.includes(id));
        }
        changed();
        endGesture();
        if (!erased) toast('The eraser removes pencil drawing. To remove an object, select it and press Delete.');
      },
    };
  },
};

// ── Text editing keys ────────────────────────────────────────────────────────

function editKey(e) {
  const ed = state.editing;
  const t = editTarget();
  if (!t) { stopEditing(); return true; }
  const f = t.frame;
  const cs = chars(f.text);
  let c = Math.min(ed.caret, cs.length);
  const mod = e.ctrlKey || e.metaKey;
  const insert = str => {
    const add = chars(str);
    cs.splice(c, 0, ...add);
    c += add.length;
  };

  if (e.key === 'Escape') { stopEditing(); return true; }
  if (mod) {
    if (e.key.toLowerCase() === 'z') { stopEditing(); e.shiftKey ? redo() : undo(); return true; }
    if (e.key.toLowerCase() === 'a') { ed.caret = cs.length; emit('view'); return true; }
    return false;   // let copy/paste events through
  }
  if (e.key === 'Tab' && t.obj.type === 'table') { moveCell(t.obj, e.shiftKey ? -1 : 1); return true; }
  // a cell you Tab into is "fresh": the first thing you type replaces it
  const fresh = ed.fresh;
  ed.fresh = false;
  if (fresh && (chars(e.key).length === 1 || e.key === 'Backspace' || e.key === 'Delete')) {
    cs.length = 0;
    c = 0;
    if (e.key === 'Backspace' || e.key === 'Delete') { t.setText(''); changed(); ed.caret = 0; emit('view'); return true; }
  }
  switch (e.key) {
    case 'ArrowLeft': c = Math.max(0, c - 1); break;
    case 'ArrowRight': c = Math.min(cs.length, c + 1); break;
    case 'ArrowUp':
    case 'ArrowDown': {
      const p = caretCell(f, c);
      c = indexAtCell(f, p.x, p.y + (e.key === 'ArrowUp' ? -1 : 1));
      break;
    }
    case 'Home': c = indexAtCell(f, -1e6, caretCell(f, c).y); break;
    case 'End': c = indexAtCell(f, 1e6, caretCell(f, c).y); break;
    case 'Backspace': if (c > 0) { cs.splice(c - 1, 1); c--; } break;
    case 'Delete': if (c < cs.length) cs.splice(c, 1); break;
    case 'Enter': insert('\n'); break;
    case 'Tab': insert('    '); break;
    default:
      if (chars(e.key).length !== 1) return false;
      insert(e.key);
  }
  const text = cs.join('');
  if (text !== f.text) {
    t.setText(text);
    changed();
  }
  ed.caret = c;
  emit('view');
  return true;
}

// Tab / Shift+Tab between table cells; Tab on the last cell adds a row.
function moveCell(o, step) {
  const ed = state.editing;
  const nc = o.colWidths.length;
  const [r, c] = ed.cell || [0, 0];
  const i = Math.max(0, r * nc + c + step);
  if (i >= o.rowHeights.length * nc) { resizeTable(o, nc, o.rowHeights.length + 1); changed(); }
  ed.cell = [Math.floor(i / nc), i % nc];
  ed.caret = chars(o.cells[ed.cell[0]][ed.cell[1]]).length;
  ed.fresh = true;
  emit('view');
}

export function insertIntoEditing(str) {
  const ed = state.editing;
  const t = editTarget();
  if (!t) return;
  const cs = ed.fresh ? [] : chars(t.frame.text);
  const at = ed.fresh ? 0 : ed.caret;
  const add = chars(str.replace(/\r\n?/g, '\n'));
  cs.splice(at, 0, ...add);
  t.setText(cs.join(''));
  ed.caret = at + add.length;
  ed.fresh = false;
  changed();
}

// ── Wiring ───────────────────────────────────────────────────────────────────

const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

function updateCursor(e) {
  const c = R.canvas;
  if (gesture) return;
  if (spaceDown || state.tool === 'hand') { c.style.cursor = 'grab'; return; }
  if (state.tool === 'select') {
    const tbl = selectedTable();
    const edge = tbl && tableEdgeAt(tbl, R.clientToCell(e.clientX, e.clientY));
    if (edge) { c.style.cursor = edge.kind === 'col' ? 'col-resize' : 'row-resize'; return; }
    const h = handleAt(e);
    c.style.cursor = h ? (h.kind === 'point' ? 'move' : CURSORS[h.dir]) : 'default';
    return;
  }
  c.style.cursor = state.tool === 'text' ? 'text' : 'crosshair';
}

export function initTools(renderer) {
  R = renderer;
  const canvas = R.canvas;

  canvas.addEventListener('pointerdown', e => {
    canvas.focus({ preventScroll: true });
    if (gesture) return;
    const cell = R.clientToCell(e.clientX, e.clientY);
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || spaceDown || state.tool === 'hand') { e.preventDefault(); gesture = panGesture(e); return; }
    if (e.button !== 0) return;
    gesture = TOOLS[state.tool]?.(cell, e) || null;
  });

  canvas.addEventListener('pointermove', e => {
    const cell = R.clientToCell(e.clientX, e.clientY);
    const p = activeTab();
    const inside = cell.x >= 0 && cell.y >= 0 && cell.x < p.cols && cell.y < p.rows;
    const moved = cell.x !== pointer.x || cell.y !== pointer.y || inside !== pointer.inside;
    Object.assign(pointer, { x: cell.x, y: cell.y, inside });
    if (gesture) gesture.move(cell, e);
    if (moved) {
      R.overlay.hover = inside ? cell : null;
      R.invalidate();
      emit('pointer', pointer);
    }
    updateCursor(e);
  });

  const finish = e => {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    g.up?.(R.clientToCell(e.clientX, e.clientY), e);
    updateCursor(e);
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('pointerleave', () => {
    if (!gesture) { R.overlay.hover = null; pointer.inside = false; R.invalidate(); emit('pointer', pointer); }
  });

  canvas.addEventListener('dblclick', e => {
    const cell = R.clientToCell(e.clientX, e.clientY);
    const o = editableAt(pickObject(cell), cell.x, cell.y);
    if (o) editAt(o, cell);
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : 1;
    if (e.ctrlKey || e.metaKey) R.zoomAt(Math.exp(-e.deltaY * unit * 0.002), e.clientX, e.clientY);
    else {
      state.view.x -= (e.shiftKey ? e.deltaY : e.deltaX) * unit;
      state.view.y -= (e.shiftKey ? 0 : e.deltaY) * unit;
      emit('view');
    }
  }, { passive: false });

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', e => {
    if (e.key === ' ') { spaceDown = false; R.canvas.style.cursor = ''; }
  });

  // Clipboard: copy writes the selection as text too, so pasting into an
  // editor or terminal gives the ASCII; pasting plain text makes a text object.
  document.addEventListener('copy', e => onClipboard(e, false));
  document.addEventListener('cut', e => onClipboard(e, true));
  document.addEventListener('paste', e => {
    if (isField(e.target)) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    e.preventDefault();
    if (state.editing) insertIntoEditing(text);
    else A.paste(text);
  });

  on('tool', () => { R.invalidate(); });
}

function isField(t) {
  return t?.closest?.('input, textarea, select, [contenteditable="true"], dialog');
}

function onClipboard(e, cut) {
  if (isField(e.target) || state.editing || !state.selection.length) return;
  const text = A.copySelection(cut);
  if (text == null) return;
  e.clipboardData.setData('text/plain', text);
  e.preventDefault();
  toast(cut ? 'Cut' : 'Copied — paste into OTIS, or anywhere as text');
}

function onKeyDown(e) {
  if (isField(e.target)) return;
  if (state.editing) { if (editKey(e)) e.preventDefault(); return; }
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  let handled = true;

  if (mod) {
    switch (k) {
      case 'z': e.shiftKey ? redo() : undo(); break;
      case 'y': redo(); break;
      case 'd': A.duplicate(); break;
      case 'g': e.shiftKey ? A.ungroup() : A.group(); break;
      case 'a': A.selectAll(); break;
      case 's': commands.save?.(); break;
      case 'o': commands.open?.(); break;
      case 'e': commands.export?.(); break;
      case '=': case '+': R.zoomAt(1.25, ...center()); break;
      case '-': R.zoomAt(0.8, ...center()); break;
      case '0': R.fit(); break;
      default: handled = false;
    }
  } else if (e.altKey) {
    // Alt+PageUp / Alt+PageDown: previous / next tab
    const step = { PageUp: -1, PageDown: 1 }[k];
    const tabs = state.project.tabs;
    const i = tabs.indexOf(activeTab()) + (step || 0);
    if (step && tabs[i]) switchTab(tabs[i].id);
    else handled = false;
  } else {
    const step = e.shiftKey ? 5 : 1;
    switch (k) {
      case ' ': spaceDown = true; R.canvas.style.cursor = 'grab'; break;
      case 'Delete': case 'Backspace': A.deleteSelection(); break;
      case 'Escape': select([]); setTool('select'); break;
      case 'Enter': {
        const sel = selected()[0];
        const o = sel?.type === 'group' ? [...sel.children].reverse().find(c => c.type === 'text' || c.type === 'box') : sel;
        if (o?.art) commands.textArt?.(o);
        else if (o && (o.type === 'text' || o.type === 'box')) startEditing(o.id);
        else if (o?.type === 'table') startEditing(o.id, null, [0, 0]);
        else handled = false;
        break;
      }
      case 'ArrowLeft': A.nudge(-step, 0); break;
      case 'ArrowRight': A.nudge(step, 0); break;
      case 'ArrowUp': A.nudge(0, -step); break;
      case 'ArrowDown': A.nudge(0, step); break;
      case '[': A.arrange(-1); break;
      case ']': A.arrange(1); break;
      case '{': A.arrange(-Infinity); break;
      case '}': A.arrange(Infinity); break;
      case 'g': state.view.grid = !state.view.grid; emit('view'); break;
      case '?': commands.help?.(); break;
      case '=': case '+': R.zoomAt(1.25, ...center()); break;
      case '-': R.zoomAt(0.8, ...center()); break;
      case '0': R.fit(); break;
      case '1': R.setZoom(1); break;
      default:
        if (k === 't' && e.shiftKey) commands.textArt?.();
        else if (TOOL_KEYS[k] && (!e.shiftKey || k === '#')) setTool(TOOL_KEYS[k]);
        else handled = false;
    }
  }
  if (handled) e.preventDefault();
}

function center() {
  const r = R.canvas.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}
