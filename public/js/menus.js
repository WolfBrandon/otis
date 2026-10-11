// Top bar menus and the New / Open / Export / Shortcuts dialogs.

import { el, $, toast, modal, confirmDialog, download, pickFile, slug } from './ui.js';
import { state, on, emit, setProject, mutate, undo, redo, canUndo, canRedo } from './state.js';
import { makeProject, makeText, uid } from './model.js';
import { composite } from './composite.js';
import { toText, toMarkdown, toAnsi, contentRect, projectFromMarkdown } from './export.js';
import { renderPNG } from './render.js';
import { storage, lastProject } from './storage.js';
import { sampleProject } from './snippets.js';
import { defaultFont } from './fonts.js';
import { menuAt, saveSelectionAsSnippet } from './library.js';
import * as A from './actions.js';
import { commands } from './tools.js';
import { PANELS, isOpen, togglePanel, layout, setMode, resetLayout } from './sidebar.js';

let R = null;
export let saveNow = async () => {};

// Pretty JSON that keeps short arrays (points, paint cells) on one line.
export function projectJSON(p) {
  return JSON.stringify(p, null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, inner) => '[' + inner.replace(/\s*\n\s*/g, ' ') + ']');
}

function fileBase() { return slug(state.project.name); }

// ── Project files ────────────────────────────────────────────────────────────

export async function newProjectDialog() {
  const cur = state.project;
  const name = el('input', { type: 'text', value: 'Untitled' });
  const cols = el('input.num', { type: 'number', value: 100, min: 1, max: 1000 });
  const rows = el('input.num', { type: 'number', value: 30, min: 1, max: 1000 });
  const preset = el('select', { onchange: e => { if (e.target.value) { const [c, r] = e.target.value.split('x'); cols.value = c; rows.value = r; } } },
    ...[['', 'Presets…'], ['80x24', '80 × 24 (classic terminal)'], ['100x30', '100 × 30'], ['120x40', '120 × 40'], ['160x50', '160 × 50'], ['200x60', '200 × 60']]
      .map(([v, l]) => el('option', { value: v }, l)));
  const body = el('div.form', {},
    el('label.field', {}, el('span.label', {}, 'Name'), name),
    el('label.field', {}, el('span.label', {}, 'Size'), el('span.controls', {}, cols, el('span.x', {}, '×'), rows, preset)),
    el('p.hint', {}, 'Columns × rows, in characters. Uses the current palette and font; you can change everything later.'));
  const ok = await modal('New project', body, [{ label: 'Cancel', value: false }, { label: 'Create', value: true, primary: true }]);
  if (!ok) return;
  await saveNow();
  const p = makeProject({
    name: name.value.trim() || 'Untitled',
    cols: Math.max(1, Math.min(1000, +cols.value || 100)),
    rows: Math.max(1, Math.min(1000, +rows.value || 30)),
    font: cur ? { ...cur.font } : { ...makeProject().font, family: defaultFont() },
    palette: cur ? structuredClone(cur.palette) : null,
  });
  setProject(p);
  emit('dirty');
}

function importProject(data, name) {
  if (!data || typeof data !== 'object' || !data.otis) throw new Error('This file is not an OTIS project.');
  data.id = uid();   // never overwrite another project by accident
  setProject(data);
  state.dirty = true;
  emit('dirty');
  toast(`Opened “${data.name || name}”`);
}

export async function openFile() {
  const f = await pickFile('.json,.otis.json,.md,.markdown,.txt,.ans');
  if (!f) return false;
  try {
    if (/\.(md|markdown)$/i.test(f.name)) {
      const p = projectFromMarkdown(f.text);
      if (!p) throw new Error('This Markdown file has no embedded OTIS project. Export with “Embed project” to make re-openable files.');
      importProject(p, f.name);
    } else if (/\.(txt|ans)$/i.test(f.name)) {
      // plain text → a new project with the text as an object
      const text = f.text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
      const lines = text.split('\n');
      const p = makeProject({
        name: f.name.replace(/\.\w+$/, ''),
        cols: Math.max(20, ...lines.map(l => Array.from(l).length)),
        rows: Math.max(5, lines.length),
        font: state.project ? { ...state.project.font } : undefined,
        palette: state.project ? structuredClone(state.project.palette) : null,
      });
      p.layers[0].objects.push(makeText(0, 0, text, { transparent: true }));
      importProject(p, f.name);
    } else importProject(JSON.parse(f.text), f.name);
    return true;
  } catch (e) { toast(e.message, 5000); return false; }
}

const ago = iso => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return new Date(iso).toLocaleDateString();
};

export async function openDialog() {
  await saveNow();
  let list = [];
  try { list = await storage.listProjects(); } catch (e) { toast('Could not list projects: ' + e.message); }
  let close;
  const done = () => close?.();
  const rows = list.map(p => el('li.project-row' + (p.id === state.project?.id ? '.current' : ''), {},
    el('button.project-open', {
      type: 'button',
      onclick: async () => {
        try { setProject(await storage.loadProject(p.id)); lastProject.set(p.id); done(); }
        catch (e) { toast(e.message); }
      },
    }, el('strong', {}, p.name || p.id), el('span.meta', {}, `${p.cols}×${p.rows} · ${ago(p.updated)}`)),
    el('button.icon.danger', {
      type: 'button', title: 'Delete project',
      onclick: async e => {
        const row = e.currentTarget.closest('li');
        if (!(await confirmDialog('Delete project?', `“${p.name}” will be deleted from ${storage.kind === 'server' ? 'the OTIS server' : 'this browser'}. This can't be undone.`, 'Delete'))) return;
        await storage.deleteProject(p.id);
        row.remove();
      },
    }, '✕')));
  const body = el('div.open', {},
    el('p.hint', {}, storage.label + '.'),
    rows.length ? el('ul.project-list', {}, ...rows) : el('p.hint', {}, 'No saved projects yet. Projects save automatically as you work.'),
    el('div.row', {},
      el('button', { type: 'button', onclick: async () => { if (await openFile()) done(); } }, 'Open a file…'),
      el('button', { type: 'button', onclick: () => { setProject(sampleProject(defaultFont())); done(); } }, 'Open the sample'),
    ));
  const p = modal('Open project', body, [{ label: 'Close', value: null }], { wide: true });
  close = () => document.querySelector('dialog.modal[open] .close')?.click();
  await p;
}

async function saveCopy() {
  const p = structuredClone(state.project);
  p.id = uid();
  p.name = p.name + ' copy';
  setProject(p);
  state.dirty = true;
  await saveNow();
  toast(`Saved “${p.name}”`);
}

// ── Export ───────────────────────────────────────────────────────────────────

const FORMATS = [
  ['md', 'Markdown', '.md'],
  ['txt', 'Plain text', '.txt'],
  ['ansi', 'ANSI (terminal colors)', '.ans'],
  ['png', 'PNG image', '.png'],
  ['json', 'OTIS project', '.otis.json'],
];

function loadOpts() {
  const d = { format: 'md', crop: false, trim: true, heading: true, embed: false, ansi: 'theme', scale: 2 };
  try { return { ...d, ...JSON.parse(localStorage.getItem('otis:export') || '{}') }; } catch { return d; }
}

export async function exportDialog() {
  const p = state.project;
  const grid = composite(p);
  const o = loadOpts();
  const preview = el('div.export-preview');
  const opts = el('div.export-opts');
  const note = el('p.hint');

  const output = () => {
    switch (o.format) {
      case 'md': return toMarkdown(p, grid, { heading: o.heading, embed: o.embed, trim: o.trim, crop: o.crop });
      case 'txt': return toText(grid, { trim: o.trim, crop: o.crop }) + '\n';
      case 'ansi': return toAnsi(grid, p, { mode: o.ansi, crop: o.crop });
      case 'json': return projectJSON(p);
    }
    return null;
  };

  const chk = (key, label) => el('label.check', {}, el('input', { type: 'checkbox', checked: o[key], onchange: e => { o[key] = e.target.checked; update(); } }), label);

  const update = async () => {
    try { localStorage.setItem('otis:export', JSON.stringify(o)); } catch {}
    formatSel.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.f === o.format));
    const parts = [];
    if (o.format !== 'json') parts.push(chk('crop', 'Crop to content'));
    if (['md', 'txt'].includes(o.format)) parts.push(chk('trim', 'Trim trailing spaces'));
    if (o.format === 'md') parts.push(chk('heading', 'Project name as heading'), chk('embed', 'Embed project (re-open the .md in OTIS)'));
    if (o.format === 'ansi') parts.push(el('label.field', {}, el('span.label', {}, 'Colors'), el('select', { onchange: e => { o.ansi = e.target.value; update(); } },
      el('option', { value: 'theme', selected: o.ansi === 'theme' }, 'Follow the terminal theme (16 colors)'),
      el('option', { value: 'truecolor', selected: o.ansi === 'truecolor' }, 'Exact colors (24-bit)'))));
    if (o.format === 'png') parts.push(el('label.field', {}, el('span.label', {}, 'Scale'), el('select', { onchange: e => { o.scale = +e.target.value; update(); } },
      ...[1, 2, 3, 4].map(s => el('option', { value: s, selected: o.scale === s }, s + '×')))));
    opts.replaceChildren(...parts);

    note.textContent = {
      md: 'Markdown carries characters only — colors, fonts and styles are left out.',
      txt: 'Characters only.',
      ansi: 'View it in a terminal with:  cat ' + fileBase() + '.ans',
      png: 'Rendered with the fonts installed on this computer.',
      json: 'The full project, to open again in OTIS or keep in git.',
    }[o.format];

    if (o.format === 'png') {
      const blob = await renderPNG(p, grid, { scale: o.scale, rect: o.crop ? contentRect(grid) : null });
      const img = el('img', { src: URL.createObjectURL(blob), alt: 'Preview' });
      preview.replaceChildren(img);
    } else {
      let text = output();
      if (o.format === 'ansi') text = text.replace(/\x1b\[[0-9;]*m/g, '');
      if (text.length > 60000) text = text.slice(0, 60000) + '\n…';
      preview.replaceChildren(el('pre', {}, text));
    }
  };

  const formatSel = el('div.seg.formats', {}, ...FORMATS.map(([f, label]) => el('button', { type: 'button', dataset: { f }, onclick: () => { o.format = f; update(); } }, label)));
  const body = el('div.export', {}, formatSel, opts, note, preview);
  update();

  const result = await modal('Export', body, [
    { label: 'Copy', value: 'copy' },
    { label: 'Download', value: 'download', primary: true },
  ], { wide: true });
  if (!result) return;
  const ext = FORMATS.find(f => f[0] === o.format)[2];
  const name = fileBase() + ext;
  if (o.format === 'png') {
    const blob = await renderPNG(p, grid, { scale: o.scale, rect: o.crop ? contentRect(grid) : null });
    if (result === 'copy') {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('Image copied'); }
      catch { toast('This browser can\'t copy images — downloading instead.'); download(name, blob); }
    } else download(name, blob);
    return;
  }
  const text = output();
  if (result === 'copy') {
    try { await navigator.clipboard.writeText(text); toast('Copied to the clipboard'); }
    catch { toast('Clipboard is blocked here — downloading instead.'); download(name, text); }
  } else download(name, text, o.format === 'json' ? 'application/json' : 'text/plain');
}

// ── Help ─────────────────────────────────────────────────────────────────────

const SHORTCUTS = [
  ['Tools', [['V', 'Select & move'], ['B', 'Box'], ['T', 'Text'], ['A / L', 'Arrow / line'], ['#', 'Table'], ['C', 'Cursor'], ['K', 'Block fill'], ['P', 'Pencil'], ['E', 'Eraser'], ['H / Space', 'Pan']]],
  ['Edit', [['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'], ['Ctrl+C / X / V', 'Copy / cut / paste (pastes text as a text object)'], ['Ctrl+D', 'Duplicate'], ['Alt+drag', 'Duplicate while moving'], ['Delete', 'Delete'], ['Arrows (Shift)', 'Nudge 1 (5) cells'], ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup'], ['[ ] / { }', 'Backward, forward / to back, to front'], ['Ctrl+A', 'Select all'], ['Enter / double-click', 'Edit text or a table cell'], ['Tab / Shift+Tab', 'Next / previous table cell'], ['Esc', 'Stop editing / deselect']]],
  ['View', [['Scroll', 'Pan'], ['Ctrl+scroll', 'Zoom'], ['+ / −', 'Zoom in / out'], ['0', 'Zoom to fit'], ['1', 'Actual size'], ['G', 'Toggle grid']]],
  ['File', [['Ctrl+S', 'Save now (saves automatically too)'], ['Ctrl+O', 'Open'], ['Ctrl+E', 'Export']]],
];

export function helpDialog() {
  const body = el('div.shortcuts', {}, ...SHORTCUTS.map(([title, list]) => el('section', {}, el('h4', {}, title),
    el('table', {}, ...list.map(([k, d]) => el('tr', {}, el('td', {}, el('kbd', {}, k)), el('td', {}, d)))))));
  modal('Keyboard shortcuts', body, [{ label: 'Close', value: null, primary: true }], { wide: true });
}

function aboutDialog() {
  const body = el('div.about', {},
    el('pre.about-logo', {}, ' ██████╗ ████████╗██╗███████╗\n██╔═══██╗╚══██╔══╝██║██╔════╝\n██║   ██║   ██║   ██║███████╗\n██║   ██║   ██║   ██║╚════██║\n╚██████╔╝   ██║   ██║███████║\n ╚═════╝    ╚═╝   ╚═╝╚══════╝'),
    el('p', {}, el('strong', {}, 'Omarchy Text Interface Studio'), ' — design terminal UIs with boxes, text, arrows and glyphs, then export them as Markdown, text, ANSI or PNG.'),
    el('p', {}, el('a', { href: 'https://github.com/WolfBrandon/otis', target: '_blank', rel: 'noopener' }, 'github.com/WolfBrandon/otis')),
    el('p.hint', {}, 'Themes come from Omarchy (MIT). ' + storage.label + '.'));
  modal('About OTIS', body, [{ label: 'Close', value: null, primary: true }]);
}

// ── Menus ────────────────────────────────────────────────────────────────────

function menus() {
  const sel = state.selection.length > 0;
  const v = state.view;
  return {
    file: [
      ['New project…', newProjectDialog],
      ['Open…', openDialog, true, 'Ctrl+O'],
      ['Save', () => saveNow(true), true, 'Ctrl+S'],
      ['Save a copy', saveCopy],
      '-',
      ['Open a file…', openFile],
      ['Download project (.otis.json)', () => download(fileBase() + '.otis.json', projectJSON(state.project), 'application/json')],
      ['Export…', exportDialog, true, 'Ctrl+E'],
    ],
    edit: [
      ['Undo', undo, canUndo(), 'Ctrl+Z'],
      ['Redo', redo, canRedo(), 'Ctrl+Shift+Z'],
      '-',
      ['Duplicate', () => A.duplicate(), sel, 'Ctrl+D'],
      ['Delete', A.deleteSelection, sel, 'Del'],
      ['Select all', A.selectAll, true, 'Ctrl+A'],
      '-',
      ['Group', A.group, state.selection.length > 1, 'Ctrl+G'],
      ['Ungroup', A.ungroup, sel, 'Ctrl+Shift+G'],
      ['Bring to front', () => A.arrange(Infinity), sel, '}'],
      ['Send to back', () => A.arrange(-Infinity), sel, '{'],
      '-',
      ['Save selection as snippet…', saveSelectionAsSnippet, sel],
    ],
    view: [
      ['Zoom in', () => R.setZoom(state.view.zoom * 1.25), true, '+'],
      ['Zoom out', () => R.setZoom(state.view.zoom / 1.25), true, '−'],
      ['Zoom to fit', () => R.fit(), true, '0'],
      ['Actual size', () => R.setZoom(1), true, '1'],
      '-',
      [(v.grid ? '✓ ' : '   ') + 'Show grid', () => { v.grid = !v.grid; emit('view'); }, true, 'G'],
      [(v.blink ? '✓ ' : '   ') + 'Animate blinking', () => { v.blink = !v.blink; emit('view'); }],
      [(chromeFollows() ? '✓ ' : '   ') + 'Color the app with the palette', () => { setChromeFollows(!chromeFollows()); }],
      '-',
      ...PANELS.map(p => [(isOpen(p.id) ? '✓ ' : '   ') + p.title + ' panel', () => togglePanel(p.id)]),
      '-',
      [(layout().mode === 'slim' ? '● ' : '   ') + 'Slim sidebar (one column)', () => setMode('slim')],
      [(layout().mode === 'wide' ? '● ' : '   ') + 'Wide sidebar (two columns)', () => setMode('wide')],
      ['   Reset panel layout', resetLayout],
    ],
    help: [
      ['Keyboard shortcuts', helpDialog, true, '?'],
      ['File format', () => window.open('https://github.com/WolfBrandon/otis/blob/main/docs/FORMAT.md', '_blank', 'noopener')],
      ['About OTIS', aboutDialog],
    ],
  };
}

export const chromeFollows = () => { try { return localStorage.getItem('otis:chrome') !== 'off'; } catch { return true; } };
function setChromeFollows(on) {
  try { localStorage.setItem('otis:chrome', on ? 'on' : 'off'); } catch {}
  emit('chrome');
}

export function initMenus(renderer, save) {
  R = renderer;
  saveNow = save;
  Object.assign(commands, { save: () => save(true), open: openDialog, export: exportDialog, help: helpDialog });
  document.querySelectorAll('[data-menu]').forEach(b => b.addEventListener('click', () => menuAt(b, menus()[b.dataset.menu])));
  $('#btn-export').addEventListener('click', exportDialog);
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  $('#zoom-in').addEventListener('click', () => R.setZoom(state.view.zoom * 1.25));
  $('#zoom-out').addEventListener('click', () => R.setZoom(state.view.zoom / 1.25));
  $('#zoom-label').addEventListener('click', () => R.fit());
  const name = $('#project-name');
  name.addEventListener('input', () => mutate(p => { p.name = name.value; }, { coalesce: 'project-name' }));
  name.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') name.blur(); });
  const sync = () => {
    if (document.activeElement !== name) name.value = state.project.name;
    $('#btn-undo').disabled = !canUndo();
    $('#btn-redo').disabled = !canRedo();
    document.title = `${state.project.name} — OTIS`;
  };
  on('doc', sync);
  on('project', sync);
  on('view', () => { $('#zoom-label').textContent = Math.round(state.view.zoom * 100) + '%'; });
}
