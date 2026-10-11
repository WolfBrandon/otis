// Palettes for OTIS. A palette is { id, name, mode, colors }, where `colors`
// uses Omarchy's colors.toml keys (see docs/FORMAT.md) plus any custom keys.
// Pure functions, no DOM.
import { normalizeHex, mix, luminance } from './color.js';

// The standard slots found in Omarchy's colors.toml, in display order.
export const SLOTS = [
  'background', 'dark_background', 'darker_background', 'lighter_background', 'selection',
  'foreground', 'dark_foreground', 'light_foreground', 'bright_foreground',
  'accent', 'muted',
  'red', 'yellow', 'orange', 'green', 'cyan', 'blue', 'magenta', 'brown',
  'bright_red', 'bright_yellow', 'bright_green', 'bright_cyan', 'bright_blue', 'bright_magenta',
];

export const SLOT_GROUPS = [
  { label: 'Surface', keys: ['background', 'dark_background', 'darker_background', 'lighter_background', 'selection'] },
  { label: 'Text', keys: ['foreground', 'dark_foreground', 'light_foreground', 'bright_foreground'] },
  { label: 'Accent', keys: ['accent', 'muted'] },
  { label: 'Colors', keys: ['red', 'yellow', 'orange', 'green', 'cyan', 'blue', 'magenta', 'brown'] },
  { label: 'Bright', keys: ['bright_red', 'bright_yellow', 'bright_green', 'bright_cyan', 'bright_blue', 'bright_magenta'] },
];

// ANSI color index → slot, matching Omarchy's terminal templates.
export const ANSI_SLOTS = [
  'background', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'foreground',
  'muted', 'bright_red', 'bright_green', 'bright_yellow', 'bright_blue', 'bright_magenta', 'bright_cyan', 'bright_foreground',
];

// Color ref (hex, slot key, or null) → "#rrggbb" or null.
export function resolveColor(ref, palette) {
  if (ref == null || ref === '') return null;
  if (ref.startsWith('#')) return normalizeHex(ref);
  const v = palette?.colors?.[ref];
  return v ? normalizeHex(v) : null;
}

// "tokyo-night" → "Tokyo Night"
export function prettyName(id) {
  const fixes = { 'rose-pine': 'Rosé Pine' };
  if (fixes[id]) return fixes[id];
  return String(id).split(/[-_\s]+/).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

const DEFAULT_ANSI = {
  red: '#cd3131', green: '#0dbc79', yellow: '#e5e510', blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd',
};

// Returns a copy of `colors` with every standard slot filled in, all values
// normalized to lowercase "#rrggbb". Custom keys are kept.
export function completePalette(colors = {}) {
  const c = {};
  for (const [k, v] of Object.entries(colors)) {
    const hex = normalizeHex(v);
    if (hex) c[k] = hex;
  }
  if (!c.background && !c.foreground) c.background = '#1a1b26';
  if (!c.background) c.background = luminance(c.foreground) > 0.4 ? '#000000' : '#ffffff';
  if (!c.foreground) c.foreground = mix(luminance(c.background) > 0.4 ? '#000000' : '#ffffff', c.background, 0.15);
  const bg = c.background, fg = c.foreground;
  const dark = luminance(bg) < luminance(fg);
  const fill = (k, v) => { if (!c[k]) c[k] = v; };

  fill('dark_background', mix(bg, '#000000', dark ? 0.25 : 0.05));
  fill('darker_background', mix(bg, '#000000', dark ? 0.45 : 0.1));
  fill('lighter_background', mix(bg, fg, 0.08));
  fill('dark_foreground', mix(fg, bg, 0.45));
  fill('light_foreground', dark ? mix(fg, '#ffffff', 0.1) : mix(fg, bg, 0.1));
  fill('bright_foreground', dark ? mix(fg, '#ffffff', 0.2) : fg);
  for (const [k, v] of Object.entries(DEFAULT_ANSI)) fill(k, v);
  fill('accent', c.blue);
  fill('muted', mix(fg, bg, 0.6));
  fill('selection', mix(bg, fg, 0.18));
  fill('orange', mix(c.red, c.yellow, 0.5));
  fill('brown', mix(c.orange, '#000000', 0.45));
  for (const k of ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta']) {
    fill('bright_' + k, dark ? mix(c[k], '#ffffff', 0.2) : c[k]);
  }

  const out = {};
  for (const k of SLOTS) out[k] = c[k];
  for (const k of Object.keys(c)) if (!(k in out)) out[k] = c[k];
  return out;
}

// --- Theme file import ------------------------------------------------------

// A small TOML subset: [sections], key = "string" | 'string' | number | bare,
// and # comments. Returns { '': {...root}, 'colors.primary': {...}, ... }.
export function parseToml(text) {
  const out = { '': {} };
  let section = out[''];
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line) continue;
    let m = line.match(/^\[\[?\s*([^\]]+?)\s*\]\]?$/);
    if (m) { section = out[m[1]] ??= {}; continue; }
    m = line.match(/^([A-Za-z0-9_.-]+|"[^"]*")\s*=\s*(.+)$/);
    if (!m) continue;
    const key = m[1].replace(/^"|"$/g, '');
    let val = m[2].trim();
    if (/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1);
    else if (/^-?\d+(\.\d+)?$/.test(val)) val = Number(val);
    section[key] = val;
  }
  return out;
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) { if (ch === quote) quote = null; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return line.slice(0, i);
  }
  return line;
}

// "0x1a1b26", "1a1b26", "#1a1b26" → "#1a1b26"
function hexValue(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/^0x/i, '#');
  return normalizeHex(/^[0-9a-f]{6}$/i.test(s) ? '#' + s : s);
}

const ANSI_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

// Turns 16 ANSI colors + explicit bg/fg/selection into Omarchy slots.
function fromAnsi(ansi, { background, foreground, selection }) {
  const colors = {};
  if (background) colors.background = background;
  if (foreground) colors.foreground = foreground;
  if (selection) colors.selection = selection;
  ansi.forEach((hex, i) => {
    if (!hex) return;
    const slot = ANSI_SLOTS[i];
    if (i === 0 || i === 7) {
      const extra = i === 0 ? 'black' : 'white';
      if (!colors[slot]) colors[slot] = hex;
      else if (colors[slot] !== hex) colors[extra] = hex;
    } else if (!colors[slot]) colors[slot] = hex;
  });
  return colors;
}

function nameFromFile(filename) {
  const parts = String(filename || '').split(/[\\/]/).filter(Boolean);
  if (!parts.length) return 'Imported theme';
  const generic = /^(colors\.toml|alacritty\.toml|alacritty\.yml|config|ghostty\.conf|kitty\.conf|theme\.conf|theme\.toml)$/i;
  let base = parts[parts.length - 1];
  if (generic.test(base)) {
    if (parts.length < 2) return 'Imported theme';
    base = parts[parts.length - 2];
  }
  return prettyName(base.replace(/\.(toml|conf|ya?ml|theme|txt)$/i, '').replace(/\.(colors)$/i, '')) || 'Imported theme';
}

// Parse an Omarchy colors.toml, alacritty.toml, Ghostty config or kitty.conf.
// Returns { name, mode, colors } with every standard slot filled.
export function parseThemeFile(text, filename = '') {
  if (typeof text !== 'string' || !text.trim()) throw new Error('The theme file is empty.');
  const lines = text.split(/\r?\n/);
  let colors = null, mode = null;

  if (/^\s*\[colors\.(primary|normal|bright)\]/m.test(text)) {
    // alacritty.toml
    const t = parseToml(text);
    const ansi = [];
    ANSI_NAMES.forEach((n, i) => {
      ansi[i] = hexValue(t['colors.normal']?.[n]);
      ansi[i + 8] = hexValue(t['colors.bright']?.[n]);
    });
    colors = fromAnsi(ansi, {
      background: hexValue(t['colors.primary']?.background),
      foreground: hexValue(t['colors.primary']?.foreground),
      selection: hexValue(t['colors.selection']?.background),
    });
  } else if (lines.some((l) => /^\s*palette\s*=\s*\d+\s*=/.test(l))) {
    // Ghostty: "palette = 0=#15161e", "background = 1a1b26"
    const ansi = [], kv = {};
    for (const l of lines) {
      let m = l.match(/^\s*palette\s*=\s*(\d+)\s*=\s*(\S+)/);
      if (m) { if (+m[1] < 16) ansi[+m[1]] = hexValue(m[2]); continue; }
      m = l.match(/^\s*([a-z-]+)\s*=\s*(\S+)/);
      if (m) kv[m[1]] = hexValue(m[2]);
    }
    colors = fromAnsi(ansi, { background: kv.background, foreground: kv.foreground, selection: kv['selection-background'] });
  } else if (lines.some((l) => /^\s*(color\d{1,2}|background|foreground)\s+#?[0-9a-fA-F]{6}\b/.test(l))) {
    // kitty: "color0 #15161e", "background #1a1b26"
    const ansi = [], kv = {};
    for (const l of lines) {
      const m = l.match(/^\s*([a-z_0-9]+)\s+(#?[0-9a-fA-F]{6})\b/);
      if (!m) continue;
      const c = m[1].match(/^color(\d+)$/);
      if (c) { if (+c[1] < 16) ansi[+c[1]] = hexValue(m[2]); } else kv[m[1]] = hexValue(m[2]);
    }
    colors = fromAnsi(ansi, { background: kv.background, foreground: kv.foreground, selection: kv.selection_background });
  } else {
    // Omarchy colors.toml: flat key = "value"
    const root = parseToml(text)[''];
    colors = {};
    for (const [k, v] of Object.entries(root)) {
      if (k === 'mode') { mode = v === 'light' ? 'light' : 'dark'; continue; }
      const hex = hexValue(v);
      if (hex && /^#[0-9a-fA-F]{6}$/.test(String(v).trim())) colors[k] = hex;
    }
  }

  if (!colors || !Object.keys(colors).length) {
    throw new Error('No colors found. Expected an Omarchy colors.toml, alacritty.toml, Ghostty or kitty theme.');
  }
  const done = completePalette(colors);
  if (!mode) mode = luminance(done.background) < luminance(done.foreground) ? 'dark' : 'light';
  return { name: nameFromFile(filename), mode, colors: done };
}

// Palette → Omarchy colors.toml text.
export function paletteToToml(palette) {
  const colors = palette?.colors ?? {};
  const out = [`# ${palette?.name ?? 'Untitled'} — exported from OTIS`, `mode = "${palette?.mode === 'light' ? 'light' : 'dark'}"`];
  const order = [
    ['accent', 'selection', 'muted'],
    ['background', 'dark_background', 'darker_background', 'lighter_background'],
    ['foreground', 'dark_foreground', 'light_foreground', 'bright_foreground'],
    ['red', 'yellow', 'orange', 'green', 'cyan', 'blue', 'magenta', 'brown'],
    ['bright_red', 'bright_yellow', 'bright_green', 'bright_cyan', 'bright_blue', 'bright_magenta'],
  ];
  const seen = new Set();
  for (const group of order) {
    const rows = group.filter((k) => colors[k]).map((k) => { seen.add(k); return `${k} = "${normalizeHex(colors[k])}"`; });
    if (rows.length) out.push('', ...rows);
  }
  const extra = Object.keys(colors).filter((k) => !seen.has(k) && normalizeHex(colors[k]) && /^[A-Za-z0-9_-]+$/.test(k));
  if (extra.length) out.push('', '# custom swatches', ...extra.map((k) => `${k} = "${normalizeHex(colors[k])}"`));
  return out.join('\n') + '\n';
}
