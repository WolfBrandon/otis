// Built-in snippets: reusable TUI pieces. Each `build()` returns objects laid
// out from 0,0; colors are palette slots so they follow the theme.

import { makeText, makeBox, makeLine, makeBlock, makeCursor, makeGroup, makeTable, makeProject, makeLayer, bounds, unionBounds, translate } from './model.js';

const T = (x, y, text, o = {}) => makeText(x, y, text, o);
const bold = { bold: true };

// Lay text segments left to right: [[text, opts], ...]
function row(x, y, segs) {
  const out = [];
  for (const [text, o = {}] of segs) {
    out.push(T(x, y, text, o));
    x += Array.from(text).length;
  }
  return out;
}

const EIGHTHS = ' ▁▂▃▄▅▆▇█';
const H_EIGHTHS = ' ▏▎▍▌▋▊▉█';

function hbar(value, width) {        // value 0..1 → smooth horizontal bar
  const eighths = Math.round(value * width * 8);
  return '█'.repeat(Math.floor(eighths / 8)) + (eighths % 8 ? H_EIGHTHS[eighths % 8] : '');
}

function vbars(values, height, barW, gap) {   // values 0..1 → one multi-line string per bar
  return values.map(v => {
    const total = Math.round(v * height * 8);
    const lines = [];
    for (let r = height - 1; r >= 0; r--) {
      const level = Math.max(0, Math.min(8, total - r * 8));
      lines.push(EIGHTHS[level].repeat(barW));
    }
    return lines.join('\n');
  }).map((text, i) => ({ text, x: i * (barW + gap) }));
}

// Braille plot of f(x) over a w×h character area (2×4 dots per cell).
function braillePlot(f, w, h) {
  const W = w * 2, H = h * 4;
  const dots = Array.from({ length: h }, () => new Array(w).fill(0));
  const BIT = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];
  let prev = null;
  for (let px = 0; px < W; px++) {
    const py = Math.round((1 - f(px / (W - 1))) * (H - 1));
    const from = prev == null ? py : prev;
    for (let y = Math.min(from, py); y <= Math.max(from, py); y++)
      dots[Math.floor(y / 4)][Math.floor(px / 2)] |= BIT[y % 4][px % 2];
    prev = py;
  }
  return dots.map(r => r.map(b => String.fromCharCode(0x2800 + b)).join('')).join('\n');
}

const LOGO = [
  ' ██████╗ ████████╗██╗███████╗',
  '██╔═══██╗╚══██╔══╝██║██╔════╝',
  '██║   ██║   ██║   ██║███████╗',
  '██║   ██║   ██║   ██║╚════██║',
  '╚██████╔╝   ██║   ██║███████║',
  ' ╚═════╝    ╚═╝   ╚═╝╚══════╝',
].join('\n');

const DEFS = [
  // ── Widgets ──
  { name: 'Progress bar', category: 'Widgets', build: () => row(0, 0, [
    ['█'.repeat(14), { fg: 'green' }], ['░'.repeat(10), { fg: 'muted' }], [' 58%', { fg: 'foreground' }],
  ]) },
  { name: 'Progress bar (smooth)', category: 'Widgets', build: () => [
    makeBlock(0, 0, 24, 1, ' ', { bg: 'lighter_background' }),
    T(0, 0, hbar(0.71, 24), { fg: 'accent', bg: 'lighter_background' }),
    T(25, 0, '71%', { fg: 'accent', attrs: bold }),
  ] },
  { name: 'Gauge (htop)', category: 'Widgets', build: () => row(0, 0, [
    ['CPU', { fg: 'cyan', attrs: bold }], ['[', {}], ['||||||||||||', { fg: 'green' }], ['|||||', { fg: 'red' }],
    ['          42.1%', { fg: 'muted' }], [']', {}],
  ]) },
  { name: 'Button', category: 'Widgets', build: () => [
    makeBox(0, 0, 12, 3, { border: 'rounded', text: 'Submit', align: 'center', valign: 'middle', padding: 0, fg: 'accent', attrs: bold }),
  ] },
  { name: 'Button (solid)', category: 'Widgets', build: () => row(0, 0, [
    ['  OK  ', { fg: 'background', bg: 'accent', attrs: bold }], ['  ', {}], [' Cancel ', { fg: 'foreground', bg: 'lighter_background' }],
  ]) },
  { name: 'Checkbox list', category: 'Widgets', build: () => [
    T(0, 0, '[x]\n[ ]\n[x]', { fg: 'green' }),
    T(4, 0, 'Enable notifications\nDark mode\nCheck for updates'),
  ] },
  { name: 'Radio group', category: 'Widgets', build: () => [
    T(0, 0, '◉\n○\n○', { fg: 'accent' }),
    T(2, 0, 'Small\nMedium\nLarge'),
  ] },
  { name: 'Text input', category: 'Widgets', build: () => [
    makeBox(0, 0, 32, 3, { border: 'rounded', title: 'Search', fg: 'foreground', borderFg: 'accent' }),
    T(2, 1, 'type to filter…', { fg: 'muted' }),
    makeCursor(17, 1, '▏', { fg: 'accent' }),
  ] },
  { name: 'Menu list', category: 'Widgets', build: () => [
    makeBlock(0, 0, 22, 1, ' ', { bg: 'selection' }),
    T(0, 0, '❯ New project', { fg: 'accent', bg: 'selection', attrs: bold }),
    T(2, 1, 'Open…\nSettings\nQuit'),
  ] },
  { name: 'Tabs', category: 'Widgets', build: () => [
    ...row(0, 0, [[' Overview ', { fg: 'background', bg: 'accent', attrs: bold }], [' Logs ', { fg: 'muted' }], [' Settings ', { fg: 'muted' }]]),
    makeLine(0, 1, 25, 1, { end: 'none', fg: 'muted' }),
  ] },
  { name: 'Badge', category: 'Widgets', build: () => row(0, 0, [
    [' NEW ', { fg: 'background', bg: 'magenta', attrs: bold }], [' ', {}], [' v0.1 ', { fg: 'background', bg: 'green' }],
  ]) },
  { name: 'Spinner', category: 'Widgets', build: () => row(0, 0, [
    ['⠋', { fg: 'accent' }], [' Installing packages…', {}],
  ]) },
  { name: 'Toast', category: 'Widgets', build: () => [
    makeBox(0, 0, 24, 3, { border: 'rounded', fg: 'green', bg: 'lighter_background', text: '✓ Project saved', padding: 1, valign: 'middle' }),
  ] },
  { name: 'Key hints', category: 'Widgets', build: () => row(0, 0, [
    ['q', { fg: 'accent', attrs: bold }], [' quit  ', { fg: 'muted' }],
    ['↑/↓', { fg: 'accent', attrs: bold }], [' move  ', { fg: 'muted' }],
    ['enter', { fg: 'accent', attrs: bold }], [' select  ', { fg: 'muted' }],
    ['?', { fg: 'accent', attrs: bold }], [' help', { fg: 'muted' }],
  ]) },
  { name: 'Status line (powerline)', category: 'Widgets', build: () => row(0, 0, [
    [' NORMAL ', { fg: 'background', bg: 'accent', attrs: bold }], ['', { fg: 'accent', bg: 'lighter_background' }],
    ['  main ', { fg: 'foreground', bg: 'lighter_background' }], ['', { fg: 'lighter_background' }],
    [' notes.md ', { fg: 'muted' }],
  ]) },

  // ── Charts ──
  { name: 'Sparkline', category: 'Charts', build: () => [T(0, 0, '▁▂▃▅▇█▇▅▃▂▁▂▃▄▆█▆▄▃▂▃▅', { fg: 'cyan' })] },
  { name: 'Bar chart', category: 'Charts', build: () => {
    const vals = [0.35, 0.6, 0.9, 0.7, 1, 0.55, 0.8];
    const colors = ['blue', 'blue', 'cyan', 'blue', 'accent', 'blue', 'cyan'];
    return [
      ...vbars(vals, 6, 3, 1).map((b, i) => T(b.x + 2, 0, b.text, { fg: colors[i], transparent: true })),
      makeLine(1, 0, 1, 6, { end: 'none', start: 'none', fg: 'muted', route: 'vh' }),
      makeLine(1, 6, 29, 6, { end: 'none', fg: 'muted' }),
      T(2, 7, 'Mon Tue Wed Thu Fri Sat Sun', { fg: 'muted' }),
    ];
  } },
  { name: 'Horizontal bars', category: 'Charts', build: () => {
    const rows = [['nginx', 0.82], ['postgres', 0.54], ['redis', 0.18], ['otis', 0.67]];
    return rows.flatMap(([name, v], i) => [
      T(0, i, name.padEnd(10), { fg: 'foreground' }),
      T(10, i, hbar(v, 18), { fg: v > 0.75 ? 'red' : 'green' }),
      T(29, i, String(Math.round(v * 100)).padStart(3) + '%', { fg: 'muted' }),
    ]);
  } },
  { name: 'Braille line chart', category: 'Charts', build: () => [
    makeBox(0, 0, 34, 7, { border: 'rounded', title: 'requests/s', fg: 'muted' }),
    T(1, 1, braillePlot(t => 0.5 + 0.4 * Math.sin(t * Math.PI * 3) * (0.4 + t * 0.6), 32, 5), { fg: 'green', transparent: true }),
  ] },

  // ── Layout ──
  { name: 'Panel with title', category: 'Layout', build: () => [
    makeBox(0, 0, 40, 10, { border: 'rounded', title: 'Panel', fg: 'foreground', borderFg: 'accent' }),
  ] },
  { name: 'Table', category: 'Layout', build: () => [
    makeTable(0, 0, 3, 4, {
      colWidths: [12, 11, 7], aligns: ['left', 'left', 'right'], borderFg: 'muted', headerFg: 'accent',
      cells: [['NAME', 'STATUS', 'CPU'], ['nginx', 'running', '12%'], ['postgres', 'running', '4%'], ['backup', 'stopped', '0%']],
    }),
  ] },
  { name: 'Dialog', category: 'Layout', build: () => [
    makeBox(0, 0, 40, 9, { border: 'double', title: 'Confirm', titleAlign: 'center', fg: 'foreground', borderFg: 'red', bg: 'lighter_background' }),
    T(2, 2, 'Delete 3 files?\nThis cannot be undone.', { bg: 'lighter_background' }),
    ...row(16, 6, [[' Cancel ', { fg: 'foreground', bg: 'selection' }], ['  ', { bg: 'lighter_background' }], [' Delete ', { fg: 'background', bg: 'red', attrs: bold }]]),
  ] },
  { name: 'Sidebar + main', category: 'Layout', build: () => [
    makeBox(0, 0, 60, 16, { border: 'rounded', title: 'app', fg: 'foreground', borderFg: 'muted' }),
    makeLine(18, 0, 18, 15, { end: 'none', fg: 'muted', route: 'vh' }),
    makeLine(0, 13, 59, 13, { end: 'none', fg: 'muted' }),
    T(2, 2, 'Dashboard\nProjects\nSettings', { fg: 'foreground' }),
    T(20, 2, 'Main content', { fg: 'accent', attrs: bold }),
    T(2, 14, 'q quit  ? help', { fg: 'muted' }),
  ] },
  { name: 'Tree view', category: 'Layout', build: () => [
    T(0, 0, '▾ src\n  ├─ main.js\n  ├─ render.js\n  └─ ui\n     └─ panels.js', { transparent: true }),
  ] },
  { name: 'Section divider', category: 'Layout', build: () => [
    makeLine(0, 0, 31, 0, { end: 'none', fg: 'muted' }),
    T(3, 0, ' Section ', { fg: 'accent', attrs: bold }),
  ] },

  // ── Art ──
  { name: 'OTIS logo', category: 'Art', build: () => [T(0, 0, LOGO, { fg: 'accent', transparent: true })] },
  { name: 'Shade ramp', category: 'Art', build: () => [T(0, 0, '░░▒▒▓▓██▓▓▒▒░░', { fg: 'accent' })] },
];

// Normalize to { id, name, category, w, h, objects } with objects at 0,0.
export function snippetFromObjects(name, category, objects, id = null) {
  const b = unionBounds(objects.map(bounds));
  objects.forEach(o => translate(o, -b.x, -b.y));
  return { id: id || 'snip-' + Math.random().toString(36).slice(2, 8), name, category, w: b.w, h: b.h, objects };
}

export const BUILTIN_SNIPPETS = DEFS.map((d, i) =>
  snippetFromObjects(d.name, d.category, d.build(), 'builtin-' + i));

// A small dashboard to open on first run.
export function sampleProject(font) {
  const p = makeProject({ name: 'Welcome to OTIS', cols: 100, rows: 30 });
  if (font) p.font.family = font;
  const base = p.layers[0];
  base.name = 'Layout';
  const ui = makeLayer('Widgets');
  p.layers.push(ui);
  // place a built-in snippet (grouped, so it moves as one) or loose objects
  const get = name => {
    const objs = structuredClone(BUILTIN_SNIPPETS.find(s => s.name === name).objects);
    return objs.length > 1 ? [makeGroup(objs, { name })] : objs.map(o => Object.assign(o, { name }));
  };
  const place = (layer, objs, x, y) => { objs.forEach(o => { translate(o, x, y); layer.objects.push(o); }); };

  place(base, [makeBox(0, 0, 100, 30, { border: 'rounded', title: 'Welcome to OTIS', fg: 'accent', borderFg: 'muted' })], 0, 0);
  place(base, [makeLine(24, 0, 24, 27, { end: 'none', route: 'vh', fg: 'muted' })], 0, 0);
  place(base, [makeLine(0, 27, 99, 27, { end: 'none', fg: 'muted' })], 0, 0);
  place(ui, get('OTIS logo'), 47, 2);
  place(ui, get('Menu list'), 2, 2);
  place(ui, [T(2, 7, 'Try it:\n\nB  draw a box\nT  add text\nA  draw an arrow\nP  pencil\nV  select & move\n\nDouble-click text\nto edit it.', { fg: 'muted' })], 0, 0);
  place(ui, get('Horizontal bars'), 27, 10);
  place(ui, get('Braille line chart'), 63, 9);
  place(ui, get('Progress bar (smooth)'), 27, 16);
  place(ui, get('Sparkline'), 27, 18);
  place(ui, get('Tabs'), 63, 18);
  place(ui, get('Checkbox list'), 63, 21);
  place(ui, get('Status line (powerline)'), 2, 28);
  place(ui, get('Key hints'), 60, 28);
  const popup = makeLayer('Popup (hidden)');
  popup.visible = false;
  p.layers.push(popup);
  place(popup, get('Dialog'), 30, 10);
  return p;
}
