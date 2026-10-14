// Sidebar panels (properties, layers), the tool bar, tool options and status bar.

import { el, $, prompt, confirmDialog } from './ui.js';
import { icon } from './icons.js';
import { state, on, emit, mutate, find, selected, select, setTool, setBrush, activeLayer, activeTab } from './state.js';
import {
  BORDERS, BORDER_NAMES, LINE_NAMES, LINES, CAP_NAMES, TYPE_NAMES, BLOCK_GLYPHS, CURSOR_GLYPHS,
  displayName, fitText, bounds, walk, chars, TABLE_BORDERS, resizeTable,
} from './model.js';
import { openColorPicker } from './colorpicker.js';
import { resolveColor } from './palette.js';
import * as A from './actions.js';
import { FONTS, isInstalled, localMonospaceFonts, rememberFont } from './fonts.js';
import { pointer } from './tools.js';
import { setHeader, panelBody } from './sidebar.js';
import { TEXTART_FONTS, TEXTART_SIZES } from './textart.js';
import { updateArt } from './artdialog.js';

export const hooks = { saveSnippet: null, showGlyphs: null, textArt: null };

// ── Form helpers ─────────────────────────────────────────────────────────────

// A labelled row. Only a lone input is wrapped in <label>: the browser treats a
// label's first button as hovered whenever any part of the label is, which lit
// up the first button of every button group.
const field = (label, ...controls) => {
  const lone = controls.length === 1 && ['INPUT', 'SELECT', 'TEXTAREA'].includes(controls[0]?.tagName);
  return el((lone ? 'label' : 'div') + '.field', {}, el('span.label', {}, label), el('span.controls', {}, ...controls));
};
const group = (title, ...rows) => el('div.group', {}, title ? el('h4', {}, title) : null, ...rows);
// First item of a panel body: the title and buttons for the panel header.
const head = (title, ...actions) => ({ head: true, title, actions });
const iconBtn = (name, title, onclick, cls = '') => el('button.icon' + cls, { type: 'button', title, 'aria-label': title, onclick }, icon(name));

function num(value, onchange, { min = -9999, max = 9999, width = '' } = {}) {
  return el('input.num' + width, {
    type: 'number', value, min, max, step: 1,
    onchange: e => { const v = Math.round(+e.target.value); if (Number.isFinite(v)) onchange(Math.max(min, Math.min(max, v))); },
  });
}

function txt(value, oninput, { placeholder = '', maxlength = null } = {}) {
  return el('input', { type: 'text', value: value ?? '', placeholder, maxlength, spellcheck: false, oninput: e => oninput(e.target.value) });
}

function sel(options, value, onchange) {
  return el('select', { onchange: e => onchange(e.target.value) },
    ...options.map(([v, label]) => el('option', { value: v, selected: v === value }, label)));
}

function check(label, value, onchange) {
  return el('label.check', {}, el('input', { type: 'checkbox', checked: !!value, onchange: e => onchange(e.target.checked) }), label);
}

function seg(options, value, onchange) {
  return el('div.seg', {}, ...options.map(([v, label, title]) => el('button' + (v === value ? '.on' : ''), {
    type: 'button', title: title || label, onclick: () => onchange(v),
  }, label)));
}

export function colorChip(value, onchange, { allowNone = true, title = '' } = {}) {
  const swatch = el('span.sw');
  const label = el('span.chip-label');
  const b = el('button.chip', { type: 'button', title }, swatch, label);
  const paint = v => {
    const hex = resolveColor(v, state.project?.palette);
    swatch.style.background = hex || '';
    swatch.classList.toggle('none', !hex);
    label.textContent = v == null ? 'default' : v;
  };
  paint(value);
  b.addEventListener('click', () => openColorPicker({
    anchor: b, value, palette: state.project?.palette, allowNone,
    onInput: v => { paint(v); onchange(v); },
    onChange: v => { value = v; paint(v); onchange(v); },
  }));
  return b;
}

function glyphPicker(value, onchange, quick) {
  const input = txt(value, v => { const c = chars(v); if (c.length) onchange(c[c.length - 1]); }, { maxlength: 4 });
  input.classList.add('glyph-input');
  return el('span.glyph-pick', {}, input, ...quick.map(g => el('button.glyph' + (g === value ? '.on' : ''), {
    type: 'button', title: 'U+' + g.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'), onclick: () => onchange(g),
  }, g === ' ' ? '␠' : g)));
}

// Change fields on objects (with undo coalescing per object+field).
function setOn(objs, patch, key) {
  mutate(() => {
    for (const o of objs) {
      Object.assign(o, structuredClone(patch));
      if ((o.type === 'text' || o.type === 'box') && o.autoSize) fitText(o);
    }
  }, { coalesce: key + ':' + objs.map(o => o.id).join(',') });
}

// Colors/attrs apply through groups to their children.
function leaves(objs) {
  const out = [];
  for (const o of objs) for (const n of walk([o])) if (n.type !== 'group') out.push(n);
  return out;
}

// ── Properties panel ─────────────────────────────────────────────────────────

let propsQueued = false;
function queueProps() {
  if (propsQueued) return;
  propsQueued = true;
  requestAnimationFrame(() => { propsQueued = false; renderProps(); });
}

// Redrawing the panel would drop the caret of someone typing in it, so edits
// wait for them to leave the field. A list, button or checkbox redraws at
// once: it can show or hide other fields (a border's title, say).
function typingInProps() {
  const a = document.activeElement;
  return panelBody('props').contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['checkbox', 'radio'].includes(a.type)));
}

let propsShowing = null;
function renderProps() {
  const root = panelBody('props');
  const sel = selected();
  let body;
  if (!sel.length) body = canvasProps();
  else if (sel.length === 1) body = objectProps(sel[0]);
  else body = multiProps(sel);
  const [h, ...rest] = body;
  setHeader('props', h.title, h.actions);
  // keep the focus on the same control when the panel shows the same objects
  const controls = () => [...root.querySelectorAll('input, select, textarea, button')];
  const showing = sel.map(o => o.id).join(',');
  const focused = document.activeElement;
  const at = showing === propsShowing && root.contains(focused) ? controls().indexOf(focused) : -1;
  propsShowing = showing;
  root.replaceChildren(...rest);
  const again = at >= 0 && controls()[at];
  if (again && again.tagName === focused.tagName && again.type === focused.type) again.focus();
}

function canvasProps() {
  const p = state.project;
  const tab = activeTab();
  const set = (patch, key) => mutate(pr => Object.assign(pr, patch), { coalesce: 'canvas:' + key });
  const size = (patch, key) => mutate(() => Object.assign(activeTab(), patch), { coalesce: 'canvas:' + key + ':' + tab.id });
  const presets = [['', 'Presets…'], ['80x24', '80 × 24 (classic)'], ['100x30', '100 × 30'], ['120x40', '120 × 40'], ['160x50', '160 × 50'], ['200x60', '200 × 60']];
  const fontOpts = [...new Set([p.font.family, ...FONTS, ...extraFonts])].map(f => [f, (isInstalled(f) ? '' : '⚠ ') + f]);
  const fontWarn = isInstalled(p.font.family) ? null
    : el('p.warn', {}, `“${p.font.family}” isn't installed on this computer, so a fallback font is drawn. Box lines still connect.`);
  return [
    head('Canvas'),
    group(null,
      field('Name', txt(p.name, v => set({ name: v }, 'name'))),
      field(p.tabs.length > 1 ? 'Tab size' : 'Size',
        num(tab.cols, v => size({ cols: v }, 'cols'), { min: 1, max: 1000, width: '.w4' }), el('span.x', {}, '×'),
        num(tab.rows, v => size({ rows: v }, 'rows'), { min: 1, max: 1000, width: '.w4' }),
        sel(presets, '', v => { if (v) { const [c, r] = v.split('x').map(Number); size({ cols: c, rows: r }, 'size'); } })),
    ),
    group('Font',
      field('Family', sel(fontOpts, p.font.family, v => { set({ font: { ...p.font, family: v } }, 'font'); rememberFont(v); })),
      field('Custom', txt('', () => {}, { placeholder: 'Type any installed font…' }), el('button', {
        type: 'button', onclick: e => {
          const v = e.target.previousElementSibling.value.trim();
          if (v) { extraFonts.push(v); set({ font: { ...p.font, family: v } }, 'font'); rememberFont(v); }
        },
      }, 'Use')),
      window.queryLocalFonts ? field('', el('button', { type: 'button', onclick: findFonts }, 'Find installed monospace fonts')) : null,
      fontWarn,
      field('Size', num(p.font.size, v => set({ font: { ...p.font, size: v } }, 'fsize'), { min: 6, max: 72, width: '.w4' }), el('span.unit', {}, 'px'),
        el('span.label.inline', {}, 'Line'), el('input.num.w4', {
          type: 'number', step: 0.05, min: 0.8, max: 2, value: p.font.lineHeight,
          onchange: e => set({ font: { ...p.font, lineHeight: Math.max(0.8, Math.min(2, +e.target.value || 1.2)) } }, 'lh'),
        })),
    ),
    group('Colors',
      field('Background', colorChip(p.background, v => set({ background: v }, 'bg'), { allowNone: false })),
      field('Text', colorChip(p.foreground, v => set({ foreground: v }, 'fg'), { allowNone: false })),
    ),
    group('Lines',
      check('Join box lines that touch (on the same layer)', p.mergeJunctions !== false, v => set({ mergeJunctions: v }, 'merge')),
    ),
    el('p.hint', {}, 'Nothing selected. Pick a tool on the left, or click an object to edit it.'),
  ];
}

const extraFonts = [];
async function findFonts() {
  try {
    const list = await localMonospaceFonts();
    if (list?.length) { extraFonts.push(...list); queueProps(); }
  } catch { /* permission denied */ }
}

function objectProps(o) {
  const hit = find(o.id);
  const key = f => o.id + ':' + f;
  const set = (patch, f) => setOn([o], patch, key(f));
  const p = state.project;
  const rows = [];
  const b = bounds(o);

  rows.push(head(o.art ? 'TextArt' : TYPE_NAMES[o.type] || o.type,
    iconBtn('copy', 'Duplicate (Ctrl+D)', () => A.duplicate()),
    iconBtn('trash', 'Delete (Del)', () => A.deleteSelection())));
  rows.push(group(null, field('Name', txt(o.name, v => set({ name: v }, 'name'), { placeholder: displayName({ ...o, name: '' }) }))));

  // geometry
  if (o.type === 'line') {
    rows.push(group('Points',
      ...o.points.map((pt, i) => field(i === 0 ? 'Start' : i === o.points.length - 1 ? 'End' : 'Point ' + i,
        num(pt[0], v => set({ points: o.points.map((q, k) => k === i ? [v, q[1]] : q) }, 'pts'), { width: '.w4' }),
        num(pt[1], v => set({ points: o.points.map((q, k) => k === i ? [q[0], v] : q) }, 'pts'), { width: '.w4' }))),
      field('Route', seg([['hv', '─┐', 'Horizontal first'], ['vh', '│└', 'Vertical first']], o.route, v => set({ route: v }, 'route'))),
    ));
  } else if (o.type !== 'group' && o.type !== 'paint') {
    rows.push(group(null,
      field('Position', el('span.label.inline', {}, 'X'), num(o.x, v => set({ x: v }, 'x'), { width: '.w4' }),
        el('span.label.inline', {}, 'Y'), num(o.y, v => set({ y: v }, 'y'), { width: '.w4' })),
      ['box', 'text', 'block'].includes(o.type) ? field('Size',
        el('span.label.inline', {}, 'W'), num(o.w, v => set({ w: v, autoSize: false }, 'w'), { min: 1, width: '.w4' }),
        el('span.label.inline', {}, 'H'), num(o.h, v => set({ h: v, autoSize: false }, 'h'), { min: 1, width: '.w4' })) : null));
  } else {
    rows.push(group(null, el('p.hint', {}, `${b.w} × ${b.h} at ${b.x}, ${b.y}`)));
  }

  // type-specific
  if (o.art) rows.push(artProps(o));
  if (o.type === 'box' || o.type === 'text') rows.push(...frameProps(o, set));
  if (o.type === 'table') rows.push(...tableProps(o, set));
  if (o.type === 'line') rows.push(group('Line',
    field('Style', sel(Object.entries(LINE_NAMES), o.style, v => set({ style: v }, 'style'))),
    field('Start', sel(Object.entries(CAP_NAMES), o.start, v => set({ start: v }, 'start'))),
    field('End', sel(Object.entries(CAP_NAMES), o.end, v => set({ end: v }, 'end'))),
  ));
  if (o.type === 'block') rows.push(group('Block', field('Glyph', glyphPicker(o.glyph, v => set({ glyph: v }, 'glyph'), BLOCK_GLYPHS.slice(0, 8)))));
  if (o.type === 'cursor') rows.push(group('Cursor',
    field('Glyph', glyphPicker(o.glyph, v => set({ glyph: v }, 'glyph'), CURSOR_GLYPHS.slice(0, 8))),
    check('Blink', o.blink, v => set({ blink: v }, 'blink')),
  ));
  if (o.type === 'paint') rows.push(group('Drawing',
    el('p.hint', {}, `${o.cells.length} cells drawn with the pencil.`),
    field('', el('button', {
      type: 'button', title: 'Make every cell use this object\'s colors',
      onclick: () => mutate(() => { o.cells = o.cells.map(([x, y, ch]) => [x, y, ch, null, null]); }),
    }, 'Use object colors for all cells')),
  ));
  if (o.type === 'group') rows.push(group('Group',
    el('p.hint', {}, `${o.children.length} objects. Colors below apply to all of them.`),
    field('', el('button', { type: 'button', onclick: A.ungroup }, 'Ungroup'), el('button', { type: 'button', onclick: () => hooks.saveSnippet?.() }, 'Save as snippet')),
  ));

  rows.push(styleGroup([o], o));
  rows.push(arrangeGroup(hit));
  return rows;
}

// A TextArt object's text, font and size; changing one draws it again.
function artProps(o) {
  const font = TEXTART_FONTS.find(f => f.id === o.art.font) || TEXTART_FONTS[0];
  const change = (patch, f) => updateArt(o.id, patch, o.id + ':art-' + f);
  return group('TextArt',
    field('Text', txt(o.art.text, v => change({ text: v }, 'text'))),
    field('Font', sel(TEXTART_FONTS.map(f => [f.id, f.name]), font.id, v => change({ font: v }, 'font'))),
    field('Size', el('div.seg', {}, ...TEXTART_SIZES.map(([k, label]) => el('button' + (k === o.art.size ? '.on' : ''), {
      type: 'button', disabled: !font.sizes[k], title: font.sizes[k] ? label : `${font.name} has no ${label.toLowerCase()} size`,
      onclick: () => change({ size: k }, 'size'),
    }, label)))),
    field('', el('button', { type: 'button', onclick: () => hooks.textArt?.(o) }, 'Preview fonts…')),
  );
}

const borderLabel = k => k in BORDERS ? `${BORDERS[k].slice(0, 3)}  ${BORDER_NAMES[k]}` : BORDER_NAMES[k];

function tableProps(o, set) {
  const n = o.colWidths.length, m = o.rowHeights.length;
  const stepper = (value, onset) => el('div.seg', {},
    el('button', { type: 'button', title: 'Remove one', disabled: value <= 1, onclick: () => onset(value - 1) }, '−'),
    el('button.count', { type: 'button', disabled: true }, String(value)),
    el('button', { type: 'button', title: 'Add one', onclick: () => onset(value + 1) }, '+'));
  const restructure = (cols, rows) => mutate(() => resizeTable(o, cols, rows));
  const replace = (key, i, v) => o[key].map((x, k) => k === i ? v : x);
  return [
    group('Table',
      field('Columns', stepper(n, v => restructure(v, m))),
      field('Rows', stepper(m, v => restructure(n, v))),
      field('Border', sel(TABLE_BORDERS.map(k => [k, borderLabel(k)]), o.border || 'none', v => set({ border: v }, 'border'))),
      check('Header row', o.header, v => set({ header: v }, 'header')),
      check('Lines between rows', o.rowLines, v => set({ rowLines: v }, 'rowLines')),
      check('Lines between columns', o.colLines, v => set({ colLines: v }, 'colLines')),
      field('Padding', num(o.padding ?? 1, v => set({ padding: v }, 'pad'), { min: 0, max: 10, width: '.w4' }), el('span.unit', {}, 'columns')),
      o.header ? field('Header', colorChip(o.headerFg ?? null, v => set({ headerFg: v }, 'hfg'), { title: 'Header text color' }),
        colorChip(o.headerBg ?? null, v => set({ headerBg: v }, 'hbg'), { title: 'Header background' })) : null,
    ),
    group('Columns',
      ...o.colWidths.map((w, i) => field(`Column ${i + 1}`,
        num(w, v => set({ colWidths: replace('colWidths', i, v) }, 'cw' + i), { min: 1, max: 500, width: '.w4' }),
        seg([['left', '⇤', 'Align left'], ['center', '↔', 'Center'], ['right', '⇥', 'Align right']], o.aligns?.[i] || 'left',
          v => set({ aligns: replace('aligns', i, v) }, 'al' + i)))),
      field('', el('button', {
        type: 'button', onclick: () => {
          const even = Math.max(1, Math.round(o.colWidths.reduce((a, b) => a + b, 0) / n));
          set({ colWidths: o.colWidths.map(() => even) }, 'even');
        },
      }, 'Even out widths')),
      el('p.hint', {}, 'Drag column and row edges on the canvas to resize. Double-click a cell to type; Tab moves to the next cell (and adds a row at the end).'),
    ),
  ];
}

function frameProps(o, set) {
  const out = [];
  const borderOpts = Object.entries(BORDER_NAMES).map(([k, n]) => [k, k in BORDERS ? `${BORDERS[k].slice(0, 3)}  ${n}` : n]);
  out.push(group('Border',
    field('Style', sel(borderOpts, o.border || 'none', v => set({ border: v, borderChars: v === 'custom' ? (o.borderChars || BORDERS.single) : o.borderChars }, 'border'))),
    o.border === 'custom' ? field('Chars', txt(o.borderChars, v => set({ borderChars: v }, 'bchars'), { placeholder: '┌─┐│┘─└│' }),
      el('span.hint.inline', {}, 'TL T TR R BR B BL L')) : null,
    o.border && o.border !== 'none' ? field('Title', txt(o.title, v => set({ title: v }, 'title'), { placeholder: 'Shown on the top border' })) : null,
    o.border && o.border !== 'none' && o.title ? field('Title align', seg([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], o.titleAlign, v => set({ titleAlign: v }, 'talign'))) : null,
  ));
  // TextArt draws its own characters, so it has no text box here
  const ta = o.art ? null : el('textarea', { rows: Math.min(10, Math.max(3, (o.text || '').split('\n').length + 1)), spellcheck: false, placeholder: 'Type text… (or double-click the object on the canvas)' }, o.text || '');
  ta?.addEventListener('input', () => set({ text: ta.value }, 'text'));
  out.push(group('Text',
    ta,
    field('Align', seg([['left', '⇤'], ['center', '↔'], ['right', '⇥']], o.align, v => set({ align: v }, 'align')),
      seg([['top', '⤒'], ['middle', '↕'], ['bottom', '⤓']], o.valign, v => set({ valign: v }, 'valign'))),
    field('Padding', num(o.padding || 0, v => set({ padding: v }, 'pad'), { min: 0, max: 20, width: '.w4' }), el('span.unit', {}, 'columns')),
    check('Size to fit text', o.autoSize, v => set({ autoSize: v }, 'auto')),
    check('Spaces are see-through (for ASCII art)', o.transparent, v => set({ transparent: v }, 'transp')),
  ));
  out.push(group('Fill',
    field('Interior', sel([['none', 'See-through'], ['space', 'Solid (background color)'], ['char', 'Character…']],
      o.fill == null ? 'none' : o.fill === ' ' ? 'space' : 'char',
      v => set({ fill: v === 'none' ? null : v === 'space' ? ' ' : '░' }, 'fill')),
      o.fill != null && o.fill !== ' ' ? txt(o.fill, v => { const c = chars(v); if (c.length) set({ fill: c[c.length - 1] }, 'fillch'); }, { maxlength: 4 }) : null),
  ));
  return out;
}

function styleGroup(objs, single = null) {
  const leafs = leaves(objs);
  const first = single && single.type !== 'group' ? single : leafs[0] || {};
  const attrs = first.attrs || {};
  const setAll = (patch, f) => setOn(leafs, patch, f);
  const toggle = (k, label, title) => el('button' + (attrs[k] ? '.on' : ''), {
    type: 'button', title, onclick: () => setAll({ attrs: { ...attrs, [k]: !attrs[k] } }, 'attr'),
  }, label);
  const fontOpts = [['', 'Project font'], ...[...new Set([...FONTS, ...extraFonts])].map(f => [f, (isInstalled(f) ? '' : '⚠ ') + f])];
  return group('Style',
    field('Text color', colorChip(first.fg ?? null, v => setAll({ fg: v }, 'fg'))),
    field('Background', colorChip(first.bg ?? null, v => setAll({ bg: v }, 'bg'))),
    ['box', 'text', 'table'].includes(first.type)
      ? field(first.type === 'table' ? 'Line color' : 'Border color', colorChip(first.borderFg ?? null,
        v => setOn(leafs.filter(o => ['box', 'text', 'table'].includes(o.type)), { borderFg: v }, 'bfg')))
      : null,
    field('Attributes', el('div.seg', {},
      toggle('bold', 'B', 'Bold'), toggle('italic', 'I', 'Italic'), toggle('underline', 'U', 'Underline'),
      toggle('strike', 'S', 'Strikethrough'), toggle('dim', 'D', 'Dim'))),
    field('Font', sel(fontOpts, first.font || '', v => setAll({ font: v || null }, 'font'))),
  );
}

function arrangeGroup(hit) {
  const layers = [...activeTab().layers].reverse();
  return group('Arrange',
    field('Order', el('div.seg', {},
      el('button', { type: 'button', title: 'Bring to front (})', onclick: () => A.arrange(Infinity) }, '⤒'),
      el('button', { type: 'button', title: 'Bring forward (])', onclick: () => A.arrange(1) }, '↑'),
      el('button', { type: 'button', title: 'Send backward ([)', onclick: () => A.arrange(-1) }, '↓'),
      el('button', { type: 'button', title: 'Send to back ({)', onclick: () => A.arrange(-Infinity) }, '⤓'))),
    field('Align', el('div.seg', {},
      ...[['left', 'alignLeft', 'Align left'], ['hcenter', 'alignHCenter', 'Center horizontally'], ['right', 'alignRight', 'Align right'],
        ['top', 'alignTop', 'Align top'], ['vcenter', 'alignVCenter', 'Center vertically'], ['bottom', 'alignBottom', 'Align bottom']]
        .map(([m, ic, t]) => el('button', { type: 'button', title: t + (state.selection.length < 2 ? ' (on the canvas)' : ''), onclick: () => A.align(m) }, icon(ic, 15))))),
    hit ? field('Layer', sel(layers.map(l => [l.id, l.name]), hit.layer.id, v => A.moveToLayer(v))) : null,
    field('', el('button', { type: 'button', onclick: () => hooks.saveSnippet?.() }, 'Save as snippet')),
  );
}

function multiProps(sel) {
  return [
    head(`${sel.length} objects`,
      iconBtn('group', 'Group (Ctrl+G)', A.group),
      iconBtn('copy', 'Duplicate (Ctrl+D)', () => A.duplicate()),
      iconBtn('trash', 'Delete (Del)', A.deleteSelection)),
    styleGroup(sel),
    arrangeGroup(null),
  ];
}

// ── Layers panel ─────────────────────────────────────────────────────────────

const expanded = new Set();
let layersQueued = false;
let draggingObject = false;   // no re-render mid-drag (the AI may save meanwhile)
function queueLayers() {
  if (layersQueued) return;
  layersQueued = true;
  requestAnimationFrame(() => { layersQueued = false; if (!draggingObject) renderLayers(); });
}

const TYPE_ICON = { box: 'box', text: 'text', line: 'line', block: 'block', cursor: 'cursor', paint: 'paint', group: 'group', table: 'table' };

// Double-click that survives the list being redrawn between the two clicks
// (the first click selects, which redraws the Layers panel, and the browser
// then never sees a dblclick): two clicks on the same item within 400 ms.
let lastClick = { key: null, t: 0 };
function isDoubleClick(key) {
  const now = performance.now();
  const dbl = lastClick.key === key && now - lastClick.t < 400;
  lastClick = dbl ? { key: null, t: 0 } : { key, t: now };
  return dbl;
}

async function renameObject(o) {
  const v = await prompt('Rename object', o.name || '', { label: 'Leave it empty to use the automatic name.', placeholder: displayName({ ...o, name: '' }) });
  if (v !== null) A.renameObject(o.id, v);
}

async function deleteObject(o, l) {
  const ok = await confirmDialog('Delete object', `Delete “${displayName(o)}” from layer “${l.name}”? Ctrl+Z brings it back.`, 'Delete');
  if (ok === true) A.deleteObject(o.id);
}

// Drag an object row onto another layer (or between objects) to move it.
// A selected row drags the whole selection along.
function startObjectDrag(e, o, layer) {
  if (e.button !== 0 || layer.locked || e.target.closest('button')) return;
  const row = e.currentTarget;
  const x0 = e.clientX, y0 = e.clientY;
  const ids = state.selection.includes(o.id) ? [...state.selection] : [o.id];
  let ghost = null, marker = null, target = null;

  const clear = () => document.querySelectorAll('#layers .drop-into').forEach(n => n.classList.remove('drop-into'));
  // What's under the pointer: a layer row (drop on top of that layer) or an
  // object row (drop just above or below it, as it appears in the list).
  const dropTarget = (x, y) => {
    const hit = document.elementFromPoint(x, y)?.closest('#layers [data-layer]');
    const dest = hit && activeTab().layers.find(l => l.id === hit.dataset.layer);
    if (!dest || dest.locked) return null;
    const r = hit.getBoundingClientRect();
    if (!hit.dataset.id) return { layerId: dest.id, place: null, el: hit };
    const upper = y < r.top + r.height / 2;
    return { layerId: dest.id, place: upper ? { above: hit.dataset.id } : { below: hit.dataset.id }, el: hit, lineY: upper ? r.top : r.bottom, r };
  };

  const move = ev => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      draggingObject = true;
      ghost = el('div.panel-ghost.object-ghost', {}, ids.length > 1 ? `${ids.length} objects` : displayName(o));
      marker = el('div.drop-marker');
      document.body.append(ghost, marker);
      row.classList.add('moving');
    }
    ghost.style.left = ev.clientX + 12 + 'px';
    ghost.style.top = ev.clientY + 8 + 'px';
    target = dropTarget(ev.clientX, ev.clientY);
    clear();
    marker.hidden = !target?.place;
    if (target && !target.place) target.el.classList.add('drop-into');
    if (target?.place) Object.assign(marker.style, { left: target.r.left + 'px', width: target.r.width + 'px', top: target.lineY - 2 + 'px' });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (!ghost) return;
    ghost.remove();
    marker.remove();
    clear();
    draggingObject = false;
    if (target) {
      expanded.add(target.layerId);
      A.moveObjects(ids, target.layerId, target.place);
    }
    renderLayers();
  };
  // window listeners rather than pointer capture, so a plain click still
  // reaches the row's name (capture would retarget it to the row)
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function renderLayers() {
  const p = activeTab();
  const root = panelBody('layers');
  const selIds = new Set(state.selection);
  const list = el('ul.layer-list');
  for (const l of [...p.layers].reverse()) {
    const active = l.id === state.activeLayerId;
    const open = expanded.has(l.id);
    const name = el('span.name', { title: 'Double-click to rename' }, l.name);
    name.addEventListener('click', async e => {
      if (!isDoubleClick('layer:' + l.id)) return;
      e.stopPropagation();
      const v = await prompt('Rename layer', l.name);
      if (v) mutate(() => { l.name = v; });
    });
    const row = el('li.layer' + (active ? '.active' : '') + (l.visible ? '' : '.hidden'), {
      dataset: { layer: l.id },
      onclick: () => { state.activeLayerId = l.id; emit('selection'); },
    },
      el('button.icon.twist' + (open ? '.open' : ''), {
        type: 'button', title: open ? 'Collapse' : 'Show objects',
        onclick: e => { e.stopPropagation(); open ? expanded.delete(l.id) : expanded.add(l.id); renderLayers(); },
      }, icon('chevron', 14)),
      el('button.icon', { type: 'button', title: l.visible ? 'Hide layer' : 'Show layer', onclick: e => { e.stopPropagation(); mutate(() => { l.visible = !l.visible; }); } }, icon(l.visible ? 'eye' : 'eyeOff', 15)),
      el('button.icon' + (l.locked ? '.on' : ''), { type: 'button', title: l.locked ? 'Unlock layer' : 'Lock layer', onclick: e => { e.stopPropagation(); mutate(() => { l.locked = !l.locked; }); } }, icon(l.locked ? 'lock' : 'unlock', 15)),
      name,
      el('span.count', {}, String(l.objects.length)),
    );
    list.append(row);
    if (open) {
      const objs = el('ul.object-list');
      for (const o of [...l.objects].reverse()) {
        const oname = el('span.name', { title: l.locked ? displayName(o) : 'Drag to move to another layer · double-click to rename' }, displayName(o));
        oname.addEventListener('click', e => {
          if (l.locked || !isDoubleClick('object:' + o.id)) return;
          e.stopPropagation();
          renameObject(o);
        });
        const item = el('li.object' + (selIds.has(o.id) ? '.selected' : '') + (o.hidden ? '.hidden' : '') + (l.locked ? '.locked' : ''), {
          dataset: { layer: l.id, id: o.id },
          onclick: e => {
            if (l.locked) return;
            if (e.shiftKey) select([o.id], { add: true }); else select([o.id]);
          },
        },
          icon(TYPE_ICON[o.type] || 'box', 14),
          oname,
          l.locked ? null : el('button.icon.del', { type: 'button', title: 'Delete', onclick: e => { e.stopPropagation(); deleteObject(o, l); } }, icon('trash', 13)),
          el('button.icon', { type: 'button', title: o.hidden ? 'Show' : 'Hide', onclick: e => { e.stopPropagation(); mutate(() => { o.hidden = !o.hidden; }); } }, icon(o.hidden ? 'eyeOff' : 'eye', 13)),
        );
        item.addEventListener('pointerdown', e => startObjectDrag(e, o, l));
        objs.append(item);
      }
      if (!l.objects.length) objs.append(el('li.object.empty', { dataset: { layer: l.id } }, 'Empty layer'));
      list.append(objs);
    }
  }
  setHeader('layers', 'Layers', [
    iconBtn('plus', 'New layer', A.addLayer),
    iconBtn('copy', 'Duplicate layer', A.duplicateLayer),
    iconBtn('up', 'Move layer up', () => A.moveLayer(1)),
    iconBtn('down', 'Move layer down', () => A.moveLayer(-1)),
    iconBtn('trash', 'Delete layer', A.deleteLayer),
  ]);
  root.replaceChildren(list);
}

// ── Tool bar ─────────────────────────────────────────────────────────────────

export const TOOL_LIST = [
  ['select', 'Select & move', 'V'], ['box', 'Box', 'B'], ['text', 'Text', 'T'], ['line', 'Arrow / line', 'A'], ['table', 'Table', '#'],
  ['cursor', 'Cursor', 'C'], ['block', 'Block fill', 'K'], ['pencil', 'Pencil', 'P'], ['eraser', 'Eraser', 'E'], ['hand', 'Pan', 'H or hold Space'],
];

function renderToolbar() {
  const b = state.brush;
  const swap = el('button.icon.swap', { type: 'button', title: 'Swap text and background colors', onclick: () => setBrush({ fg: b.bg, bg: b.fg }) }, icon('swap', 14));
  $('#toolbar').replaceChildren(
    ...TOOL_LIST.map(([t, label, key]) => el('button.tool' + (state.tool === t ? '.on' : ''), {
      type: 'button', title: `${label} (${key})`, 'aria-label': label, onclick: () => setTool(t),
    }, icon(t === 'hand' ? 'hand' : t, 20))),
    el('button.tool', { type: 'button', title: 'TextArt: big letters from text (Shift+T)', 'aria-label': 'TextArt', onclick: () => hooks.textArt?.() }, icon('textart', 20)),
    el('div.sep'),
    el('div.brush-colors', {},
      el('div.brush-fg', { title: 'Text color for new objects' }, colorChip(b.fg, v => setBrush({ fg: v }))),
      el('div.brush-bg', { title: 'Background for new objects' }, colorChip(b.bg, v => setBrush({ bg: v }))),
      swap),
    el('button.glyph-chip', { type: 'button', title: 'Current glyph (pencil, block, cursor) — click for more', onclick: () => hooks.showGlyphs?.() }, b.glyph === ' ' ? '␠' : b.glyph),
  );
}

function renderOptions() {
  const b = state.brush;
  const t = state.tool;
  const glyphRow = list => el('div.opt', {}, el('span.label', {}, 'Glyph'), ...list.map(g => el('button.glyph' + (b.glyph === g ? '.on' : ''), {
    type: 'button', title: 'U+' + g.codePointAt(0).toString(16).toUpperCase(), onclick: () => setBrush({ glyph: g }),
  }, g === ' ' ? '␠' : g)), el('button', { type: 'button', onclick: () => hooks.showGlyphs?.() }, 'More…'));
  const hint = s => el('span.hint', {}, s);
  let parts;
  switch (t) {
    case 'box':
      parts = [el('div.opt', {}, el('span.label', {}, 'Border'), ...Object.entries(BORDERS).map(([k, chs]) => el('button.border-opt' + (b.box === k ? '.on' : ''), {
        type: 'button', title: BORDER_NAMES[k], onclick: () => setBrush({ box: k }),
      }, el('pre', {}, chs[0] + chs[1] + chs[2] + '\n' + chs[6] + chs[5] + chs[4])))), hint('Drag to draw · click for a 16×5 box')];
      break;
    case 'line':
      parts = [
        el('div.opt', {}, el('span.label', {}, 'Line'), ...Object.entries(LINES).map(([k, L]) => el('button.border-opt' + (b.line === k ? '.on' : ''), {
          type: 'button', title: LINE_NAMES[k], onclick: () => setBrush({ line: k }),
        }, el('pre', {}, L.h + L.h + L.sw + '\n  ' + L.v)))),
        el('div.opt', {}, el('span.label', {}, 'Start'), sel(Object.entries(CAP_NAMES), b.start, v => setBrush({ start: v })),
          el('span.label', {}, 'End'), sel(Object.entries(CAP_NAMES), b.end, v => setBrush({ end: v }))),
        hint('Drag to draw · the first direction you drag sets the elbow'),
      ];
      break;
    case 'table': {
      const count = (key, max) => el('input.num.w4', {
        type: 'number', min: 1, max, value: b[key],
        onchange: e => setBrush({ [key]: Math.max(1, Math.min(max, Math.round(+e.target.value) || 1)) }),
      });
      parts = [
        el('div.opt', {}, el('span.label', {}, 'Columns'), count('tableCols', 50), el('span.label', {}, 'Rows'), count('tableRows', 200)),
        el('div.opt', {}, el('span.label', {}, 'Border'), ...TABLE_BORDERS.map(k => el('button.border-opt' + (b.tableBorder === k ? '.on' : ''), {
          type: 'button', title: BORDER_NAMES[k], onclick: () => setBrush({ tableBorder: k }),
        }, k === 'none' ? el('pre', {}, ' │ \n─┼─') : el('pre', {}, BORDERS[k][0] + BORDERS[k][1] + BORDERS[k][1] + '\n' + BORDERS[k][7] + '  ')))),
        el('label.check', {}, el('input', { type: 'checkbox', checked: b.tableRowLines, onchange: e => setBrush({ tableRowLines: e.target.checked }) }), 'Lines between rows'),
        hint('Drag to size the table · click for the default size'),
      ];
      break;
    }
    case 'block': parts = [glyphRow(BLOCK_GLYPHS), hint('Drag to fill a rectangle')]; break;
    case 'pencil': parts = [glyphRow(['█', '▓', '▒', '░', '▀', '▄', '●', '*', '#', '·']), hint('Draw freehand · strokes add to the selected drawing')]; break;
    case 'cursor': parts = [glyphRow(CURSOR_GLYPHS), hint('Click to place a cursor or selection marker')]; break;
    case 'text': parts = [hint('Click to type, even on a box · drag to make a wrapping text frame · click text to edit it · Esc to finish')]; break;
    case 'eraser': parts = [hint('Erases pencil drawing on the active layer')]; break;
    case 'hand': parts = [hint('Drag to pan · scroll to pan · Ctrl+scroll to zoom')]; break;
    default: parts = [hint('Click to select · drag to move · Alt+drag to copy · Shift+click to add · double-click text to edit')];
  }
  $('#options').replaceChildren(...parts);
}

// ── Status bar ───────────────────────────────────────────────────────────────

function renderStatus() {
  const p = activeTab();
  const sel = selected();
  let s = '';
  if (sel.length === 1) { const b = bounds(sel[0]); s = `${displayName(sel[0])} · ${b.w}×${b.h} at ${b.x},${b.y}`; }
  else if (sel.length) s = `${sel.length} objects selected`;
  $('#st-pos').textContent = pointer.inside ? `${pointer.x}, ${pointer.y}` : '–';
  $('#st-sel').textContent = s;
  $('#st-size').textContent = `${state.project.tabs.length > 1 ? p.name + ' · ' : ''}${p.cols}×${p.rows} · ${activeLayer().name}`;
}

// ── Wiring ───────────────────────────────────────────────────────────────────

export function initPanels() {
  on('selection', () => {
    const l = state.activeLayerId;
    if (l) expanded.add(l);
    queueProps(); queueLayers(); renderStatus();
  });
  on('doc', () => {
    if (!typingInProps()) queueProps();
    queueLayers();
    renderStatus();
  });
  on('project', () => { expanded.clear(); queueProps(); queueLayers(); });
  on('tab', () => { queueProps(); queueLayers(); });
  on('tool', () => { renderToolbar(); renderOptions(); });
  on('pointer', renderStatus);
  panelBody('props').addEventListener('focusout', () => setTimeout(() => {
    if (!panelBody('props').contains(document.activeElement)) queueProps();
  }));
  renderToolbar();
  renderOptions();
}
