import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeProject, makeBox, makeText, makeLine, makeBlock, makeCursor, makePaint, makeGroup,
  bounds, translate, hitTest, linePath, lineCells, layoutText, fitText, caretCell, indexAtCell, cloneObject,
} from '../public/js/model.js';
import { composite } from '../public/js/composite.js';
import { toText, toMarkdown, toAnsi, projectFromMarkdown, contentRect } from '../public/js/export.js';
import { THEMES } from '../public/js/themes.js';
import { BUILTIN_SNIPPETS, sampleProject } from '../public/js/snippets.js';

const project = (objects, opts = {}) => {
  const p = makeProject({ cols: 20, rows: 6, palette: THEMES[0], ...opts });
  p.tabs[0].layers[0].objects = objects;
  return p;
};
const text = (objects, opts) => toText(composite(project(objects, opts)));

test('box draws a border with a title', () => {
  assert.equal(text([makeBox(0, 0, 12, 3, { title: 'Hi' })]), '┌─ Hi ─────┐\n│          │\n└──────────┘\n\n\n');
});

test('border styles', () => {
  assert.equal(text([makeBox(0, 0, 3, 2, { border: 'double' })]).split('\n')[0], '╔═╗');
  assert.equal(text([makeBox(0, 0, 3, 2, { border: 'rounded' })]).split('\n')[1], '╰─╯');
  assert.equal(text([makeBox(0, 0, 3, 2, { border: 'ascii' })]).split('\n')[0], '+-+');
  assert.equal(text([makeBox(0, 0, 3, 2, { border: 'custom', borderChars: 'abcdefgh' })]).split('\n').slice(0, 2).join('|'), 'abc|gfe');
});

test('touching boxes on one layer merge junctions', () => {
  const out = text([makeBox(0, 0, 5, 3), makeBox(4, 0, 5, 3)]);
  assert.equal(out.split('\n')[0], '┌───┬───┐');
  assert.equal(out.split('\n')[2], '└───┴───┘');
});

test('a divider line ending on a box edge makes tees, not crosses', () => {
  const out = text([makeBox(0, 0, 8, 4), makeLine(0, 2, 7, 2, { end: 'none' })]);
  assert.equal(out.split('\n')[2], '├──────┤');
});

test('junctions stay apart on different layers', () => {
  const p = project([makeBox(0, 0, 5, 3)]);
  p.tabs[0].layers.push({ id: 'l2', name: 'top', visible: true, locked: false, objects: [makeBox(4, 0, 5, 3)] });
  assert.equal(toText(composite(p)).split('\n')[0], '┌───┌───┐');
});

test('merging can be switched off', () => {
  assert.equal(text([makeBox(0, 0, 5, 3), makeBox(4, 0, 5, 3)], { mergeJunctions: false }).split('\n')[0], '┌───┌───┐');
});

test('hidden layers and objects are skipped', () => {
  const p = project([makeText(0, 0, 'a'), { ...makeText(1, 0, 'b'), hidden: true }]);
  p.tabs[0].layers.push({ id: 'l2', name: 'x', visible: false, locked: false, objects: [makeText(2, 0, 'c')] });
  assert.equal(toText(composite(p)).split('\n')[0], 'a');
});

test('text: typed spaces cover what is below, transparent text does not', () => {
  assert.equal(text([makeText(0, 0, 'xxxxx'), makeText(0, 0, 'a b')]).split('\n')[0], 'a bxx');
  assert.equal(text([makeText(0, 0, 'xxxxx'), makeText(0, 0, 'a b', { transparent: true })]).split('\n')[0], 'axbxx');
});

test('text wraps inside a fixed frame and aligns', () => {
  const o = makeBox(0, 0, 10, 4, { text: 'hello big world', padding: 1 });
  assert.equal(text([o]).split('\n').slice(1, 3).join('|'), '│ hello  │|│ big    │');
  const c = makeBox(0, 0, 10, 3, { text: 'hi', align: 'center', padding: 0 });
  assert.equal(text([c]).split('\n')[1], '│   hi   │');
});

test('autoSize text fits its content', () => {
  const o = makeText(0, 0, 'abc\nde');
  assert.deepEqual([o.w, o.h], [3, 2]);
  o.border = 'single'; o.padding = 1; fitText(o);
  assert.deepEqual([o.w, o.h], [7, 4]);
});

test('layoutText word wraps and hard breaks long words', () => {
  const { rows, chars } = layoutText('aaaa bb cccccccc', 5, 10);
  assert.deepEqual(rows.map(r => chars.slice(r.start, r.end).join('')), ['aaaa', 'bb', 'ccccc', 'ccc']);
});

test('caret positions round-trip', () => {
  const o = makeText(3, 2, 'ab\ncd');
  assert.deepEqual([caretCell(o, 4).x, caretCell(o, 4).y], [1, 1]);
  assert.equal(indexAtCell(o, 1, 1), 4);
  assert.equal(indexAtCell(o, 99, 0), 2);
});

test('lines route with an elbow and caps', () => {
  const o = makeLine(0, 0, 4, 2, { end: 'arrow' });
  assert.equal(text([o]).split('\n').slice(0, 3).join('|'), '────┐|    │|    ▼');
  const v = makeLine(0, 0, 4, 2, { route: 'vh', start: 'dot', end: 'arrow', style: 'heavy' });
  assert.equal(text([v]).split('\n').slice(0, 3).join('|'), '●|┃|┗━━━▶');
  const a = makeLine(0, 0, 3, 0, { style: 'ascii', end: 'arrow' });
  assert.equal(text([a]).split('\n')[0], '--->');
});

test('linePath gives each cell its connections', () => {
  const path = linePath(makeLine(0, 0, 2, 1));
  assert.deepEqual(path.map(c => [c.x, c.y, [...c.dirs].sort().join('')]), [[0, 0, 'e'], [1, 0, 'ew'], [2, 0, 'sw'], [2, 1, 'n']]);
  assert.equal(lineCells(makeLine(1, 1, 1, 1)).length, 1);
});

test('block, cursor and paint objects', () => {
  assert.equal(text([makeBlock(0, 0, 3, 2, '▓')]).split('\n').slice(0, 2).join('|'), '▓▓▓|▓▓▓');
  assert.equal(text([makeCursor(2, 0, '▌')]).split('\n')[0], '  ▌');
  const p = makePaint(1, 1, { cells: [[0, 0, '#', null, null], [2, -1, '*', 'red', null]] });
  assert.equal(text([p]).split('\n').slice(0, 2).join('|'), '   *| #');
  assert.deepEqual(bounds(p), { x: 1, y: 0, w: 3, h: 2 });
});

test('groups move and hit-test as a unit', () => {
  const g = makeGroup([makeText(0, 0, 'ab'), makeLine(0, 2, 3, 2, { end: 'none' })]);
  translate(g, 2, 1);
  assert.deepEqual(bounds(g), { x: 2, y: 1, w: 4, h: 3 });
  assert.ok(hitTest(g, 3, 1));
  assert.ok(hitTest(g, 5, 3));
  assert.ok(!hitTest(g, 5, 1));
  const c = cloneObject(g);
  assert.notEqual(c.id, g.id);
  assert.notEqual(c.children[0].id, g.children[0].id);
});

test('backgrounds show through text without a background', () => {
  const p = project([makeBox(0, 0, 6, 3, { bg: 'blue' }), makeText(1, 1, 'hi', { fg: 'red' })]);
  const g = composite(p);
  const i = 1 * 20 + 1;
  assert.equal(g.ch[i], 'h');
  assert.equal(g.fg[i], 'red');
  assert.equal(g.bg[i], 'blue');
});

test('markdown export fences, embeds and round-trips', () => {
  const p = project([makeText(0, 0, 'a `code` --> b')]);
  const md = toMarkdown(p, composite(p), { embed: true });
  assert.match(md, /^# Untitled\n\n```text\na `code` --> b\n/);
  assert.equal(md.split('-->').length, 3, 'only the comment closer and the text contain -->');
  assert.deepEqual(projectFromMarkdown(md), JSON.parse(JSON.stringify(p)));
  const fenced = toMarkdown(p, composite(project([makeText(0, 0, '```')])));
  assert.match(fenced, /````text/);
});

test('crop to content', () => {
  const g = composite(project([makeText(3, 2, 'xy')]));
  assert.deepEqual(contentRect(g), { x: 3, y: 2, w: 2, h: 1 });
  assert.equal(toText(g, { crop: true }), 'xy');
});

test('ANSI export maps palette slots to terminal colors', () => {
  const p = project([makeText(0, 0, 'R', { fg: 'red', attrs: { bold: true } }), makeText(1, 0, 'B', { fg: 'bright_blue', bg: 'green' }), makeText(2, 0, 'x')]);
  const g = composite(p);
  assert.equal(toAnsi(g, p).split('\n')[0], '\x1b[0;1;31mR\x1b[0;94;42mB\x1b[0mx');
  const tc = toAnsi(g, p, { mode: 'truecolor' }).split('\n')[0];
  assert.match(tc, /^\x1b\[0;1;38;2;\d+;\d+;\d+;48;2;\d+;\d+;\d+mR/);
});

test('built-in snippets and the sample project compose cleanly', () => {
  assert.ok(BUILTIN_SNIPPETS.length > 20);
  for (const s of BUILTIN_SNIPPETS) {
    assert.ok(s.w > 0 && s.h > 0, s.name);
    const b = bounds({ type: 'group', children: s.objects });
    assert.deepEqual([b.x, b.y], [0, 0], s.name + ' starts at 0,0');
  }
  const p = sampleProject('monospace');
  p.palette = THEMES[0];
  const out = toText(composite(p));
  assert.match(out, /╭─ Welcome to OTIS ─/);
  assert.match(out, /├─+┴─+┤/);
});

// ── Tables ───────────────────────────────────────────────────────────────────

import { makeTable, tableLayout, tableCellAt, cellFrame, tableEdges, fitTableTo, resizeTable } from '../public/js/model.js';

const tbl = opts => {
  const t = makeTable(0, 0, 2, 3, { colWidths: [5, 4], ...opts });
  t.cells = [['A', 'B'], ['a1', 'b1'], ['a2', 'b2']];
  return t;
};
const lines = (t, opts) => text([t], { cols: 30, rows: 10, ...opts }).replace(/\n+$/, '').split('\n');

test('table draws a header line and joined dividers', () => {
  assert.deepEqual(lines(tbl()), [
    '┌─────┬────┐',
    '│ A   │ B  │',
    '├─────┼────┤',
    '│ a1  │ b1 │',
    '│ a2  │ b2 │',
    '└─────┴────┘',
  ]);
});

test('table row lines, styles and no border', () => {
  assert.deepEqual(lines(tbl({ rowLines: true, border: 'double' })).slice(3, 6), ['║ a1  ║ b1 ║', '╠═════╬════╣', '║ a2  ║ b2 ║']);
  assert.deepEqual(lines(tbl({ border: 'none' })), [' A   │ B', '─────┼────', ' a1  │ b1', ' a2  │ b2']);
});

test('table lines join even with junction merging off', () => {
  assert.equal(lines(tbl(), { mergeJunctions: false })[2], '├─────┼────┤');
});

test('table geometry, cells and edges', () => {
  const t = tbl();
  assert.deepEqual(bounds(t), { x: 0, y: 0, w: 12, h: 6 });
  const L = tableLayout(t);
  assert.deepEqual([L.xs, L.ys, L.vlines, L.hlines], [[1, 7], [1, 3, 4], [6], [2]]);
  assert.deepEqual(tableCellAt(t, 8, 3), [1, 1]);
  assert.deepEqual(tableCellAt(t, 6, 1), [0, 0], 'a divider counts as the cell before it');
  const f = cellFrame(t, 1, 1);
  assert.deepEqual([f.x, f.y, f.w, f.h, f.text], [7, 3, 4, 1, 'b1']);
  const E = tableEdges(t);
  assert.deepEqual(E.cols.map(c => [c.x, c.line]), [[6.5, true], [11.5, true]]);
  assert.deepEqual(E.rows.map(r => [r.y, r.line]), [[2.5, true], [4, false], [5.5, true]]);
});

test('table fits a dragged area and grows/shrinks', () => {
  const t = makeTable(0, 0, 3, 2);
  fitTableTo(t, 20, 6);
  assert.deepEqual(bounds(t), { x: 0, y: 0, w: 20, h: 6 });
  resizeTable(t, 4, 3);
  assert.equal(t.cells.length, 3);
  assert.ok(t.cells.every(r => r.length === 4));
  assert.equal(t.aligns.length, 4);
  resizeTable(t, 1, 1);
  assert.deepEqual([t.colWidths.length, t.rowHeights.length, t.cells[0].length], [1, 1, 1]);
});

test('table cell text wraps, aligns and clips', () => {
  const t = tbl({ colWidths: [6, 5], rowHeights: [1, 2, 1], aligns: ['left', 'right'] });
  t.cells[1][0] = 'hello world';
  assert.deepEqual(lines(t).slice(3, 5), ['│ hell │  b1 │', '│ o    │     │']);
});

// ── Tabs ─────────────────────────────────────────────────────────────────────

import { normalizeProject } from '../public/js/state.js';

test('a file from before tabs opens as one tab, "Main", that looks the same', () => {
  const box = makeBox(0, 0, 8, 3, { title: 'Old' });
  const v1 = {
    otis: 1, id: 'old1', name: 'Old', cols: 20, rows: 6, palette: THEMES[0],
    layers: [{ id: 'a1', name: 'Layer 1', visible: true, locked: false, objects: [box] }],
  };
  const before = toText(composite({ ...v1, tabs: [{ cols: 20, rows: 6, layers: v1.layers }] }));
  const p = normalizeProject(structuredClone(v1));
  assert.equal(p.otis, 2);
  assert.deepEqual(p.tabs.map(t => [t.id, t.name, t.cols, t.rows]), [['main', 'Main', 20, 6]]);
  assert.ok(!('layers' in p) && !('cols' in p) && !('rows' in p));
  assert.equal(toText(composite(p)), before);
  assert.deepEqual(normalizeProject(structuredClone(p)), p, 'normalizing again changes nothing');
});

test('each tab composites on its own canvas', () => {
  const p = project([makeText(0, 0, 'main')]);
  p.tabs.push({ id: 't2', name: 'Two', cols: 6, rows: 2, layers: [{ id: 'l9', name: 'L', visible: true, locked: false, objects: [makeText(1, 1, 'two')] }] });
  assert.equal(toText(composite(p)).split('\n')[0], 'main');
  const g = composite(p, { tab: p.tabs[1] });
  assert.deepEqual([g.cols, g.rows], [6, 2]);
  assert.equal(toText(g), '\n two');
  const md = toMarkdown(p, null, { tabs: p.tabs.map(t => ({ name: t.name, grid: composite(p, { tab: t }) })) });
  assert.match(md, /^# Untitled\n\n## Main\n\n```text\nmain\n[\s\S]*## Two\n\n```text\n\n two\n```/);
});

// ── Scaling a selection ──────────────────────────────────────────────────────

import { scaleObjects, unionBounds } from '../public/js/model.js';

test('scaling keeps shared cells shared, so junctions survive', () => {
  const objs = [makeBox(0, 0, 10, 4), makeBox(9, 0, 6, 4), makeLine(0, 2, 9, 2, { end: 'none' })];
  const from = unionBounds(objs.map(bounds));
  const big = scaleObjects(objs, from, { x: 0, y: 0, w: 29, h: 7 });
  const out = text(big, { cols: 30, rows: 7 }).split('\n');
  assert.equal(out[0], '┌─────────────────┬─────────┐');
  assert.match(out[4], /^├─+┤ +│$/);
  assert.equal(out[6], '└─────────────────┴─────────┘');
  assert.equal(objs[0].w, 10, 'the originals are untouched');
});

test('text that fits itself keeps its size; tables and drawings stretch', () => {
  const label = makeText(4, 1, 'hi');
  const [t] = scaleObjects([label], { x: 0, y: 0, w: 10, h: 3 }, { x: 0, y: 0, w: 20, h: 3 });
  assert.deepEqual([t.w, t.h, t.x], [2, 1, 10]);
  const tbl = makeTable(0, 0, 2, 2, { colWidths: [4, 2] });
  const b = bounds(tbl);
  const [s] = scaleObjects([tbl], b, { ...b, w: b.w + 6 });
  assert.deepEqual(s.colWidths, [8, 4]);
  const p = makePaint(0, 0, { cells: [[0, 0, '█', null, null], [1, 0, '░', null, null]] });
  const [q] = scaleObjects([p], bounds(p), { x: 0, y: 0, w: 4, h: 2 });
  assert.equal(toText(composite(project([q], { cols: 4, rows: 2 }))), '██░░\n██░░');
});

test('a solid fill hides the backgrounds underneath, on any layer', () => {
  // a highlighted row, then a popup with fill " " and no background over it
  const row = makeText(0, 1, 'Option 7  ', { bg: 'green' });
  const popup = makeBox(4, 0, 6, 3, { fill: ' ' });
  const g1 = composite(project([row, popup]));
  const p = project([row]);
  p.tabs[0].layers.push({ id: 'l2', name: 'Editing', visible: true, locked: false, objects: [popup] });
  const g2 = composite(p);
  for (const g of [g1, g2]) {
    assert.equal(g.bg[1 * 20 + 2], 'green', 'outside the popup the row keeps its color');
    assert.equal(g.bg[1 * 20 + 6], null, 'inside the popup the canvas shows');
    assert.equal(g.ch[1 * 20 + 6], ' ');
    assert.equal(g.bg[1 * 20 + 4], null, 'the popup\'s border covers it too');
    assert.equal(g.ch[1 * 20 + 4], '│');
  }
});
