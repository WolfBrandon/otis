// Library sidebar tabs: Palette (themes + swatches), Glyphs, Snippets.

import { el, $, toast, prompt, modal, pickFile, download, slug } from './ui.js';
import { icon } from './icons.js';
import { state, on, emit, mutate, selected, setBrush, findDeep } from './state.js';
import { walk, chars, fitText, makeText } from './model.js';
import { THEMES } from './themes.js';
import { SLOTS, SLOT_GROUPS, resolveColor, parseThemeFile, paletteToToml } from './palette.js';
import { openColorPicker } from './colorpicker.js';
import { BUILTIN_SNIPPETS, snippetFromObjects } from './snippets.js';
import { compositeObjects } from './composite.js';
import { measureFont, paintGrid } from './render.js';
import { storage } from './storage.js';
import * as A from './actions.js';
import { insertIntoEditing } from './tools.js';
import { hooks } from './panels.js';
import { setHeader, showPanel, panelBody } from './sidebar.js';

let editColors = false;
let systemThemes = [];

export async function saveLibrary() {
  emit('library');
  try { await storage.saveLibrary(state.library); }
  catch (e) { toast('Could not save the library: ' + e.message); }
}

// ── Collapsible groups ───────────────────────────────────────────────────────
// Swatch groups and snippet categories fold up; which ones are folded is a
// per-browser preference.

const folded = new Set((() => { try { return JSON.parse(localStorage.getItem('otis:folded')) || []; } catch { return []; } })());

function fold(panel, key, title, cls, ...content) {
  const id = panel + ':' + key;
  const open = !folded.has(id);
  const toggle = () => {
    if (open) folded.add(id); else folded.delete(id);
    try { localStorage.setItem('otis:folded', JSON.stringify([...folded])); } catch {}
    paint(panel);
  };
  return el('div.' + cls + (open ? '' : '.folded'), {},
    el('h5', {}, el('button.fold-head', { type: 'button', 'aria-expanded': String(open), onclick: toggle },
      el('span.twist' + (open ? '.open' : ''), {}, icon('chevron', 12)), title)),
    open ? content : null);
}

// ── Palette ──────────────────────────────────────────────────────────────────

function applyTheme(t) {
  mutate(p => {
    const old = p.palette?.colors || {};
    const colors = { ...t.colors };
    // keep custom swatches the new theme doesn't define
    for (const [k, v] of Object.entries(old)) if (!SLOTS.includes(k) && !(k in colors)) colors[k] = v;
    p.palette = { id: t.id, name: t.name, mode: t.mode || 'dark', source: t.source, colors };
  });
}

function allThemes() {
  return [
    ...THEMES.map(t => ({ ...t, source: 'builtin:' + t.id })),
    ...state.library.palettes.map(t => ({ ...t, source: 'lib:' + t.id })),
    ...systemThemes,
  ];
}

function applySwatch(key, asBg) {
  const field = asBg ? 'bg' : 'fg';
  if (state.editing) {
    const o = findDeep(state.editing.id)?.obj;
    if (o) mutate(() => { o[field] = key; });
    return;
  }
  const sel = selected();
  if (sel.length) {
    const leafs = [];
    for (const o of sel) for (const n of walk([o])) if (n.type !== 'group') leafs.push(n);
    mutate(() => leafs.forEach(o => { o[field] = key; }));
    toast(`${asBg ? 'Background' : 'Text color'} → ${key}`, 1200);
  } else {
    setBrush({ [field]: key });
    toast(`New objects: ${asBg ? 'background' : 'text color'} ${key}`, 1500);
  }
}

function editSwatch(key, anchor) {
  const pal = state.project.palette;
  openColorPicker({
    anchor, value: pal.colors[key] || '#888888', palette: null, allowNone: false,
    onInput: v => setPaletteColor(key, v),
    onChange: v => setPaletteColor(key, v),
  });
}

function setPaletteColor(key, v) {
  const hex = resolveColor(v, state.project.palette);
  if (!hex) return;
  mutate(p => { p.palette.colors[key] = hex; p.palette.edited = true; }, { coalesce: 'pal:' + key });
}

function swatch(key) {
  const pal = state.project.palette;
  const hex = pal.colors[key];
  const b = el('button.swatch', {
    type: 'button', title: `${key}  ${hex || '(unset)'}\nClick: text color · Shift+click: background · Right-click: edit`,
    style: { background: hex || 'transparent' },
    onclick: e => editColors ? editSwatch(key, b) : applySwatch(key, e.shiftKey),
    oncontextmenu: e => { e.preventDefault(); editSwatch(key, b); },
  });
  return b;
}

async function addSwatch() {
  const name = await prompt('New swatch', '', { label: 'Name (letters, numbers, _ and -)', placeholder: 'brand' });
  if (!name) return;
  const key = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  if (!key || key.startsWith('#')) return;
  mutate(p => { p.palette.colors[key] = p.palette.colors[key] || '#ff79c6'; p.palette.edited = true; });
}

async function savePalette() {
  const pal = state.project.palette;
  const name = await prompt('Save palette', pal.edited && !pal.name.endsWith('(edited)') ? pal.name + ' (edited)' : pal.name, { label: 'Name in My palettes' });
  if (!name) return;
  const id = slug(name);
  const entry = { id, name, mode: pal.mode || 'dark', colors: { ...pal.colors } };
  const i = state.library.palettes.findIndex(p => p.id === id);
  if (i >= 0) state.library.palettes[i] = entry; else state.library.palettes.push(entry);
  mutate(p => { p.palette = { ...entry, source: 'lib:' + id }; });
  await saveLibrary();
  toast(`Saved “${name}” to My palettes`);
}

async function importTheme(text, filename) {
  try {
    const t = parseThemeFile(text, filename);
    const id = slug(t.name || filename || 'imported');
    const entry = { id, name: t.name || 'Imported', mode: t.mode || 'dark', colors: t.colors };
    const i = state.library.palettes.findIndex(p => p.id === id);
    if (i >= 0) state.library.palettes[i] = entry; else state.library.palettes.push(entry);
    applyTheme({ ...entry, source: 'lib:' + id });
    await saveLibrary();
    toast(`Imported “${entry.name}” into My palettes`);
  } catch (e) { toast(e.message, 4000); }
}

function paletteMenu(anchor) {
  const pal = state.project.palette;
  const inLib = pal.source?.startsWith('lib:');
  menuAt(anchor, [
    ['Save to My palettes…', savePalette],
    ['Import theme file…', async () => {
      const f = await pickFile('.toml,.conf,.yml,.yaml,.txt,*');
      if (f) importTheme(f.text, f.name);
    }],
    ['Paste theme text…', async () => {
      const text = await prompt('Paste a theme', '', { multiline: true, label: 'Omarchy colors.toml, Alacritty .toml, Ghostty or Kitty config', placeholder: 'background = "#1a1b26"\n…' });
      if (text) importTheme(text, 'pasted');
    }],
    ['Export as Omarchy colors.toml', () => download('colors.toml', paletteToToml(pal), 'text/plain')],
    inLib ? ['Delete from My palettes', async () => {
      state.library.palettes = state.library.palettes.filter(p => 'lib:' + p.id !== pal.source);
      await saveLibrary();
    }] : null,
  ]);
}

function renderPalette() {
  const p = state.project;
  const pal = p.palette;
  const themes = allThemes();
  const known = themes.find(t => t.source === pal.source);
  const select = el('select.theme-select', {
    onchange: e => { const t = themes.find(t => t.source === e.target.value); if (t) applyTheme(t); },
  });
  if (!known || pal.edited) select.append(el('option', { value: '', selected: true }, `${pal.name}${pal.edited ? ' (edited)' : ''} — this project`));
  const groups = [['Built-in themes', 'builtin:'], ['My palettes', 'lib:'], ['On this machine', 'sys:']];
  for (const [label, prefix] of groups) {
    const list = themes.filter(t => t.source.startsWith(prefix));
    if (!list.length) continue;
    select.append(el('optgroup', { label }, ...list.map(t => el('option', { value: t.source, selected: known && !pal.edited && t.source === pal.source }, t.name))));
  }
  const custom = Object.keys(pal.colors).filter(k => !SLOTS.includes(k));
  return el('div.palette', {},
    el('div.row', {}, select),
    el('div.row', {},
      el('label.check', {}, el('input', { type: 'checkbox', checked: editColors, onchange: e => { editColors = e.target.checked; paint('palette'); } }), 'Edit colors'),
      el('span.hint', {}, editColors ? 'Click a swatch to change it' : 'Click: text · Shift+click: background')),
    ...SLOT_GROUPS.map(g => fold('palette', g.label, g.label, 'swatch-group', el('div.swatches', {}, ...g.keys.map(swatch)))),
    fold('palette', 'Custom', 'Custom', 'swatch-group', el('div.swatches', {}, ...custom.map(swatch),
      el('button.swatch.add', { type: 'button', title: 'Add a custom swatch', onclick: addSwatch }, '+'))),
    el('p.hint', {}, 'Objects colored with a swatch follow the theme — switch themes to preview your design in each one.'),
  );
}

// ── Glyphs ───────────────────────────────────────────────────────────────────

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCodePoint(a + i)).join('');
const NF = [0xf015, 0xf07b, 0xf07c, 0xf15b, 0xf0f6, 0xf013, 0xf002, 0xf00c, 0xf00d, 0xf004, 0xf005, 0xf007, 0xf017, 0xf073,
  0xf023, 0xf0f3, 0xf0e0, 0xf120, 0xf121, 0xf126, 0xf09b, 0xf1eb, 0xf240, 0xf244, 0xf0e7, 0xf001, 0xf04b, 0xf04c, 0xf04d,
  0xf071, 0xf05a, 0xf059, 0xf011, 0xf021, 0xf019, 0xf093, 0xf1f8, 0xf040, 0xf0c7, 0xf0c5, 0xf1c0, 0xf233, 0xf0c2, 0xf0ac,
  0xf108, 0xf0a0, 0xf2db, 0xf2c7, 0xf0eb, 0xf135, 0xf1e6, 0xf028, 0xf026, 0xf03e, 0xf17c, 0xf303].map(c => String.fromCodePoint(c)).join('');

export const GLYPH_SETS = [
  ['Box drawing', '─│┌┐└┘├┤┬┴┼━┃┏┓┗┛┣┫┳┻╋═║╔╗╚╝╠╣╦╩╬╒╕╘╛╞╡╤╧╪╓╖╙╜╟╢╥╨╫╭╮╰╯╌╎┄┆┈┊╍╏┅┇╴╵╶╷╸╹╺╻╱╲╳'],
  ['Blocks & shades', '█▓▒░▀▄▌▐▁▂▃▅▆▇▏▎▍▋▊▉▔▕▖▗▘▝▙▚▛▜▞▟■□▪▫▬▭▮▯'],
  ['Geometric', '●○◉◎◌◍◐◑◒◓◔◕◆◇◈◊▲△▼▽◀◁▶▷►◄▸◂▴▾▹◃▵▿★☆✦✧✪⬤⬡⬢◢◣◤◥'],
  ['Arrows', '←↑→↓↔↕↖↗↘↙⇐⇑⇒⇓⇔⇕⟵⟶⟷↩↪↺↻➜➤↵⏎⇥⇤⤒⤓⇞⇟'],
  ['Symbols', '✓✔✗✘✕✖•·∙…※§¶†‡°±×÷≈≠≤≥∞√∑πµΩ⌘⌥⇧⌃⎋⌫⏻♥♦♣♠☀☁☂⚡⚠♪♫❯❮›‹»«│¦'],
  ['Spinners', '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏◐◓◑◒◴◷◶◵⣾⣽⣻⢿⡿⣟⣯⣷◢◣◤◥⠁⠂⠄⡀⢀⠠⠐⠈'],
  ['Braille', range(0x2800, 0x28ff)],
  ['Powerline (Nerd Font)', ''],
  ['Nerd Font icons', NF],
  ['ASCII', range(0x21, 0x7e)],
  ['Latin & Greek', 'αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ∀∃∈∉∩∪⊂⊃∧∨¬⊕⊗∫∂∇'],
];
let glyphSet = 0;

function pickGlyph(g) {
  setBrush({ glyph: g });
  if (state.editing) { insertIntoEditing(g); return; }
  const sel = selected();
  if (sel.length === 1 && (sel[0].type === 'block' || sel[0].type === 'cursor')) mutate(() => { sel[0].glyph = g; });
}

function renderGlyphs() {
  const [, set] = GLYPH_SETS[glyphSet];
  const custom = el('input.glyph-input', { type: 'text', placeholder: 'Any', maxlength: 4, title: 'Type or paste any character' });
  custom.addEventListener('input', () => { const c = chars(custom.value); if (c.length) pickGlyph(c[c.length - 1]); });
  return el('div.glyphs', {},
    el('div.row', {},
      el('select', { onchange: e => { glyphSet = +e.target.value; paint('glyphs'); } },
        ...GLYPH_SETS.map(([name], i) => el('option', { value: i, selected: i === glyphSet }, name))),
      el('span.current-glyph', { title: 'Current glyph' }, state.brush.glyph),
      custom),
    el('p.hint', {}, state.editing ? 'Click a glyph to type it into the text.' : 'Sets the glyph for the pencil, block and cursor tools.'),
    el('div.glyph-grid', {}, ...chars(set).map(g => el('button.glyph' + (g === state.brush.glyph ? '.on' : ''), {
      type: 'button', title: 'U+' + g.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'), onclick: () => pickGlyph(g),
    }, g))),
  );
}

// ── Snippets ─────────────────────────────────────────────────────────────────

let metricsCache = null;

function previewCanvas(sn) {
  const p = state.project;
  const key = JSON.stringify(p.font);
  if (!metricsCache || metricsCache.key !== key) metricsCache = { key, m: measureFont(p.font) };
  const m = metricsCache.m;
  const d = window.devicePixelRatio || 1;
  const scale = Math.min(0.75, 236 / Math.max(1, sn.w * m.w));
  const cw = Math.max(1, Math.round(m.w * scale * d)), ch = Math.max(1, Math.round(m.h * scale * d));
  const c = el('canvas');
  c.width = sn.w * cw;
  c.height = sn.h * ch;
  c.style.width = c.width / d + 'px';
  c.style.height = c.height / d + 'px';
  const grid = compositeObjects(sn.objects, sn.w, sn.h);
  paintGrid(c.getContext('2d'), grid, p, m, { ox: 0, oy: 0, cw, ch, scale: scale * d });
  return c;
}

function insertSnippet(sn) {
  const o = A.insertObjects(sn.objects, null, { groupName: sn.name });
  if (o) toast(`Inserted “${sn.name}” — drag it into place`);
}

export async function saveSelectionAsSnippet() {
  const sel = selected();
  if (!sel.length) return toast('Select something on the canvas first.');
  const name = await prompt('Save as snippet', sel.length === 1 && sel[0].name ? sel[0].name : '', { label: 'Snippet name', placeholder: 'My widget' });
  if (!name) return;
  const objs = sel.map(o => structuredClone(o));
  const sn = snippetFromObjects(name, 'My snippets', objs);
  state.library.snippets.push(sn);
  await saveLibrary();
  showPanel('snippets');
  toast(`Saved snippet “${name}”`);
}

async function snippetFromText() {
  const text = await prompt('New snippet from text', '', { multiline: true, label: 'Paste ASCII art, a table, a banner…' });
  if (!text) return;
  const name = await prompt('Snippet name', 'ASCII art');
  if (!name) return;
  const o = makeText(0, 0, text.replace(/\r\n?/g, '\n').replace(/\n+$/, ''), { transparent: true });
  state.library.snippets.push(snippetFromObjects(name, 'My snippets', [o]));
  await saveLibrary();
  showPanel('snippets');
}

function snippetMenu(anchor) {
  menuAt(anchor, [
    ['New snippet from text…', snippetFromText],
    ['Export my snippets (.json)', () => download('otis-snippets.json', JSON.stringify({ otisSnippets: 1, snippets: state.library.snippets }, null, 2), 'application/json')],
    ['Import snippets…', async () => {
      const f = await pickFile('.json');
      if (!f) return;
      try {
        const data = JSON.parse(f.text);
        const list = data.snippets || [];
        for (const s of list) if (s && Array.isArray(s.objects)) state.library.snippets.push({ ...s, id: 'snip-' + Math.random().toString(36).slice(2, 8) });
        await saveLibrary();
        toast(`Imported ${list.length} snippets`);
      } catch (e) { toast('Not a snippets file: ' + e.message); }
    }],
  ]);
}

function snippetTile(sn, mine) {
  return el('div.snippet', { title: 'Click to insert' },
    el('button.snippet-body', { type: 'button', onclick: () => insertSnippet(sn) }, previewCanvas(sn), el('span.snippet-name', {}, sn.name)),
    mine ? el('button.icon.snippet-del', {
      type: 'button', title: 'Delete snippet',
      onclick: async () => { state.library.snippets = state.library.snippets.filter(s => s.id !== sn.id); await saveLibrary(); },
    }, icon('trash', 14)) : null,
  );
}

function renderSnippets() {
  const mine = state.library.snippets;
  const cats = [...new Set(BUILTIN_SNIPPETS.map(s => s.category))];
  return el('div.snippets', {},
    el('div.row', {},
      el('button', { type: 'button', onclick: saveSelectionAsSnippet, disabled: !state.selection.length, title: 'Save the selected objects as a reusable snippet' }, '+ Save selection')),
    fold('snippets', 'mine', 'My snippets', 'snippet-group',
      mine.length ? el('div.snippet-list', {}, ...mine.map(s => snippetTile(s, true)))
        : el('p.hint', {}, 'Select objects and click “Save selection” to reuse them in any project.')),
    ...cats.map(c => fold('snippets', c, c, 'snippet-group',
      el('div.snippet-list', {}, ...BUILTIN_SNIPPETS.filter(s => s.category === c).map(s => snippetTile(s, false))))),
  );
}

// ── Shared ───────────────────────────────────────────────────────────────────

export function menuAt(anchor, items) {
  const pop = $('#menu-pop');
  const close = () => { pop.hidden = true; document.removeEventListener('pointerdown', outside, true); };
  const outside = e => { if (!pop.contains(e.target)) close(); };
  pop.replaceChildren(...items.filter(Boolean).map(it => it === '-' ? el('hr')
    : el('button', { type: 'button', disabled: it[2] === false, onclick: () => { close(); it[1](); } }, it[0], it[3] ? el('kbd', {}, it[3]) : null)));
  const r = anchor.getBoundingClientRect();
  pop.hidden = false;
  const w = pop.offsetWidth;
  pop.style.left = Math.max(4, Math.min(window.innerWidth - w - 4, r.left)) + 'px';
  pop.style.top = r.bottom + 4 + 'px';
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  return close;
}

// Each tab of the old library is now its own sidebar panel.
const RENDER = { palette: renderPalette, glyphs: renderGlyphs, snippets: renderSnippets };
const HEADERS = {
  palette: () => [el('button.icon', { type: 'button', title: 'Palette options', onclick: e => paletteMenu(e.currentTarget) }, icon('more'))],
  glyphs: () => [],
  snippets: () => [el('button.icon', { type: 'button', title: 'Snippet options', onclick: e => snippetMenu(e.currentTarget) }, icon('more'))],
};

function paint(id) {
  const body = panelBody(id);
  if (!body) return;
  const scroll = body.scrollTop;
  setHeader(id, id[0].toUpperCase() + id.slice(1), HEADERS[id]());
  body.replaceChildren(RENDER[id]());
  body.scrollTop = scroll;
}

const queued = new Set();
function queue(...ids) {
  if (!queued.size) requestAnimationFrame(() => { const list = [...queued]; queued.clear(); list.forEach(paint); });
  ids.forEach(id => queued.add(id));
}

let lastPal = '';
export async function initLibrary() {
  hooks.saveSnippet = saveSelectionAsSnippet;
  hooks.showGlyphs = () => showPanel('glyphs');
  on('doc', () => {
    const k = JSON.stringify(state.project.palette) + JSON.stringify(state.project.font);
    if (k !== lastPal) { lastPal = k; queue('palette', 'snippets'); }
  });
  on('project', () => queue('palette', 'glyphs', 'snippets'));
  on('library', () => queue('palette', 'snippets'));
  on('selection', () => queue('glyphs', 'snippets'));
  on('tool', () => queue('glyphs'));
  ['palette', 'glyphs', 'snippets'].forEach(paint);
  try {
    const list = await storage.omarchyThemes();
    systemThemes = list.map(t => {
      try {
        const parsed = parseThemeFile(t.toml, t.id);
        // a theme that's also built in (like your Phosphor themes) only shows
        // up here if the copy on disk has different colors
        const builtin = THEMES.find(b => b.id === t.id);
        if (builtin && SLOTS.every(k => builtin.colors[k] === parsed.colors[k])) return null;
        return { id: t.id, name: t.name || parsed.name, mode: parsed.mode, colors: parsed.colors, source: 'sys:' + t.source + '/' + t.id };
      } catch { return null; }
    }).filter(Boolean);
    if (systemThemes.length) queue('palette');
  } catch {}
}
