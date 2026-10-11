#!/usr/bin/env node
// OTIS MCP server: lets an AI assistant (Claude Code, Codex, any MCP client)
// read and draw OTIS designs. It speaks MCP over stdio and works through a
// running OTIS server's HTTP API, so an open OTIS window shows each change
// live, and Ctrl+Z there undoes it. Node stdlib only.
//
//   claude mcp add --scope user otis -- node /path/to/otis/mcp.js
//
// OTIS_URL says where OTIS runs (default http://127.0.0.1:6847).
// stdout carries the protocol; anything else goes to stderr.

import readline from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  makeBox, makeText, makeLine, makeBlock, makeCursor, makePaint, makeTable, makeGroup, makeLayer,
  makeProject, bounds, translate, fitText, cloneObject, resizeTable, layoutText, frameInset,
} from './public/js/model.js';
import { composite } from './public/js/composite.js';
import { toText, toMarkdown, toAnsi, contentRect } from './public/js/export.js';
import { normalizeProject } from './public/js/state.js';
import { THEMES } from './public/js/themes.js';
import { SLOTS, parseThemeFile } from './public/js/palette.js';
import { BUILTIN_SNIPPETS } from './public/js/snippets.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.OTIS_URL || 'http://127.0.0.1:6847').replace(/\/+$/, '');
const VERSION = JSON.parse(await fs.readFile(path.join(HERE, 'package.json'), 'utf8')).version;
const SERVER_INFO = { name: 'otis', title: 'OTIS', version: VERSION };

// MCP revisions. Modern ones put the version on every request; legacy ones
// start with an `initialize` handshake. OTIS answers both.
const MODERN = ['2026-07-28'];
const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const log = (...a) => console.error('[otis-mcp]', ...a);

// An error the AI should see and can fix (bad argument, OTIS not running…).
class ToolError extends Error {}

// ── Talking to OTIS ──────────────────────────────────────────────────────────

async function call(method, p, body, headers = {}) {
  try {
    return await fetch(`${BASE}/api/${p}`, {
      method,
      headers: { 'X-OTIS-Client': 'mcp', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ToolError(`Can't reach OTIS at ${BASE}. Start it with "systemctl --user start otis" `
      + '(installed with install.sh) or "docker compose up -d" in the otis folder (Docker). '
      + 'Set OTIS_URL if it runs somewhere else.');
  }
}

async function json(method, p, body) {
  const res = await call(method, p, body);
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ToolError(data?.error || `OTIS answered ${res.status}`);
  return data;
}

const library = () => json('GET', 'library').catch(() => ({ snippets: [], palettes: [] }));

const projectHint = list => list.length
  ? 'Projects: ' + list.slice(0, 20).map(p => `${p.id} "${p.name}"`).join(', ')
  : 'There are no saved projects yet; create_project makes one.';

// Project id from an id or name, or the project open in OTIS.
async function projectId(ref) {
  const list = await json('GET', 'projects');
  if (ref != null && ref !== '') {
    const r = String(ref).trim();
    const hit = list.find(p => p.id === r) || list.find(p => p.name.toLowerCase() === r.toLowerCase());
    if (!hit) throw new ToolError(`There's no project "${r}". ${projectHint(list)}`);
    return hit.id;
  }
  const cur = await json('GET', 'current');
  if (!cur.id) throw new ToolError(`No OTIS window has a project open, so pass "project". ${projectHint(list)}`);
  if (!list.some(p => p.id === cur.id)) {
    throw new ToolError('The project open in OTIS hasn\'t been saved yet (it saves after the first change). '
      + `Pass "project", or make a new one with create_project. ${projectHint(list)}`);
  }
  return cur.id;
}

async function load(id) {
  const res = await call('GET', 'projects/' + id);
  if (!res.ok) throw new ToolError(`Couldn't load project ${id} (${res.status}).`);
  return { project: normalizeProject(await res.json()), etag: res.headers.get('etag') };
}

// Load, change, save. If the user saved in between (412), redo the change on
// the fresh copy so neither side's work is lost.
async function edit(ref, change) {
  const id = await projectId(ref);
  for (let attempt = 1; ; attempt++) {
    const { project, etag } = await load(id);
    const notes = [];
    const result = await change(project, notes);
    const res = await call('PUT', 'projects/' + id, project, { 'If-Match': etag });
    if (res.status === 412 && attempt < 4) continue;
    if (!res.ok) throw new ToolError('Saving failed: ' + ((await res.json().catch(() => null))?.error || res.status));
    return { project, notes, result };
  }
}

// ── Themes and snippets ──────────────────────────────────────────────────────

async function allThemes() {
  const lib = await library();
  const local = await json('GET', 'omarchy/themes').catch(() => []);
  const out = THEMES.map(t => ({ ...t, source: 'builtin:' + t.id, kind: 'Built-in' }));
  for (const t of lib.palettes || []) out.push({ ...t, source: 'lib:' + t.id, kind: 'My palettes' });
  for (const t of local) {
    try {
      const parsed = parseThemeFile(t.toml, t.id);
      // skip on-disk copies of built-in themes (as the Palette panel does)
      const builtin = THEMES.find(b => b.id === t.id);
      if (builtin && SLOTS.every(k => builtin.colors[k] === parsed.colors[k])) continue;
      out.push({ id: t.id, name: t.name || parsed.name, mode: parsed.mode, colors: parsed.colors, source: `sys:${t.source}/${t.id}`, kind: 'On this machine' });
    } catch {}
  }
  return out;
}

async function findTheme(ref) {
  const themes = await allThemes();
  const r = String(ref).toLowerCase();
  const t = themes.find(t => t.id.toLowerCase() === r) || themes.find(t => t.name.toLowerCase() === r);
  if (!t) throw new ToolError(`No theme "${ref}". Themes: ${[...new Set(themes.map(t => t.id))].join(', ')}`);
  return t;
}

// Same as picking a theme in the Palette panel: keep custom swatches the new
// theme doesn't define.
function applyTheme(project, t) {
  const old = project.palette?.colors || {};
  const colors = { ...t.colors };
  for (const [k, v] of Object.entries(old)) if (!SLOTS.includes(k) && !(k in colors)) colors[k] = v;
  project.palette = { id: t.id, name: t.name, mode: t.mode || 'dark', source: t.source, colors };
}

async function allSnippets() {
  const lib = await library();
  return [
    ...BUILTIN_SNIPPETS.map(s => ({ ...s, kind: 'built-in' })),
    ...(lib.snippets || []).map(s => ({ ...s, kind: 'mine' })),
  ];
}

// ── Finding things in a project ──────────────────────────────────────────────

function findDeep(project, id) {
  const search = (list, layer, top) => {
    for (const o of list) {
      if (o.id === id) return { obj: o, layer, list, top: top || o };
      if (o.type === 'group') { const r = search(o.children, layer, top || o); if (r) return r; }
    }
    return null;
  };
  for (const layer of project.layers) { const r = search(layer.objects, layer, null); if (r) return r; }
  return null;
}

// A layer by id or name; by default the topmost visible, unlocked one.
function findLayer(project, ref, { writable = false } = {}) {
  let layer;
  if (ref == null || ref === '') {
    layer = [...project.layers].reverse().find(l => l.visible && !l.locked) || project.layers.at(-1);
  } else {
    const r = String(ref).toLowerCase();
    layer = project.layers.find(l => l.id === ref) || project.layers.find(l => l.name.toLowerCase() === r);
    if (!layer) throw new ToolError(`No layer "${ref}". Layers: ${project.layers.map(l => `"${l.name}"`).join(', ')}`);
  }
  if (writable && layer.locked) throw new ToolError(`Layer "${layer.name}" is locked. Unlock it with edit_layer first.`);
  return layer;
}

// ── Building objects from the AI's specs ─────────────────────────────────────

const FACTORIES = {
  box: () => makeBox(0, 0, 20, 5),
  text: () => makeText(0, 0, ''),
  line: () => makeLine(0, 0, 1, 0),
  table: () => makeTable(0, 0, 1, 1),
  block: () => makeBlock(0, 0, 1, 1),
  cursor: () => makeCursor(0, 0),
  paint: () => makePaint(0, 0),
  group: () => makeGroup([]),
};
const ATTR_KEYS = ['bold', 'italic', 'underline', 'dim', 'strike'];
const COLOR_KEYS = ['fg', 'bg', 'borderFg', 'headerFg', 'headerBg'];
const HELPER_KEYS = ['type', 'id', 'cols', 'rows', 'children', 'move', 'layer'];
const GUESS = {
  color: 'fg', foreground: 'fg', background: 'bg', borderColor: 'borderFg', width: 'w', height: 'h',
  content: 'text', label: 'text', value: 'text', style: 'border', borderStyle: 'border', char: 'glyph',
};

function checkColor(v, palette, notes) {
  if (v == null || /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) || palette?.colors?.[v]) return;
  notes.push(`Color "${v}" isn't a palette slot or #rrggbb, so it shows as the default. `
    + `Slots: ${Object.keys(palette?.colors || {}).join(', ')}.`);
}

// Copy a spec's fields onto `o`, skipping (and noting) fields the type doesn't have.
function assign(o, spec, palette, notes) {
  for (const [k, v] of Object.entries(spec)) {
    if (HELPER_KEYS.includes(k)) continue;
    if (ATTR_KEYS.includes(k)) { o.attrs = { ...o.attrs, [k]: !!v }; continue; }
    if (k === 'attrs') { o.attrs = { ...o.attrs, ...v }; continue; }
    if (!(k in o)) {
      const hint = (k === 'x' || k === 'y') && (o.type === 'group' || o.type === 'line') ? ' (use "move": [dx, dy])'
        : GUESS[k] in o ? ` (did you mean "${GUESS[k]}"?)` : '';
      notes.push(`Ignored "${k}" on ${o.type}${hint}.`);
      continue;
    }
    if (COLOR_KEYS.includes(k)) checkColor(v, palette, notes);
    o[k] = v;
  }
  for (const k of ['x', 'y', 'w', 'h']) {
    if (!(k in o)) continue;
    const n = Math.round(Number(o[k]));
    if (!Number.isFinite(n)) throw new ToolError(`"${k}" must be a number of cells.`);
    o[k] = k === 'w' || k === 'h' ? Math.max(1, n) : n;
  }
}

// Rows needed to show a frame's text wrapped at its width.
function wrappedHeight(o) {
  const ins = frameInset(o);
  return layoutText(o.text || '', o.w - ins.x * 2, 0).rows.length + ins.y * 2;
}

const validPoints = pts => Array.isArray(pts) && pts.length >= 2
  && pts.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isInteger));

// Table cells, widths and heights from `cells` (or `cols`/`rows`).
function shapeTable(o, spec) {
  const given = Array.isArray(spec.cells);
  const cells = given ? spec.cells.map(r => (Array.isArray(r) ? r : [r]).map(c => (c == null ? '' : String(c)))) : null;
  const nr = cells ? Math.max(1, cells.length) : Math.max(1, Math.min(200, spec.rows || 3));
  const nc = cells ? Math.max(1, ...cells.map(r => r.length)) : Math.max(1, Math.min(50, spec.cols || 3));
  o.cells = Array.from({ length: nr }, (_, r) => Array.from({ length: nc }, (_, c) =>
    cells ? cells[r]?.[c] ?? '' : r === 0 && o.header ? `Column ${c + 1}` : ''));
  const pad = o.padding ?? 1;
  const textW = c => Math.max(...o.cells.map(r => Math.max(...r[c].split('\n').map(l => Array.from(l).length))));
  o.colWidths = Array.from({ length: nc }, (_, c) => spec.colWidths?.[c] ?? (given ? Math.max(3, textW(c) + pad * 2) : 12));
  o.rowHeights = Array.from({ length: nr }, (_, r) => spec.rowHeights?.[r] ?? Math.max(1, ...o.cells[r].map(t => t.split('\n').length)));
  o.aligns = Array.from({ length: nc }, (_, c) => spec.aligns?.[c] ?? 'left');
}

function build(spec, palette, notes) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new ToolError('Each object must be a JSON object with a "type".');
  const type = spec.type === 'arrow' ? 'line' : spec.type;
  if (!FACTORIES[type]) throw new ToolError(`Unknown object type "${spec.type}". Types: box, text, line (or arrow), table, block, cursor, paint, group.`);
  const o = FACTORIES[type]();
  assign(o, spec, palette, notes);
  switch (type) {
    case 'text':
      // a width makes text wrap; otherwise the frame fits the text
      if (spec.autoSize === undefined) o.autoSize = spec.w === undefined && spec.h === undefined;
      if (o.autoSize) fitText(o);
      else if (spec.h === undefined) o.h = wrappedHeight(o);
      break;
    case 'box':
      if (spec.h === undefined && o.text) o.h = Math.max(3, wrappedHeight(o));
      break;
    case 'line':
      if (!validPoints(o.points)) throw new ToolError('A line needs "points": [[x1, y1], [x2, y2], …] (two or more whole-number pairs).');
      break;
    case 'table':
      shapeTable(o, spec);
      break;
    case 'group':
      if (!Array.isArray(spec.children) || !spec.children.length) throw new ToolError('A group needs "children": [objects…].');
      o.children = spec.children.map(c => build(c, palette, notes));
      break;
  }
  return o;
}

function offCanvas(project, objs, notes) {
  for (const o of objs) {
    const b = bounds(o);
    if (b.x < 0 || b.y < 0 || b.x + b.w > project.cols || b.y + b.h > project.rows) {
      notes.push(`${o.type} ${o.id} (x=${b.x} y=${b.y} w=${b.w} h=${b.h}) goes past the ${project.cols}×${project.rows} canvas; the part outside won't show.`);
    }
  }
}

function pruneEmptyGroups(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    if (o.type !== 'group') continue;
    pruneEmptyGroups(o.children);
    if (!o.children.length) list.splice(i, 1);
  }
}

// ── Rendering for the AI ─────────────────────────────────────────────────────

// The canvas as text with a column ruler on top and row numbers down the left.
function ruled(grid, { crop = false } = {}) {
  let { x, y, w, h } = { x: 0, y: 0, w: grid.cols, h: grid.rows };
  if (crop) { const r = contentRect(grid); if (r.w) ({ x, y, w, h } = r); }
  const pad = String(y + h - 1).length;
  let tens = '', units = '';
  for (let c = x; c < x + w; c++) {
    if (c % 10 === 0 && tens.length <= c - x) tens = tens.padEnd(c - x) + c;
    units += c % 10;
  }
  const lines = [' '.repeat(pad + 1) + tens, ' '.repeat(pad + 1) + units];
  for (let r = y; r < y + h; r++) {
    let s = '';
    for (let c = x; c < x + w; c++) s += grid.ch[r * grid.cols + c] ?? ' ';
    lines.push(String(r).padStart(pad) + '│' + s.replace(/ +$/, ''));
  }
  return lines.join('\n');
}

const clip = (s, n = 40) => {
  const one = String(s).replace(/\n/g, '⏎');
  return Array.from(one).length > n ? Array.from(one).slice(0, n - 1).join('') + '…' : one;
};

function describe(o) {
  const b = bounds(o);
  const bits = [o.type, o.id];
  if (o.name) bits.push(`"${o.name}"`);
  bits.push(o.type === 'line' ? 'points ' + JSON.stringify(o.points) : `x=${b.x} y=${b.y} w=${b.w} h=${b.h}`);
  if (o.title) bits.push(`title "${clip(o.title)}"`);
  if (o.text) bits.push(`text "${clip(o.text)}"`);
  if (o.type === 'table') bits.push(`${o.colWidths.length} cols × ${o.rowHeights.length} rows, header "${clip(o.cells[0].join(' | '))}"`);
  if (o.hidden) bits.push('hidden');
  return bits.join(' · ');
}

function outline(project, selection = []) {
  const out = ['Objects (layers bottom to top; later objects draw on top):'];
  project.layers.forEach((l, i) => {
    const flags = [!l.visible && 'hidden', l.locked && 'locked'].filter(Boolean);
    out.push(`Layer ${i + 1} "${l.name}" (id ${l.id})${flags.length ? ` [${flags.join(', ')}]` : ''}${l.objects.length ? '' : ' — empty'}`);
    const list = (objs, depth) => objs.forEach(o => {
      out.push('  '.repeat(depth) + '- ' + describe(o) + (selection.includes(o.id) ? '   ← selected in OTIS' : ''));
      if (o.type === 'group') list(o.children, depth + 1);
    });
    list(l.objects, 1);
  });
  return out.join('\n');
}

function header(project) {
  return `Project "${project.name}" (id ${project.id}) · canvas ${project.cols}×${project.rows} `
    + `(x 0–${project.cols - 1}, y 0–${project.rows - 1}) · theme ${project.palette?.name || '?'} · font ${project.font?.family}`;
}

async function selectionFor(project) {
  const cur = await json('GET', 'current').catch(() => null);
  return cur?.id === project.id ? cur.selection || [] : [];
}

// What every editing tool returns: what happened, any notes, and a fresh look.
function report(project, summary, notes) {
  return [summary, ...notes.map(n => '! ' + n), '', header(project), ruled(composite(project))].join('\n');
}

// ── Tools ────────────────────────────────────────────────────────────────────

const PROJECT = { type: 'string', description: 'Project id or name. Leave out to use the project open in OTIS.' };
const LAYER = { type: 'string', description: 'Layer id or name. Default: the topmost visible, unlocked layer.' };

const OBJECT_GUIDE = `Coordinates are character cells: x = column, y = row, 0-based from the top-left. Fields by type:
- box: x y w h border title titleAlign(left|center|right) text align(left|center|right) valign(top|middle|bottom) padding fill borderFg. Boxes are see-through inside; give a popup fill " " (and bg, e.g. "background") so it covers what's underneath
- text: x y text; add w (and h) to wrap inside a fixed frame, otherwise it sizes to fit. border(default none) align transparent(true lets spaces show what's underneath, for ASCII art)
- line (or "arrow"): points [[x1,y1],[x2,y2],…], each pair joined with one elbow. route(hv = horizontal first | vh) style start end
- table: x y cells [["NAME","CPU"],["nginx","12%"]] (column widths fit the content; or cols/rows) aligns colWidths rowHeights header(first row bold, line under it) rowLines colLines border headerFg headerBg borderFg padding
- block: x y w h glyph (fills the rectangle: █ ▓ ▒ ░ ▀ ▄ …)
- cursor: x y glyph blink
- paint: x y cells [[dx,dy,"char",fg,bg],…]
- group: children [objects…] (moves and selects as one; children keep absolute coordinates)
Every object: name fg bg font attrs{bold,italic,underline,dim,strike} (bold:true etc. also work).
border: none single double heavy rounded dashed heavy-dashed ascii block half outer. Line style: single double heavy rounded dashed ascii. Ends: none arrow triangle dot circle diamond square bar.
Colors: a palette slot (accent, foreground, background, muted, red, green, yellow, blue, magenta, cyan, orange, bright_*, …) that follows the theme, "#rrggbb", or null for the default.`;

const TOOLS = [
  {
    name: 'list_projects',
    title: 'List projects',
    description: 'List saved OTIS projects, newest first, and which one is open in OTIS.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run() {
      const [list, cur] = await Promise.all([json('GET', 'projects'), json('GET', 'current').catch(() => ({}))]);
      if (!list.length) return 'No saved projects yet. create_project makes one.';
      return list.map(p => `${p.id} · "${p.name}" · ${p.cols}×${p.rows} · saved ${p.updated}${p.id === cur.id ? '   ← open in OTIS' : ''}`).join('\n');
    },
  },
  {
    name: 'render',
    title: 'Render a design',
    description: 'Show a project as text, the way it looks on the canvas. With the ruler (default) it has column numbers on top and row numbers down the left, plus a list of every object with its id and position. Use it to see a design before you change it. format "markdown" or "ansi" gives export-ready output instead.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        format: { type: 'string', enum: ['text', 'markdown', 'ansi', 'ansi-truecolor'], description: 'Default text.' },
        ruler: { type: 'boolean', description: 'Text format only: coordinates and the object list. Default true.' },
        crop: { type: 'boolean', description: 'Trim to the area with content. Default false.' },
        layers: { type: 'array', items: { type: 'string' }, description: 'Only these layers (ids or names), even hidden ones. Default: the visible layers.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run({ project: ref, format = 'text', ruler = true, crop = false, layers }) {
      const { project } = await load(await projectId(ref));
      const only = layers?.length ? layers.map(r => ({ ...findLayer(project, r), visible: true })) : undefined;
      const grid = composite(project, only ? { layers: only } : {});
      if (format === 'markdown') return toMarkdown(project, grid, { crop });
      if (format === 'ansi' || format === 'ansi-truecolor') return toAnsi(grid, project, { mode: format === 'ansi' ? 'theme' : 'truecolor', crop });
      if (!ruler) return toText(grid, { crop });
      return [header(project), ruled(grid, { crop }), '', outline(project, await selectionFor(project))].join('\n');
    },
  },
  {
    name: 'get_project',
    title: 'Get project JSON',
    description: 'The full project as OTIS JSON (layers, objects and every field). Use render for a quicker look.',
    inputSchema: { type: 'object', properties: { project: PROJECT }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run({ project: ref }) {
      const { project } = await load(await projectId(ref));
      return JSON.stringify(project);
    },
  },
  {
    name: 'create_project',
    title: 'Create a project',
    description: 'Start a new design, optionally with objects, and open it in OTIS. ' + OBJECT_GUIDE,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        cols: { type: 'integer', description: 'Canvas width in characters. Default 100.' },
        rows: { type: 'integer', description: 'Canvas height in characters. Default 30.' },
        theme: { type: 'string', description: 'Theme id or name (see get_palette). Default PhosphorWolf.' },
        objects: { type: 'array', items: { type: 'object' }, description: 'Objects to start with, on the first layer.' },
        show: { type: 'boolean', description: 'Open it in the OTIS window. Default true.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async run({ name, cols = 100, rows = 30, theme, objects = [], show = true }) {
      const project = normalizeProject(makeProject({
        name: String(name), cols: Math.max(1, Math.min(500, cols)), rows: Math.max(1, Math.min(500, rows)),
      }));
      if (theme) applyTheme(project, await findTheme(theme));
      const notes = [];
      const built = objects.map(s => build(s, project.palette, notes));
      project.layers[0].objects.push(...built);
      offCanvas(project, built, notes);
      await json('PUT', 'projects/' + project.id, project);
      let where = '';
      if (show) {
        const { windows } = await json('POST', 'show', { id: project.id });
        where = windows ? ' It is open in OTIS.' : ` No OTIS window is open; it's at ${BASE}/#p=${project.id}`;
      }
      return report(project, `Created "${project.name}" (id ${project.id}).${where}`
        + (built.length ? ` Object ids: ${built.map(o => o.id).join(', ')}.` : ''), notes);
    },
  },
  {
    name: 'add_objects',
    title: 'Add objects',
    description: 'Add objects to a project. Returns their ids and a fresh render. ' + OBJECT_GUIDE,
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        layer: LAYER,
        objects: { type: 'array', items: { type: 'object' }, minItems: 1 },
      },
      required: ['objects'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async run({ project: ref, layer, objects }) {
      const { project, notes, result } = await edit(ref, (p, notes) => {
        const target = findLayer(p, layer, { writable: true });
        const built = objects.map(s => build(s, p.palette, notes));
        target.objects.push(...built);
        offCanvas(p, built, notes);
        return { built, target };
      });
      return report(project, `Added ${result.built.length} object(s) to layer "${result.target.name}": `
        + result.built.map(o => `${o.type} ${o.id}`).join(', ') + '.', notes);
    },
  },
  {
    name: 'update_objects',
    title: 'Change objects',
    description: 'Change objects by id: set any of their fields, "move": [dx, dy] to shift them (works for groups and lines too), or "layer" to move a top-level object to another layer. Fields not given stay as they are. Returns a fresh render.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        changes: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              move: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
              layer: { type: 'string' },
            },
            required: ['id'],
          },
          description: 'e.g. [{"id": "k3j9x2", "title": "Logs", "fg": "accent"}, {"id": "q81", "move": [0, 2]}]',
        },
      },
      required: ['changes'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async run({ project: ref, changes }) {
      const { project, notes } = await edit(ref, (p, notes) => {
        for (const ch of changes) {
          const hit = findDeep(p, ch.id);
          if (!hit) throw new ToolError(`No object with id "${ch.id}". render lists the ids.`);
          if (hit.layer.locked) throw new ToolError(`${ch.id} is on locked layer "${hit.layer.name}".`);
          const o = hit.obj;
          if ('type' in ch && ch.type !== o.type) notes.push(`Can't turn a ${o.type} into a ${ch.type}; delete it and add a new one.`);
          assign(o, ch, p.palette, notes);
          if (o.type === 'text' && ('w' in ch || 'h' in ch) && !('autoSize' in ch)) o.autoSize = false;
          if ((o.type === 'text' || o.type === 'box') && o.autoSize) fitText(o);
          if (o.type === 'table' && (ch.cells || ch.cols || ch.rows)) {
            const cells = Array.isArray(ch.cells) ? ch.cells : null;
            resizeTable(o, cells ? Math.max(...cells.map(r => r.length)) : ch.cols || o.colWidths.length, cells ? cells.length : ch.rows || o.rowHeights.length);
            if (cells) o.cells = o.cells.map((row, r) => row.map((_, c) => String(cells[r]?.[c] ?? '')));
          }
          if (o.type === 'line' && !validPoints(o.points)) throw new ToolError(`Line ${o.id} needs at least two [x, y] points.`);
          if (ch.move) {
            if (!validPoints([ch.move, [0, 0]])) throw new ToolError('"move" is [dx, dy] in whole cells.');
            translate(o, ch.move[0], ch.move[1]);
          }
          if (ch.layer) {
            if (hit.top !== o) notes.push(`${o.id} is inside a group; move the group to another layer instead.`);
            else {
              const target = findLayer(p, ch.layer, { writable: true });
              if (target !== hit.layer) { hit.list.splice(hit.list.indexOf(o), 1); target.objects.push(o); }
            }
          }
          offCanvas(p, [o], notes);
        }
      });
      return report(project, `Changed ${changes.length} object(s).`, notes);
    },
  },
  {
    name: 'delete_objects',
    title: 'Delete objects',
    description: 'Delete objects by id (including objects inside groups). The user can undo it in OTIS with Ctrl+Z.',
    inputSchema: {
      type: 'object',
      properties: { project: PROJECT, ids: { type: 'array', items: { type: 'string' }, minItems: 1 } },
      required: ['ids'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async run({ project: ref, ids }) {
      const { project, notes, result } = await edit(ref, (p, notes) => {
        let n = 0;
        for (const id of ids) {
          const hit = findDeep(p, id);
          if (!hit) { notes.push(`No object "${id}".`); continue; }
          if (hit.layer.locked) { notes.push(`${id} is on locked layer "${hit.layer.name}"; skipped.`); continue; }
          hit.list.splice(hit.list.indexOf(hit.obj), 1);
          n++;
        }
        p.layers.forEach(l => pruneEmptyGroups(l.objects));
        return n;
      });
      return report(project, `Deleted ${result} object(s).`, notes);
    },
  },
  {
    name: 'edit_layer',
    title: 'Edit layers',
    description: 'Add, rename, show, hide, lock, unlock, raise, lower or delete a layer. Layers stack bottom to top; lines only join with lines on the same layer, so popups and overlays belong on their own layer.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        action: { type: 'string', enum: ['add', 'rename', 'show', 'hide', 'lock', 'unlock', 'raise', 'lower', 'delete'] },
        layer: { type: 'string', description: 'The layer to change (id or name). Not used by "add".' },
        name: { type: 'string', description: 'Name for "add" or "rename".' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async run({ project: ref, action, layer, name }) {
      const { project, result } = await edit(ref, p => {
        if (action === 'add') {
          const l = makeLayer(name || `Layer ${p.layers.length + 1}`);
          p.layers.push(l);
          return `Added layer "${l.name}" (id ${l.id}) on top.`;
        }
        if (!layer) throw new ToolError(`"${action}" needs "layer".`);
        const l = findLayer(p, layer);
        const i = p.layers.indexOf(l);
        switch (action) {
          case 'rename': if (!name) throw new ToolError('"rename" needs "name".'); l.name = name; break;
          case 'show': l.visible = true; break;
          case 'hide': l.visible = false; break;
          case 'lock': l.locked = true; break;
          case 'unlock': l.locked = false; break;
          case 'raise': if (i < p.layers.length - 1) [p.layers[i], p.layers[i + 1]] = [p.layers[i + 1], p.layers[i]]; break;
          case 'lower': if (i > 0) [p.layers[i], p.layers[i - 1]] = [p.layers[i - 1], p.layers[i]]; break;
          case 'delete':
            if (p.layers.length === 1) throw new ToolError('A project needs at least one layer.');
            p.layers.splice(i, 1);
            return `Deleted layer "${l.name}" and its ${l.objects.length} object(s).`;
        }
        return `Layer "${l.name}": ${action} done.`;
      });
      return [result, '', outline(project)].join('\n');
    },
  },
  {
    name: 'update_project',
    title: 'Change project settings',
    description: 'Rename the project, resize the canvas, switch the theme, or set the font and default colors.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        name: { type: 'string' },
        cols: { type: 'integer' },
        rows: { type: 'integer' },
        theme: { type: 'string', description: 'Theme id or name; colors set as palette slots follow it.' },
        font: { type: 'object', properties: { family: { type: 'string' }, size: { type: 'number' }, lineHeight: { type: 'number' } } },
        background: { type: 'string', description: 'Canvas background color (slot or #hex).' },
        foreground: { type: 'string', description: 'Default text color (slot or #hex).' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async run({ project: ref, name, cols, rows, theme, font, background, foreground }) {
      const t = theme ? await findTheme(theme) : null;
      const { project, notes } = await edit(ref, (p, notes) => {
        if (name != null) p.name = String(name);
        if (cols != null) p.cols = Math.max(1, Math.min(500, cols));
        if (rows != null) p.rows = Math.max(1, Math.min(500, rows));
        if (t) applyTheme(p, t);
        if (font) p.font = { ...p.font, ...font };
        if (background != null) { checkColor(background, p.palette, notes); p.background = background; }
        if (foreground != null) { checkColor(foreground, p.palette, notes); p.foreground = foreground; }
      });
      return report(project, 'Project updated.', notes);
    },
  },
  {
    name: 'get_palette',
    title: 'Palette and themes',
    description: 'The project\'s palette (slot names and their colors) and the themes it can switch to.',
    inputSchema: { type: 'object', properties: { project: PROJECT }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run({ project: ref }) {
      const out = [];
      let id = null;
      try { id = await projectId(ref); } catch (e) { if (ref) throw e; }
      if (id) {
        const { project } = await load(id);
        const c = project.palette.colors;
        out.push(`Palette of "${project.name}": ${project.palette.name} (${project.palette.mode || 'dark'})`);
        out.push(...SLOTS.filter(k => c[k]).map(k => `  ${k.padEnd(19)} ${c[k]}`));
        const custom = Object.keys(c).filter(k => !SLOTS.includes(k));
        if (custom.length) out.push('Custom swatches:', ...custom.map(k => `  ${k.padEnd(19)} ${c[k]}`));
        out.push('');
      }
      const themes = await allThemes();
      for (const kind of ['Built-in', 'My palettes', 'On this machine']) {
        const list = themes.filter(t => t.kind === kind);
        if (list.length) out.push(`${kind} themes: ` + list.map(t => `${t.id} (${t.name})`).join(', '));
      }
      return out.join('\n');
    },
  },
  {
    name: 'list_snippets',
    title: 'List snippets',
    description: 'Ready-made widgets you can drop in with insert_snippet: progress bars, sparklines, charts, tables, tabs, dialogs, status lines, plus the user\'s own snippets.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run() {
      const list = await allSnippets();
      const cats = [...new Set(list.map(s => s.category || 'Other'))];
      return cats.map(cat => `${cat}:\n` + list.filter(s => (s.category || 'Other') === cat)
        .map(s => `  ${s.id} · "${s.name}" · ${s.w}×${s.h}${s.kind === 'mine' ? ' · saved by the user' : ''}`).join('\n')).join('\n');
    },
  },
  {
    name: 'insert_snippet',
    title: 'Insert a snippet',
    description: 'Place a snippet (from list_snippets) with its top-left corner at x, y. Several pieces come in as one group.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        snippet: { type: 'string', description: 'Snippet id or name.' },
        x: { type: 'integer' },
        y: { type: 'integer' },
        layer: LAYER,
      },
      required: ['snippet', 'x', 'y'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async run({ project: ref, snippet, x, y, layer }) {
      const list = await allSnippets();
      const r = String(snippet).toLowerCase();
      const s = list.find(s => s.id === snippet) || list.find(s => s.name.toLowerCase() === r);
      if (!s) throw new ToolError(`No snippet "${snippet}". list_snippets shows them all.`);
      const { project, notes, result } = await edit(ref, (p, notes) => {
        const copies = s.objects.map(cloneObject);
        copies.forEach(o => translate(o, x, y));
        const obj = copies.length > 1 ? makeGroup(copies, { name: s.name }) : Object.assign(copies[0], { name: copies[0].name || s.name });
        findLayer(p, layer, { writable: true }).objects.push(obj);
        offCanvas(p, [obj], notes);
        return obj;
      });
      return report(project, `Inserted "${s.name}" as ${result.type} ${result.id}.`, notes);
    },
  },
  {
    name: 'show_project',
    title: 'Open in OTIS',
    description: 'Switch the OTIS window to a project so the user can see it.',
    inputSchema: { type: 'object', properties: { project: { ...PROJECT, description: 'Project id or name.' } }, required: ['project'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async run({ project: ref }) {
      const id = await projectId(ref);
      const { windows } = await json('POST', 'show', { id });
      return windows ? `Opened ${id} in OTIS.` : `No OTIS window is open. The project is at ${BASE}/#p=${id}`;
    },
  },
];

const INSTRUCTIONS = `OTIS (Omarchy Text Interface Studio) designs terminal UIs on a grid of character cells: x is the column, y the row, 0-based from the top-left.
- Tools work on the project open in the user's OTIS window unless you pass "project" (an id or name from list_projects).
- Look before you edit: render shows the canvas with a coordinate ruler and every object's id. Every edit returns a fresh render, so check your work.
- Build with boxes (bordered frames with a title and text), text, tables, arrows (line), blocks, and groups. Group the parts of one widget so they move together. Put popups and overlays on their own layer.
- Lines on the same layer join automatically (├ ┬ ┼ ┤), so a divider that ends on a box border makes a clean junction.
- Use palette slots for colors (accent, foreground, muted, red, green, blue…) rather than hex, so the design follows the theme. get_palette lists them.
- list_snippets has ready-made widgets: progress bars, sparklines, charts, tabs, dialogs, status lines.
- The user watches changes live and can undo them with Ctrl+Z. Objects they have selected are marked "← selected in OTIS" in render.`;

// ── MCP over stdio ───────────────────────────────────────────────────────────

const rpcError = (code, message, data) => Object.assign(new Error(message), { rpc: { code, message, ...(data ? { data } : {}) } });
const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');

async function callTool(name, args) {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) throw rpcError(-32602, `Unknown tool: ${name}`);
  try {
    return { content: [{ type: 'text', text: await tool.run(args || {}) }], isError: false };
  } catch (e) {
    if (!(e instanceof ToolError)) log(e);
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
}

async function dispatch(method, params = {}) {
  const requested = params._meta?.['io.modelcontextprotocol/protocolVersion'];
  if (requested !== undefined && !MODERN.includes(requested)) {
    throw rpcError(-32022, 'Unsupported protocol version', { supported: [...MODERN, ...LEGACY], requested });
  }
  if (method === 'initialize') {
    const v = params.protocolVersion;
    return { protocolVersion: LEGACY.includes(v) ? v : LEGACY[0], capabilities: { tools: {} }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS };
  }
  // the tool list never changes while this process runs, so clients may cache it
  const cache = { ttlMs: 3600000, cacheScope: 'public' };
  let result;
  switch (method) {
    case 'server/discover':
      result = { supportedVersions: [...MODERN, ...LEGACY], capabilities: { tools: {} }, instructions: INSTRUCTIONS, ...cache };
      break;
    case 'ping': result = {}; break;
    case 'tools/list': result = { tools: TOOLS.map(({ run, ...t }) => t), ...cache }; break;
    case 'tools/call': result = await callTool(params.name, params.arguments); break;
    default: throw rpcError(-32601, `Method not found: ${method}`);
  }
  result.resultType = 'complete';
  if (requested !== undefined) result._meta = { 'io.modelcontextprotocol/serverInfo': SERVER_INFO };
  return result;
}

async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } });
  const { id, method, params } = msg;
  if (typeof method !== 'string' || id === undefined || id === null) return;   // notifications and stray responses
  try {
    send({ jsonrpc: '2.0', id, result: await dispatch(method, params || {}) });
  } catch (e) {
    if (!e.rpc) log(e);
    send({ jsonrpc: '2.0', id, error: e.rpc || { code: -32603, message: e.message } });
  }
}

const pending = new Set();
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  if (!line.trim()) return;
  const job = handle(line).finally(() => pending.delete(job));
  pending.add(job);
});
// stdin closed: finish what's in flight, then exit
rl.on('close', async () => { await Promise.allSettled([...pending]); process.exit(0); });
