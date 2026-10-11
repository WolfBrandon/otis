// Compositor: flattens a project's layers into a grid of character cells.
// Colors stay as references (hex, palette slot or null) so exporters can
// decide how to resolve them. Pure, no DOM.

import { ARMS, isBoxChar, charForArms, mergeBox } from './boxchars.js';
import { borderChars, layoutText, frameInset, lineCells, chars, tableLayout, cellFrame } from './model.js';

export const ATTR = { bold: 1, italic: 2, underline: 4, dim: 8, strike: 16, blink: 32 };

export function attrBits(a) {
  if (!a) return 0;
  let n = 0;
  for (const k in ATTR) if (a[k]) n |= ATTR[k];
  return n;
}

export function makeGrid(cols, rows) {
  const n = cols * rows;
  return {
    cols, rows,
    ch: new Array(n).fill(null),
    fg: new Array(n).fill(null),
    bg: new Array(n).fill(null),
    attr: new Uint8Array(n),
    font: new Array(n).fill(null),
    owner: new Array(n).fill(null),
    cover: new Uint8Array(n),        // a box's fill: hides backgrounds underneath
    half: new Array(n).fill(null),   // open line ends, so later lines can join them
    touched: [],
  };
}

const lineish = c => c === '-' || c === '|' || c === '+' || isBoxChar(c);
const DIR_INDEX = { n: 0, e: 1, s: 2, w: 3 };
const WEIGHT = { single: 1, rounded: 1, dashed: 1, heavy: 2, 'heavy-dashed': 2, double: 3 };

// Join `ch` onto an existing line character. A `stub` ({ dir, weight }) marks
// the open end of a line: it only adds the one arm pointing back along the
// line, so a divider ending on a box edge makes ├ instead of ┼.
function join(old, ch, stub) {
  if (stub && stub.weight && isBoxChar(old)) {
    const arms = [...ARMS.get(old)];
    arms[DIR_INDEX[stub.dir]] = stub.weight;
    const c = charForArms(...arms);
    if (c) return c;
  }
  return mergeBox(old, ch);
}

// Write one cell into a layer buffer. A space without a background is
// transparent unless `opaque`. A box's fill (opaque = 'cover') also hides the
// background colors underneath: the cell shows the box's own background, or
// the canvas. Border and line cells (merge = true) join with box-drawing
// characters already on the same layer.
function put(buf, x, y, ch, fg, bg, attr, font, owner, merge, stub = null, opaque = false) {
  if (x < 0 || y < 0 || x >= buf.cols || y >= buf.rows) return;
  if ((ch === ' ' || ch == null) && bg == null && !opaque) return;
  const i = y * buf.cols + x;
  let half = null;
  if (buf.owner[i] !== null) {
    const old = buf.half[i] || buf.ch[i];
    if (merge && buf.merge && old && ch && lineish(old) && lineish(ch)) ch = join(old, ch, stub);
    if (bg == null && opaque !== 'cover') bg = buf.bg[i];
  } else {
    buf.touched.push(i);
    if (stub && stub.weight) {
      const arms = [0, 0, 0, 0];
      arms[DIR_INDEX[stub.dir]] = stub.weight;
      half = charForArms(...arms);
    }
  }
  buf.half[i] = half;
  buf.ch[i] = ch ?? ' ';
  buf.fg[i] = fg;
  buf.bg[i] = bg;
  buf.attr[i] = attr;
  buf.font[i] = font;
  buf.owner[i] = owner;
  if (opaque === 'cover') buf.cover[i] = 1;
}

function drawFrame(buf, o, owner) {
  const { x, y, w, h } = o;
  if (w <= 0 || h <= 0) return;
  const bc = borderChars(o);
  const attr = attrBits(o.attrs);
  const font = o.font || null;
  const bfg = o.borderFg ?? o.fg;
  const b = bc ? 1 : 0;
  // with a fill the box is solid: its fill, border and title all hide what's underneath
  const solid = o.fill != null && 'cover';

  // interior fill (an explicit fill, even a space, covers what's underneath)
  if (o.fill != null || o.bg != null) {
    const fc = o.fill == null || o.fill === '' ? ' ' : chars(o.fill)[0];
    for (let r = y + b; r < y + h - b; r++)
      for (let c = x + b; c < x + w - b; c++) put(buf, c, r, fc, o.fg, o.bg, 0, font, owner, false, null, solid);
  }

  // border
  if (bc) {
    const [tl, t, tr, rt, br, bm, bl, lf] = bc;
    const wt = WEIGHT[o.border];
    if (h === 1) for (let c = x; c < x + w; c++)
      put(buf, c, y, t, bfg, o.bg, 0, null, owner, true, w > 1 && (c === x || c === x + w - 1) ? { dir: c === x ? 'e' : 'w', weight: wt } : null, solid);
    else if (w === 1) for (let r = y; r < y + h; r++)
      put(buf, x, r, lf, bfg, o.bg, 0, null, owner, true, r === y || r === y + h - 1 ? { dir: r === y ? 's' : 'n', weight: wt } : null, solid);
    else {
      for (let c = x + 1; c < x + w - 1; c++) {
        put(buf, c, y, t, bfg, o.bg, 0, null, owner, true, null, solid);
        put(buf, c, y + h - 1, bm, bfg, o.bg, 0, null, owner, true, null, solid);
      }
      for (let r = y + 1; r < y + h - 1; r++) {
        put(buf, x, r, lf, bfg, o.bg, 0, null, owner, true, null, solid);
        put(buf, x + w - 1, r, rt, bfg, o.bg, 0, null, owner, true, null, solid);
      }
      put(buf, x, y, tl, bfg, o.bg, 0, null, owner, true, null, solid);
      put(buf, x + w - 1, y, tr, bfg, o.bg, 0, null, owner, true, null, solid);
      put(buf, x, y + h - 1, bl, bfg, o.bg, 0, null, owner, true, null, solid);
      put(buf, x + w - 1, y + h - 1, br, bfg, o.bg, 0, null, owner, true, null, solid);
    }
    // title sits on the top border: ┌─ TITLE ──┐
    if (o.title && w > 4) {
      const room = w - 4;
      let tc = chars(' ' + o.title + ' ');
      if (tc.length > room + 2) tc = tc.slice(0, room + 1).concat('…');
      const start = o.titleAlign === 'center' ? x + Math.floor((w - tc.length) / 2)
        : o.titleAlign === 'right' ? x + w - 2 - tc.length : x + 2;
      tc.forEach((ch, k) => put(buf, start + k, y, ch, o.fg, o.bg, attr, font, owner, false, null, solid || true));
    }
  }

  // text
  if (o.text) {
    const ins = frameInset(o);
    const iw = w - ins.x * 2, ih = h - ins.y * 2;
    if (iw <= 0 || ih <= 0) return;
    const { chars: cs, rows } = layoutText(o.text, iw, ih, { wrap: !o.autoSize, align: o.align, valign: o.valign });
    for (const row of rows) {
      if (row.y >= ih) break;
      for (let k = row.start; k < row.end; k++) {
        const col = row.x + (k - row.start);
        if (col < 0 || col >= iw) continue;
        put(buf, x + ins.x + col, y + ins.y + row.y, cs[k], o.fg, o.bg, attr, font, owner, false, null, !o.transparent);
      }
    }
  }
}

function drawTable(buf, o, owner) {
  const t = tableLayout(o);
  const { x, y, w, h } = { x: o.x, y: o.y, w: t.w, h: t.h };
  const bc = borderChars(o);
  const hc = bc ? bc[1] : '─', vc = bc ? bc[7] : '│';
  const wt = WEIGHT[o.border] ?? (bc ? undefined : 1);
  const lfg = o.borderFg ?? o.fg;
  const attr = attrBits(o.attrs);
  const font = o.font || null;

  if (o.bg != null) for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) put(buf, c, r, ' ', o.fg, o.bg, 0, font, owner, false);
  if (o.headerBg != null && t.ys.length) {
    for (let r = t.ys[0]; r < t.ys[0] + o.rowHeights[0]; r++)
      for (let c = x + t.b; c < x + w - t.b; c++) put(buf, c, r, ' ', o.fg, o.headerBg, 0, font, owner, false);
  }

  // A table's own lines always join, even with junction merging switched off.
  const merge = buf.merge;
  buf.merge = true;
  if (bc) {
    const [tl, tp, tr, rt, br, bm, bl, lf] = bc;
    for (let c = x + 1; c < x + w - 1; c++) { put(buf, c, y, tp, lfg, o.bg, 0, null, owner, true); put(buf, c, y + h - 1, bm, lfg, o.bg, 0, null, owner, true); }
    for (let r = y + 1; r < y + h - 1; r++) { put(buf, x, r, lf, lfg, o.bg, 0, null, owner, true); put(buf, x + w - 1, r, rt, lfg, o.bg, 0, null, owner, true); }
    put(buf, x, y, tl, lfg, o.bg, 0, null, owner, true);
    put(buf, x + w - 1, y, tr, lfg, o.bg, 0, null, owner, true);
    put(buf, x, y + h - 1, bl, lfg, o.bg, 0, null, owner, true);
    put(buf, x + w - 1, y + h - 1, br, lfg, o.bg, 0, null, owner, true);
  }
  for (const ly of t.hlines)
    for (let c = x; c < x + w; c++)
      put(buf, c, ly, hc, lfg, o.bg, 0, null, owner, true, c === x ? { dir: 'e', weight: wt } : c === x + w - 1 ? { dir: 'w', weight: wt } : null);
  for (const lx of t.vlines)
    for (let r = y; r < y + h; r++)
      put(buf, lx, r, vc, lfg, o.bg, 0, null, owner, true, r === y ? { dir: 's', weight: wt } : r === y + h - 1 ? { dir: 'n', weight: wt } : null);
  buf.merge = merge;

  // cell text
  o.rowHeights.forEach((_, r) => o.colWidths.forEach((_, c) => {
    const f = cellFrame(o, r, c);
    if (!f.text) return;
    const iw = f.w - f.padding * 2;
    if (iw <= 0 || f.h <= 0) return;
    const head = o.header && r === 0;
    const fg = head && o.headerFg != null ? o.headerFg : o.fg;
    const bg = head && o.headerBg != null ? o.headerBg : o.bg;
    const { chars: cs, rows } = layoutText(f.text, iw, f.h, { wrap: true, align: f.align });
    for (const row of rows) {
      if (row.y >= f.h) break;
      for (let k = row.start; k < row.end; k++) {
        const col = row.x + (k - row.start);
        if (col < 0 || col >= iw) continue;
        put(buf, f.x + f.padding + col, f.y + row.y, cs[k], fg, bg, attr | (head ? ATTR.bold : 0), font, owner, false, null, true);
      }
    }
  }));
}

export function drawObject(buf, o, owner = o.id) {
  const attr = attrBits(o.attrs);
  const font = o.font || null;
  switch (o.type) {
    case 'box':
    case 'text':
      drawFrame(buf, o, owner);
      break;
    case 'line': {
      const cells = lineCells(o);
      cells.forEach((c, k) => {
        const end = k === 0 ? o.start : k === cells.length - 1 ? o.end : null;
        const stub = cells.length > 1 && end === 'none' && c.dirs.size === 1
          ? { dir: [...c.dirs][0], weight: WEIGHT[o.style] } : null;
        put(buf, c.x, c.y, c.ch, o.fg, o.bg, attr, font, owner, true, stub);
      });
      break;
    }
    case 'block': {
      const g = chars(o.glyph)[0] ?? '█';
      for (let r = o.y; r < o.y + o.h; r++)
        for (let c = o.x; c < o.x + o.w; c++) put(buf, c, r, g, o.fg, o.bg, attr, font, owner, false);
      break;
    }
    case 'cursor':
      put(buf, o.x, o.y, chars(o.glyph)[0] ?? '█', o.fg, o.bg, attr | (o.blink ? ATTR.blink : 0), font, owner, false);
      break;
    case 'paint':
      for (const [dx, dy, ch, fg, bg] of o.cells)
        put(buf, o.x + dx, o.y + dy, ch, fg ?? o.fg, bg ?? o.bg, attr, font, owner, false);
      break;
    case 'group':
      for (const c of o.children) if (!c.hidden) drawObject(buf, c, owner);
      break;
    case 'table':
      drawTable(buf, o, owner);
      break;
  }
}

// Flatten a tab's visible layers into one grid (the first tab unless `tab`
// says otherwise). Junctions merge within a layer only, so a popup on its own
// layer doesn't fuse with the boxes underneath.
export function composite(project, { tab = project.tabs[0], layers = tab.layers, merge = project.mergeJunctions !== false } = {}) {
  const { cols, rows } = tab;
  const grid = makeGrid(cols, rows);
  for (const layer of layers) {
    if (!layer.visible) continue;
    const buf = makeGrid(cols, rows);
    buf.merge = merge;
    for (const o of layer.objects) if (!o.hidden) drawObject(buf, o);
    for (const i of buf.touched) {
      if (grid.owner[i] === null) grid.touched.push(i);
      grid.ch[i] = buf.ch[i];
      grid.fg[i] = buf.fg[i];
      if (buf.bg[i] != null || buf.cover[i]) grid.bg[i] = buf.bg[i];
      grid.attr[i] = buf.attr[i];
      grid.font[i] = buf.font[i];
      grid.owner[i] = buf.owner[i];
    }
  }
  return grid;
}

// Composite a loose list of objects (snippet previews, selections).
export function compositeObjects(objects, cols, rows, merge = true) {
  return composite({}, { tab: { cols, rows, layers: [{ visible: true, objects }] }, merge });
}
