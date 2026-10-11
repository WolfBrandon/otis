// Exporters: plain text, Markdown and ANSI. Pure, no DOM.
// PNG export lives in render.js because it needs a canvas.

import { resolveColor, ANSI_SLOTS } from './palette.js';
import { ATTR } from './composite.js';

// Bounding box of cells that show something.
export function contentRect(grid) {
  let x1 = Infinity, y1 = Infinity, x2 = -1, y2 = -1;
  for (const i of grid.touched) {
    if ((grid.ch[i] ?? ' ') === ' ' && grid.bg[i] == null) continue;
    const x = i % grid.cols, y = Math.floor(i / grid.cols);
    if (x < x1) x1 = x; if (x > x2) x2 = x;
    if (y < y1) y1 = y; if (y > y2) y2 = y;
  }
  if (x2 < 0) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
}

function area(grid, crop) {
  return crop ? contentRect(grid) : { x: 0, y: 0, w: grid.cols, h: grid.rows };
}

export function toText(grid, { trim = true, crop = false } = {}) {
  const a = area(grid, crop);
  const lines = [];
  for (let r = a.y; r < a.y + a.h; r++) {
    let s = '';
    for (let c = a.x; c < a.x + a.w; c++) s += grid.ch[r * grid.cols + c] ?? ' ';
    lines.push(trim ? s.replace(/ +$/, '') : s);
  }
  return lines.join('\n');
}

// `tabs` ([{ name, grid }]) exports several tabs, each under its own heading.
export function toMarkdown(project, grid, { heading = true, embed = false, trim = true, crop = false, tabs = null } = {}) {
  const block = g => {
    const text = toText(g, { trim, crop });
    const ticks = Math.max(0, ...(text.match(/`+/g) || []).map(m => m.length));
    const fence = '`'.repeat(Math.max(3, ticks + 1));
    return `${fence}text\n${text}\n${fence}\n`;
  };
  let md = heading ? `# ${project.name || 'Untitled'}\n\n` : '';
  md += tabs ? tabs.map(t => `## ${t.name}\n\n${block(t.grid)}`).join('\n') : block(grid);
  if (embed) {
    // "-->" can only occur inside JSON strings, where > is an equivalent escape.
    const json = JSON.stringify(project).replace(/-->/g, '--\\u003e');
    md += `\n<!-- otis-project\n${json}\n-->\n`;
  }
  return md;
}

export function projectFromMarkdown(md) {
  const m = md.match(/<!-- otis-project\r?\n([\s\S]*?)\r?\n-->/);
  return m ? JSON.parse(m[1]) : null;
}

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(';');

// ANSI escape output.
//   mode 'theme':     palette slots that are terminal colors become the 16 ANSI
//                     colors, so the art follows the terminal's theme.
//   mode 'truecolor': every color resolved to 24-bit, so it looks exactly like OTIS.
export function toAnsi(grid, project, { mode = 'theme', crop = false } = {}) {
  const pal = project.palette;
  const truecolor = mode === 'truecolor';

  const code = (ref, isBg) => {
    if (ref == null) {
      if (!truecolor) return null;
      ref = isBg ? project.background : project.foreground;
    }
    if (!truecolor && !String(ref).startsWith('#')) {
      if (ref === (isBg ? 'background' : 'foreground')) return null;
      const idx = ANSI_SLOTS.indexOf(ref);
      if (idx >= 0) return String((isBg ? 40 : 30) + (idx < 8 ? idx : 60 + idx - 8));
    }
    const hex = resolveColor(ref, pal);
    if (!hex) return null;
    return `${isBg ? 48 : 38};2;${rgb(hex)}`;
  };

  const style = i => {
    const a = grid.attr[i];
    const parts = ['0'];
    if (a & ATTR.bold) parts.push('1');
    if (a & ATTR.dim) parts.push('2');
    if (a & ATTR.italic) parts.push('3');
    if (a & ATTR.underline) parts.push('4');
    if (a & ATTR.blink) parts.push('5');
    if (a & ATTR.strike) parts.push('9');
    const fg = code(grid.fg[i], false), bg = code(grid.bg[i], true);
    if (fg) parts.push(fg);
    if (bg) parts.push(bg);
    return parts.join(';');
  };

  const a = area(grid, crop);
  const out = [];
  for (let r = a.y; r < a.y + a.h; r++) {
    // in theme mode, stop at the last cell that shows anything
    let end = a.x + a.w;
    if (!truecolor) {
      while (end > a.x) {
        const i = r * grid.cols + end - 1;
        if ((grid.ch[i] ?? ' ') !== ' ' || grid.bg[i] != null) break;
        end--;
      }
    }
    let line = '', cur = '0';   // each line starts from a reset
    for (let c = a.x; c < end; c++) {
      const i = r * grid.cols + c;
      const s = style(i);
      if (s !== cur) { line += `\x1b[${s}m`; cur = s; }
      line += grid.ch[i] ?? ' ';
    }
    out.push(cur !== '0' ? line + '\x1b[0m' : line);
  }
  return out.join('\n') + '\n';
}
