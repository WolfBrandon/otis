// OTIS document model: object factories, geometry, borders, line routing and
// text layout. Pure functions only (no DOM) so it runs in Node tests too.
// See docs/FORMAT.md for the file format.

export const FORMAT_VERSION = 1;

let counter = 0;
export function uid() {
  counter = (counter + 1) % 1296;
  return Math.random().toString(36).slice(2, 7) + counter.toString(36);
}

// ── Border and line styles ──────────────────────────────────────────────────
// Border order: top-left, top, top-right, right, bottom-right, bottom, bottom-left, left

export const BORDERS = {
  single:         '┌─┐│┘─└│',
  double:         '╔═╗║╝═╚║',
  heavy:          '┏━┓┃┛━┗┃',
  rounded:        '╭─╮│╯─╰│',
  dashed:         '┌╌┐╎┘╌└╎',
  'heavy-dashed': '┏╍┓╏┛╍┗╏',
  ascii:          '+-+|+-+|',
  block:          '█▀███▄██',
  half:           '▛▀▜▐▟▄▙▌',
  outer:          '▗▄▖▌▘▀▝▐',
};
export const BORDER_NAMES = {
  none: 'None', single: 'Single', double: 'Double', heavy: 'Heavy', rounded: 'Rounded',
  dashed: 'Dashed', 'heavy-dashed': 'Heavy dashed', ascii: 'ASCII', block: 'Block',
  half: 'Half block (inner)', outer: 'Half block (outer)', custom: 'Custom…',
};

export function borderChars(obj) {
  if (obj.border === 'none' || !obj.border) return null;
  if (obj.border === 'custom') {
    const c = Array.from(obj.borderChars || '');
    if (c.length >= 8) return c.slice(0, 8);
    return Array.from(BORDERS.single);
  }
  return Array.from(BORDERS[obj.border] || BORDERS.single);
}

// Line styles: horizontal, vertical, then corners named by the arms they join:
// se ┌  sw ┐  ne └  nw ┘
export const LINES = {
  single:  { h: '─', v: '│', se: '┌', sw: '┐', ne: '└', nw: '┘' },
  double:  { h: '═', v: '║', se: '╔', sw: '╗', ne: '╚', nw: '╝' },
  heavy:   { h: '━', v: '┃', se: '┏', sw: '┓', ne: '┗', nw: '┛' },
  rounded: { h: '─', v: '│', se: '╭', sw: '╮', ne: '╰', nw: '╯' },
  dashed:  { h: '╌', v: '╎', se: '┌', sw: '┐', ne: '└', nw: '┘' },
  ascii:   { h: '-', v: '|', se: '+', sw: '+', ne: '+', nw: '+' },
};
export const LINE_NAMES = {
  single: 'Single', double: 'Double', heavy: 'Heavy', rounded: 'Rounded corners', dashed: 'Dashed', ascii: 'ASCII',
};

// Line end caps, keyed by the direction the line is travelling when it ends.
export const CAPS = {
  none:     null,
  arrow:    { e: '▶', w: '◀', n: '▲', s: '▼', ascii: { e: '>', w: '<', n: '^', s: 'v' } },
  triangle: { e: '▷', w: '◁', n: '△', s: '▽', ascii: { e: '>', w: '<', n: '^', s: 'v' } },
  dot:      { all: '●', ascii: { all: 'o' } },
  circle:   { all: '○', ascii: { all: 'o' } },
  diamond:  { all: '◆', ascii: { all: '*' } },
  square:   { all: '■', ascii: { all: '#' } },
  bar:      { e: '┤', w: '├', n: '┴', s: '┬', ascii: { all: '+' } },
};
export const CAP_NAMES = {
  none: 'None', arrow: 'Arrow ▶', triangle: 'Triangle ▷', dot: 'Dot ●', circle: 'Circle ○',
  diamond: 'Diamond ◆', square: 'Square ■', bar: 'Bar ┤',
};

export const BLOCK_GLYPHS = ['█', '▓', '▒', '░', '▀', '▄', '▌', '▐', '■', '▪', '●', '·', '╳', ' '];
export const CURSOR_GLYPHS = ['█', '▌', '▏', '▁', '_', '▶', '❯', '›', '>', '●', '◆', '▸'];

// ── Factories ────────────────────────────────────────────────────────────────

const base = () => ({
  id: uid(), name: '', fg: null, bg: null,
  attrs: { bold: false, italic: false, underline: false, dim: false, strike: false },
  font: null,
});

export function makeBox(x, y, w, h, opts = {}) {
  return {
    ...base(), type: 'box', x, y, w, h,
    border: 'single', borderChars: null, borderFg: null, fill: null,
    title: '', titleAlign: 'left',
    text: '', align: 'left', valign: 'top', padding: 1, autoSize: false, transparent: false,
    ...opts,
  };
}

export function makeText(x, y, text = '', opts = {}) {
  const o = {
    ...base(), type: 'text', x, y, w: 1, h: 1,
    border: 'none', borderChars: null, borderFg: null, fill: null,
    title: '', titleAlign: 'left',
    text, align: 'left', valign: 'top', padding: 0, autoSize: true, transparent: false,
    ...opts,
  };
  if (o.autoSize) fitText(o);
  return o;
}

export function makeLine(x1, y1, x2, y2, opts = {}) {
  return {
    ...base(), type: 'line', points: [[x1, y1], [x2, y2]], route: 'hv',
    style: 'single', start: 'none', end: 'arrow', ...opts,
  };
}

export function makeBlock(x, y, w, h, glyph = '█', opts = {}) {
  return { ...base(), type: 'block', x, y, w, h, glyph, ...opts };
}

export function makeCursor(x, y, glyph = '█', opts = {}) {
  return { ...base(), type: 'cursor', x, y, glyph, blink: true, ...opts };
}

export function makePaint(x, y, opts = {}) {
  return { ...base(), type: 'paint', x, y, cells: [], ...opts };
}

export function makeTable(x, y, cols = 3, rows = 3, opts = {}) {
  const t = {
    ...base(), type: 'table', x, y,
    colWidths: Array(cols).fill(12), rowHeights: Array(rows).fill(1),
    cells: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => r === 0 ? `Column ${c + 1}` : '')),
    aligns: Array(cols).fill('left'),
    border: 'single', borderFg: null, header: true, headerFg: null, headerBg: null,
    colLines: true, rowLines: false, padding: 1,
    ...opts,
  };
  return t;
}

export function makeGroup(children, opts = {}) {
  return { ...base(), type: 'group', children, ...opts };
}

export function makeLayer(name = 'Layer') {
  return { id: uid(), name, visible: true, locked: false, objects: [] };
}

export function makeProject(opts = {}) {
  return {
    otis: FORMAT_VERSION,
    id: uid(),
    name: 'Untitled',
    cols: 100,
    rows: 30,
    font: { family: 'JetBrainsMono Nerd Font', size: 16, lineHeight: 1.2 },
    palette: null,
    background: 'background',
    foreground: 'foreground',
    mergeJunctions: true,
    layers: [makeLayer('Layer 1')],
    ...opts,
  };
}

export const TYPE_NAMES = {
  box: 'Box', text: 'Text', line: 'Arrow', block: 'Block', cursor: 'Cursor', paint: 'Drawing', group: 'Group', table: 'Table',
};

export function displayName(o) {
  if (o.name) return o.name;
  if (o.type === 'text' && o.text) return '“' + o.text.split('\n')[0].slice(0, 24) + '”';
  if (o.type === 'box' && o.title) return 'Box “' + o.title.slice(0, 20) + '”';
  if (o.type === 'table') return `Table ${o.colWidths.length}×${o.rowHeights.length}`;
  return TYPE_NAMES[o.type] || o.type;
}

// ── Geometry ─────────────────────────────────────────────────────────────────

export function bounds(o) {
  switch (o.type) {
    case 'line': {
      const xs = o.points.map(p => p[0]), ys = o.points.map(p => p[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 };
    }
    case 'cursor':
      return { x: o.x, y: o.y, w: 1, h: 1 };
    case 'paint': {
      if (!o.cells.length) return { x: o.x, y: o.y, w: 1, h: 1 };
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const [dx, dy] of o.cells) {
        if (dx < minx) minx = dx; if (dx > maxx) maxx = dx;
        if (dy < miny) miny = dy; if (dy > maxy) maxy = dy;
      }
      return { x: o.x + minx, y: o.y + miny, w: maxx - minx + 1, h: maxy - miny + 1 };
    }
    case 'group':
      return unionBounds(o.children.map(bounds));
    case 'table': {
      const t = tableLayout(o);
      return { x: o.x, y: o.y, w: t.w, h: t.h };
    }
    default:
      return { x: o.x, y: o.y, w: o.w, h: o.h };
  }
}

export function unionBounds(list) {
  if (!list.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const b of list) {
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function translate(o, dx, dy) {
  if (o.type === 'line') o.points = o.points.map(([x, y]) => [x + dx, y + dy]);
  else if (o.type === 'group') o.children.forEach(c => translate(c, dx, dy));
  else { o.x += dx; o.y += dy; }
}

export const RESIZABLE = new Set(['box', 'text', 'block']);

export function rectsIntersect(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// Does cell (x, y) hit the object?
export function hitTest(o, x, y) {
  switch (o.type) {
    case 'line': return linePath(o).some(c => c.x === x && c.y === y);
    case 'paint': return o.cells.some(([dx, dy]) => o.x + dx === x && o.y + dy === y);
    case 'group': return o.children.some(c => hitTest(c, x, y));
    default: {
      const b = bounds(o);
      return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
    }
  }
}

// Deep copy with fresh ids.
export function cloneObject(o) {
  const c = structuredClone(o);
  const reid = n => { n.id = uid(); if (n.children) n.children.forEach(reid); };
  reid(c);
  return c;
}

// Walk every object including group children.
export function* walk(objects) {
  for (const o of objects) {
    yield o;
    if (o.type === 'group') yield* walk(o.children);
  }
}

// ── Line routing ─────────────────────────────────────────────────────────────

// Cells along the line, each with the set of directions it connects to.
// Returns [{ x, y, dirs: Set('n'|'e'|'s'|'w') }] in path order.
export function linePath(o) {
  const pts = [];
  const push = (x, y) => {
    const last = pts[pts.length - 1];
    if (!last || last[0] !== x || last[1] !== y) pts.push([x, y]);
  };
  const walkTo = (x1, y1, x2, y2) => {
    // straight run from (x1,y1) to (x2,y2), one axis only
    const sx = Math.sign(x2 - x1), sy = Math.sign(y2 - y1);
    let x = x1, y = y1;
    push(x, y);
    while (x !== x2 || y !== y2) { x += sx; y += sy; push(x, y); }
  };
  const p = o.points;
  for (let i = 0; i < p.length - 1; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[i + 1];
    if (o.route === 'vh') { walkTo(x1, y1, x1, y2); walkTo(x1, y2, x2, y2); }
    else { walkTo(x1, y1, x2, y1); walkTo(x2, y1, x2, y2); }
  }
  if (!pts.length) pts.push([p[0][0], p[0][1]]);
  const dirTo = (a, b) => b[0] > a[0] ? 'e' : b[0] < a[0] ? 'w' : b[1] > a[1] ? 's' : 'n';
  return pts.map((pt, i) => {
    const dirs = new Set();
    if (i > 0) dirs.add(dirTo(pt, pts[i - 1]));
    if (i < pts.length - 1) dirs.add(dirTo(pt, pts[i + 1]));
    return { x: pt[0], y: pt[1], dirs };
  });
}

const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' };

// Character for one path cell.
export function lineChar(style, dirs) {
  const L = LINES[style] || LINES.single;
  const has = d => dirs.has(d);
  if (dirs.size === 0) return L.h;
  if (has('s') && has('e')) return L.se;
  if (has('s') && has('w')) return L.sw;
  if (has('n') && has('e')) return L.ne;
  if (has('n') && has('w')) return L.nw;
  if (has('e') || has('w')) return L.h;
  return L.v;
}

// Cap glyph for an end of the line. `heading` is the direction of travel.
export function capChar(cap, style, heading) {
  const c = CAPS[cap];
  if (!c) return null;
  const set = style === 'ascii' ? c.ascii : c;
  return set.all || set[heading] || null;
}

// Full list of { x, y, ch } for a line object.
export function lineCells(o) {
  const path = linePath(o);
  const cells = path.map(c => ({ x: c.x, y: c.y, dirs: c.dirs, ch: lineChar(o.style, c.dirs) }));
  if (path.length > 1) {
    const first = path[0], last = path[path.length - 1];
    const startHeading = OPPOSITE[[...first.dirs][0]];   // travelling away from the line
    const endHeading = OPPOSITE[[...last.dirs][0]];
    const s = capChar(o.start, o.style, startHeading);
    const e = capChar(o.end, o.style, endHeading);
    if (s) cells[0].ch = s;
    if (e) cells[cells.length - 1].ch = e;
  }
  return cells;
}

// ── Text layout ──────────────────────────────────────────────────────────────

export const chars = s => Array.from(s ?? '');

// Text inset inside a frame: the border on every side, plus `padding`
// columns left and right (TUI panels put text right under the border).
export function frameInset(o) {
  const b = o.border && o.border !== 'none' ? 1 : 0;
  return { x: b + (o.padding || 0), y: b };
}

// Lay out text inside a w×h area. Returns rows of
// { start, end, x, y } where start/end index into Array.from(text) and x/y are
// the cell offset of the row inside the area.
export function layoutText(text, w, h, { wrap = true, align = 'left', valign = 'top' } = {}) {
  const cs = chars(text.replace(/\t/g, '    '));
  const rows = [];
  let i = 0;
  while (i <= cs.length) {
    // one hard line: i .. nl
    let nl = cs.indexOf('\n', i);
    if (nl === -1) nl = cs.length;
    let s = i;
    if (!wrap || w <= 0 || nl - s <= w) rows.push({ start: s, end: nl });
    else {
      while (nl - s > w) {
        // break at the last space inside the width, else hard break
        let br = -1;
        for (let k = s + w; k > s; k--) if (cs[k] === ' ') { br = k; break; }
        if (br === -1) { rows.push({ start: s, end: s + w }); s = s + w; }
        else { rows.push({ start: s, end: br, soft: true }); s = br + 1; }
      }
      rows.push({ start: s, end: nl });
    }
    i = nl + 1;
  }
  const offY = valign === 'middle' ? Math.floor((h - rows.length) / 2)
    : valign === 'bottom' ? h - rows.length : 0;
  rows.forEach((r, n) => {
    const len = r.end - r.start;
    r.x = align === 'center' ? Math.floor((w - len) / 2) : align === 'right' ? w - len : 0;
    r.y = Math.max(0, offY) + n;
  });
  return { chars: cs, rows };
}

// Size a text object (autoSize) to fit its text.
export function fitText(o) {
  const lines = (o.text || '').replace(/\t/g, '    ').split('\n');
  const ins = frameInset(o);
  const titleW = o.title ? chars(o.title).length + 4 : 0;
  o.w = Math.max(1, ...lines.map(l => chars(l).length), titleW - ins.x * 2) + ins.x * 2;
  o.h = Math.max(1, lines.length) + ins.y * 2;
  return o;
}

// Where the caret for text index `idx` sits, relative to the object origin.
export function caretCell(o, idx) {
  const ins = frameInset(o);
  const { rows } = layoutText(o.text || '', o.w - ins.x * 2, o.h - ins.y * 2,
    { wrap: !o.autoSize, align: o.align, valign: o.valign });
  let row = rows[rows.length - 1];
  for (let n = 0; n < rows.length; n++) {
    const r = rows[n];
    const next = rows[n + 1];
    if (idx >= r.start && (idx < r.end || idx === r.end && (!next || next.start > idx || !r.soft))) { row = r; break; }
  }
  return { x: ins.x + row.x + (idx - row.start), y: ins.y + row.y, rows };
}

// Text index nearest to a cell (relative to the object origin).
export function indexAtCell(o, cx, cy) {
  const ins = frameInset(o);
  const { rows } = layoutText(o.text || '', o.w - ins.x * 2, o.h - ins.y * 2,
    { wrap: !o.autoSize, align: o.align, valign: o.valign });
  let best = rows[0];
  for (const r of rows) if (Math.abs(ins.y + r.y - cy) < Math.abs(ins.y + best.y - cy)) best = r;
  const col = cx - ins.x - best.x;
  return best.start + Math.max(0, Math.min(best.end - best.start, col));
}

// ── Tables ───────────────────────────────────────────────────────────────────
// colWidths/rowHeights are the cell sizes; borders and divider lines add one
// cell each. A header row always gets a line under it; `rowLines` adds lines
// between the other rows too.

export const TABLE_BORDERS = ['single', 'double', 'heavy', 'rounded', 'dashed', 'ascii', 'none'];

export function tableLayout(o) {
  const b = o.border && o.border !== 'none' ? 1 : 0;
  const nc = o.colWidths.length, nr = o.rowHeights.length;
  const xs = [], ys = [], vlines = [], hlines = [];
  let x = o.x + b;
  o.colWidths.forEach((w, i) => {
    xs.push(x);
    x += w;
    if (i < nc - 1 && o.colLines) { vlines.push(x); x += 1; }
  });
  let y = o.y + b;
  o.rowHeights.forEach((h, j) => {
    ys.push(y);
    y += h;
    if (j < nr - 1 && (o.rowLines || (o.header && j === 0))) { hlines.push(y); y += 1; }
  });
  return { b, xs, ys, vlines, hlines, w: x + b - o.x, h: y + b - o.y };
}

// The cell at (x, y); a point on a divider counts as the cell before it.
export function tableCellAt(o, x, y) {
  const t = tableLayout(o);
  let c = 0, r = 0;
  t.xs.forEach((cx, i) => { if (x >= cx) c = i; });
  t.ys.forEach((ry, j) => { if (y >= ry) r = j; });
  return [r, c];
}

// A table cell as a borderless frame, so text layout and editing can treat it
// like a text object.
export function cellFrame(o, r, c) {
  const t = tableLayout(o);
  return {
    x: t.xs[c], y: t.ys[r], w: o.colWidths[c], h: o.rowHeights[r],
    border: 'none', padding: Math.min(o.padding ?? 1, Math.floor((o.colWidths[c] - 1) / 2)),
    align: o.aligns?.[c] || 'left', valign: 'top', autoSize: false,
    text: o.cells[r]?.[c] ?? '',
  };
}

// Where each column's right edge and each row's bottom edge sit, in
// fractional cells (the middle of the divider line, or the gap between cells).
export function tableEdges(o) {
  const t = tableLayout(o);
  const cols = o.colWidths.map((w, i) => {
    const end = t.xs[i] + w;
    const line = !!(i < o.colWidths.length - 1 ? o.colLines : t.b);
    return { i, x: line ? end + 0.5 : end, line };
  });
  const rows = o.rowHeights.map((h, j) => {
    const end = t.ys[j] + h;
    const line = !!(j < o.rowHeights.length - 1 ? t.hlines.includes(end) : t.b);
    return { j, y: line ? end + 0.5 : end, line };
  });
  return { cols, rows, w: t.w, h: t.h };
}

// Spread a table over a w×h area (the table tool's drag).
export function fitTableTo(o, w, h) {
  const b = o.border && o.border !== 'none' ? 1 : 0;
  const nc = o.colWidths.length, nr = o.rowHeights.length;
  const lines = o.rowLines ? nr - 1 : o.header && nr > 1 ? 1 : 0;
  const spread = (total, n) => Array.from({ length: n }, (_, i) => Math.max(1, Math.floor(total / n) + (i < total % n ? 1 : 0)));
  o.colWidths = spread(w - 2 * b - (o.colLines ? nc - 1 : 0), nc);
  o.rowHeights = spread(h - 2 * b - lines, nr);
  return o;
}

export function resizeTable(o, cols, rows) {
  cols = Math.max(1, Math.min(50, cols));
  rows = Math.max(1, Math.min(200, rows));
  while (o.colWidths.length < cols) { o.colWidths.push(o.colWidths[o.colWidths.length - 1] || 12); o.aligns.push('left'); }
  o.colWidths.length = cols;
  o.aligns.length = cols;
  while (o.rowHeights.length < rows) o.rowHeights.push(1);
  o.rowHeights.length = rows;
  while (o.cells.length < rows) o.cells.push([]);
  o.cells.length = rows;
  o.cells = o.cells.map(row => { row = row.slice(0, cols); while (row.length < cols) row.push(''); return row; });
  return o;
}
