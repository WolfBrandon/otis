// TextArt: big letters from text. FIGlet fonts (public/fonts/figlet, BSD
// licensed) plus two block fonts drawn from a small pixel alphabet here.
// Pure, no DOM: the browser and the MCP server pass in a function that loads
// a .flf file by name.

// Each font comes in up to three sizes; a FIGlet font has a fixed height, so
// the sizes are its small/normal/big versions where FIGlet has them.
export const TEXTART_FONTS = [
  { id: 'blocks-3d', name: 'Blocks 3D', sizes: { s: 'px:3d:1', m: 'px:3d:2', l: 'px:3d:4' } },
  { id: 'blocks', name: 'Blocks', sizes: { s: 'px:half:1', m: 'px:solid:2', l: 'px:solid:4' } },
  { id: 'standard', name: 'Standard', sizes: { s: 'small', m: 'standard', l: 'big' } },
  { id: 'slant', name: 'Slant', sizes: { s: 'smslant', m: 'slant' } },
  { id: 'shadow', name: 'Shadow', sizes: { s: 'smshadow', m: 'shadow' } },
  { id: 'script', name: 'Script', sizes: { s: 'smscript', m: 'script' } },
  { id: 'lean', name: 'Lean', sizes: { m: 'lean' } },
  { id: 'block', name: 'Block lines', sizes: { m: 'block' } },
  { id: 'bubble', name: 'Bubble', sizes: { m: 'bubble' } },
  { id: 'digital', name: 'Digital', sizes: { m: 'digital' } },
  { id: 'mini', name: 'Mini', sizes: { m: 'mini' } },
];
export const TEXTART_SIZES = [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']];

// The size a font actually has: the one asked for, else the nearest.
export function fitSize(fontId, size) {
  const f = TEXTART_FONTS.find(f => f.id === fontId) || TEXTART_FONTS[0];
  if (f.sizes[size]) return size;
  return ['m', 's', 'l'].find(s => f.sizes[s]);
}

// Text → the art as a string of lines (trailing spaces trimmed).
// `load(name)` resolves to the text of fonts/figlet/<name>.flf.
export async function renderTextArt(text, fontId, size, load) {
  const f = TEXTART_FONTS.find(f => f.id === fontId) || TEXTART_FONTS[0];
  const src = f.sizes[fitSize(f.id, size)];
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  let blocks;
  if (src.startsWith('px:')) {
    const [, style, scale] = src.split(':');
    // a blank row between lines of text, so the letters don't touch
    blocks = lines.map((l, n) => [...(n ? [''] : []), ...pixelText(l, style, +scale)]);
  } else {
    const font = await loadFont(src, load);
    blocks = lines.map(l => figletLine(font, l));
  }
  return blocks.flat().map(r => r.replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');
}

// ── FIGlet ───────────────────────────────────────────────────────────────────
// The FIGfont format and its layout rules: http://www.jave.de/figlet/figfont.html

const fonts = new Map();
function loadFont(name, load) {
  if (!fonts.has(name)) fonts.set(name, Promise.resolve(load(name)).then(parseFlf).catch(e => { fonts.delete(name); throw e; }));
  return fonts.get(name);
}

const SM = { equal: 1, lowline: 2, hierarchy: 4, pair: 8, bigx: 16, hardblank: 32, kern: 64, smush: 128 };

export function parseFlf(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const head = lines[0].match(/^flf2a(.)\s+(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\d+)(?:\s+(\d+))?(?:\s+(\d+))?/);
  if (!head) throw new Error('Not a FIGlet font');
  const [, hardblank, height, , , oldLayout, comments, , fullLayout] = head;
  const h = +height;
  // fullLayout's low byte is the horizontal layout; old fonts only have oldLayout
  let mode;
  if (fullLayout != null) mode = +fullLayout & 255;
  else mode = +oldLayout === 0 ? SM.kern : +oldLayout < 0 ? 0 : (+oldLayout & 31) | SM.smush;

  const chars = new Map();
  let i = 1 + +comments;
  const readChar = () => {
    const rows = [];
    for (let r = 0; r < h; r++) {
      // drop trailing spaces, then the endmark (and its repeats)
      const line = (lines[i++] ?? '').replace(/\s+$/, '');
      let k = line.length - 1;
      while (k >= 0 && line[k] === line[line.length - 1]) k--;
      rows.push(line.slice(0, k + 1));
    }
    return rows;
  };
  // ASCII 32–126, then the seven German letters, then code-tagged extras
  const required = [...Array.from({ length: 95 }, (_, k) => 32 + k), 196, 214, 220, 228, 246, 252, 223];
  for (const code of required) {
    if (i >= lines.length) break;
    chars.set(code, readChar());
  }
  while (i < lines.length) {
    const m = lines[i].match(/^\s*(-?(?:0x[\da-f]+|0[0-7]*|\d+))/i);
    if (!m) { i++; continue; }
    i++;
    const code = m[1].startsWith('-') ? -1 : Number(m[1].startsWith('0') && !/^0x/i.test(m[1]) && m[1].length > 1 ? parseInt(m[1], 8) : m[1]);
    const rows = readChar();
    if (code >= 0) chars.set(code, rows);
  }
  return { hardblank, height: h, mode, chars };
}

// One FIGcharacter boundary: what lch and rch become when overlapped, or null.
function smushem(font, lch, rch, prevW, curW) {
  if (lch === ' ') return rch;
  if (rch === ' ') return lch;
  if (prevW < 2 || curW < 2) return null;
  const m = font.mode, hb = font.hardblank;
  if (!(m & SM.smush)) return null;
  if (!(m & 63)) {                       // universal smushing
    if (lch === hb) return rch;
    if (rch === hb) return lch;
    return rch;
  }
  if (m & SM.hardblank && lch === hb && rch === hb) return lch;
  if (lch === hb || rch === hb) return null;
  if (m & SM.equal && lch === rch) return lch;
  if (m & SM.lowline) {
    if (lch === '_' && '|/\\[]{}()<>'.includes(rch)) return rch;
    if (rch === '_' && '|/\\[]{}()<>'.includes(lch)) return lch;
  }
  if (m & SM.hierarchy) {
    const classes = ['|', '/\\', '[]', '{}', '()', '<>'];
    const cl = classes.findIndex(c => c.includes(lch)), cr = classes.findIndex(c => c.includes(rch));
    if (cl >= 0 && cr >= 0 && cl !== cr) return cl > cr ? lch : rch;
  }
  if (m & SM.pair) {
    const p = lch + rch;
    if (['[]', '][', '{}', '}{', '()', ')('].includes(p)) return '|';
  }
  if (m & SM.bigx) {
    if (lch === '/' && rch === '\\') return '|';
    if (lch === '\\' && rch === '/') return 'Y';
    if (lch === '>' && rch === '<') return 'X';
  }
  return null;
}

// How many columns the next character can slide into the line (FIGlet's smushamt).
function overlap(font, out, ch, prevW) {
  if (!(font.mode & (SM.smush | SM.kern))) return 0;
  const len = out[0].length, curW = ch[0].length;
  let max = curW;
  for (let r = 0; r < font.height; r++) {
    const line = out[r], row = ch[r];
    let lb = len;   // from the end of the line back to its last visible character
    while (lb > 0 && (line[lb] == null || line[lb] === ' ')) lb--;
    let cb = 0;
    while (cb < row.length && row[cb] === ' ') cb++;
    const c1 = line[lb], c2 = row[cb];
    let amt = cb + len - 1 - lb;
    if (c1 == null || c1 === ' ') amt++;
    else if (c2 != null && smushem(font, c1, c2, prevW, curW) != null) amt++;
    if (amt < max) max = amt;
  }
  return max;
}

function figletLine(font, text) {
  const out = Array.from({ length: font.height }, () => '');
  let prevW = 0;
  for (const c of Array.from(text)) {
    const ch = font.chars.get(c.codePointAt(0)) || font.chars.get(0);
    if (!ch) continue;
    const curW = ch[0].length;
    const amt = overlap(font, out, ch, prevW);
    for (let r = 0; r < font.height; r++) {
      const line = Array.from(out[r]);
      for (let k = 0; k < amt; k++) {
        const col = line.length - amt + k;
        if (col >= 0) line[col] = smushem(font, line[col], ch[r][k] ?? ' ', prevW, curW) ?? line[col];
      }
      out[r] = line.join('') + ch[r].slice(amt);
    }
    prevW = curW;
  }
  return out.map(l => l.split(font.hardblank).join(' '));
}

// ── Pixel fonts ──────────────────────────────────────────────────────────────
// A 5-pixel-high alphabet (lower case draws as upper case). '#' is a pixel.

const PIXELS = {
  A: '.##.|#..#|####|#..#|#..#', B: '###.|#..#|###.|#..#|###.', C: '.###|#...|#...|#...|.###',
  D: '###.|#..#|#..#|#..#|###.', E: '####|#...|###.|#...|####', F: '####|#...|###.|#...|#...',
  G: '.###|#...|#.##|#..#|.###', H: '#..#|#..#|####|#..#|#..#', I: '###|.#.|.#.|.#.|###',
  J: '...#|...#|...#|#..#|.##.', K: '#..#|#.#.|##..|#.#.|#..#', L: '#...|#...|#...|#...|####',
  M: '#...#|##.##|#.#.#|#...#|#...#', N: '#...#|##..#|#.#.#|#..##|#...#', O: '.##.|#..#|#..#|#..#|.##.',
  P: '###.|#..#|###.|#...|#...', Q: '.##.|#..#|#..#|#.##|.###', R: '###.|#..#|###.|#.#.|#..#',
  S: '.###|#...|.##.|...#|###.', T: '#####|..#..|..#..|..#..|..#..', U: '#..#|#..#|#..#|#..#|.##.',
  V: '#...#|#...#|#...#|.#.#.|..#..', W: '#...#|#...#|#.#.#|##.##|#...#', X: '#...#|.#.#.|..#..|.#.#.|#...#',
  Y: '#...#|.#.#.|..#..|..#..|..#..', Z: '#####|...#.|..#..|.#...|#####',
  0: '.###.|#..##|#.#.#|##..#|.###.', 1: '.#.|##.|.#.|.#.|###', 2: '###.|...#|.##.|#...|####',
  3: '###.|...#|.##.|...#|###.', 4: '#..#|#..#|####|...#|...#', 5: '####|#...|###.|...#|###.',
  6: '.##.|#...|###.|#..#|.##.', 7: '####|...#|..#.|.#..|.#..', 8: '.##.|#..#|.##.|#..#|.##.',
  9: '.##.|#..#|.###|...#|.##.',
  ' ': '..|..|..|..|..', '!': '#|#|#|.|#', '?': '###.|...#|.##.|....|.#..', '.': '.|.|.|.|#', ',': '..|..|..|.#|#.',
  ':': '.|#|.|#|.', ';': '..|.#|..|.#|#.', '-': '...|...|###|...|...', _: '....|....|....|....|####',
  '+': '...|.#.|###|.#.|...', '=': '...|###|...|###|...', '/': '....#|...#.|..#..|.#...|#....',
  '\\': '#....|.#...|..#..|...#.|....#', '(': '.#|#.|#.|#.|.#', ')': '#.|.#|.#|.#|#.', '[': '##|#.|#.|#.|##',
  ']': '##|.#|.#|.#|##', "'": '#|#|.|.|.', '"': '#.#|#.#|...|...|...', '#': '.#.#.|#####|.#.#.|#####|.#.#.',
  '%': '#...#|...#.|..#..|.#...|#...#', '&': '.##..|#..#.|.##.#|#..#.|.##.#', '*': '.....|#.#.#|.###.|#.#.#|.....',
  '<': '..#|.#.|#..|.#.|..#', '>': '#..|.#.|..#|.#.|#..', '@': '.###.|#...#|#.###|#.##.|.###.', '^': '.#.|#.#|...|...|...',
  '`': '#.|.#|..|..|..', '{': '.##|.#.|##.|.#.|.##', '}': '##.|.#.|.##|.#.|##.', '|': '#|#|#|#|#',
  '~': '.....|.#...|#.#.#|...#.|.....', $: '.####|#.#..|.###.|..#.#|####.',
};
const PX_H = 5;

// The text as a pixel grid (rows of booleans), one blank column between letters.
function pixelGrid(text) {
  const rows = Array.from({ length: PX_H }, () => []);
  let first = true;
  for (const c of Array.from(text)) {
    const g = PIXELS[c.toUpperCase()] ?? PIXELS['?'];
    const lines = g.split('|');
    rows.forEach((row, r) => { if (!first) row.push(false); row.push(...Array.from(lines[r], p => p === '#')); });
    first = false;
  }
  return rows;
}

// Scale a pixel grid: each pixel becomes sx columns by sy rows of cells.
const scaleGrid = (g, sx, sy) => g.flatMap(row => Array(sy).fill(row.flatMap(p => Array(sx).fill(p))));

// Box-drawing double lines by the directions they connect.
const DOUBLE = { ew: '═', ns: '║', es: '╔', sw: '╗', ne: '╚', nw: '╝', esw: '╦', new: '╩', nes: '╠', nsw: '╣', nesw: '╬', e: '═', w: '═', n: '║', s: '║' };

function pixelText(text, style, scale) {
  if (!text) return [''];
  const g = pixelGrid(text);
  if (style === 'half') {
    // two pixel rows per cell: ▀ ▄ █
    const out = [];
    for (let r = 0; r < g.length; r += 2) {
      out.push(g[r].map((top, c) => { const bot = g[r + 1]?.[c]; return top && bot ? '█' : top ? '▀' : bot ? '▄' : ' '; }).join(''));
    }
    return out;
  }
  // cells are about twice as tall as wide, so a square pixel is 2 cells wide
  const cells = scaleGrid(g, scale, Math.max(1, scale / 2));
  if (style === 'solid') return cells.map(row => row.map(p => (p ? '█' : ' ')).join(''));
  // 3d: the outline of the shape, half a cell down and right, drawn behind it
  // in double lines (the "ANSI Shadow" look)
  const H = cells.length + 1, W = cells[0].length + 1;
  const on = (r, c) => !!cells[r]?.[c];
  const dirs = Array.from({ length: H }, () => Array.from({ length: W }, () => new Set()));
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (on(r - 1, c) !== on(r, c)) { dirs[r][c].add('e'); if (c + 1 < W) dirs[r][c + 1].add('w'); }
      if (on(r, c - 1) !== on(r, c)) { dirs[r][c].add('s'); if (r + 1 < H) dirs[r + 1][c].add('n'); }
    }
  }
  const step = { n: [-1, 0], e: [0, 1], s: [1, 0], w: [0, -1] };
  return dirs.map((row, r) => row.map((d, c) => {
    if (on(r, c)) return '█';
    // where two letters' corners touch, keep only the lines that show
    if (d.size > 2) for (const x of [...d]) if (d.size > 2 && on(r + step[x][0], c + step[x][1])) d.delete(x);
    const key = ['n', 'e', 's', 'w'].filter(x => d.has(x)).join('');
    return DOUBLE[key] || ' ';
  }).join(''));
}
