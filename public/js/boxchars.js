// Box-drawing glyph logic for OTIS.
//
// - ARMS: which way each box-drawing character's lines point, and how heavy.
// - mergeBox: combine two box characters that land in the same cell (─ + │ → ┼).
// - drawGlyph: draw box lines, block elements, braille and powerline shapes
//   with fillRect/paths instead of the font, so neighbouring cells always join
//   up seamlessly (the same trick terminals like Ghostty and Kitty use).
//
// No DOM access at import time, so this module also runs under Node for tests.

// Arm weights, in the order [north, east, south, west].
const NONE = 0, LIGHT = 1, HEAVY = 2, DOUBLE = 3;

// Generated offline from Unicode names (U+2500–U+257F, minus the diagonals
// ╱╲╳ which have no arms). Each record is a char followed by its n/e/s/w
// weights.
const ARMS_TABLE =
  '─0101━0202│1010┃2020┄0101┅0202┆1010┇2020┈0101┉0202┊1010┋2020┌0110┍0210┎0120┏0220' +
  '┐0011┑0012┒0021┓0022└1100┕1200┖2100┗2200┘1001┙1002┚2001┛2002├1110┝1210┞2110┟1120' +
  '┠2120┡2210┢1220┣2220┤1011┥1012┦2011┧1021┨2021┩2012┪1022┫2022┬0111┭0112┮0211┯0212' +
  '┰0121┱0122┲0221┳0222┴1101┵1102┶1201┷1202┸2101┹2102┺2201┻2202┼1111┽1112┾1211┿1212' +
  '╀2111╁1121╂2121╃2112╄2211╅1122╆1221╇2212╈1222╉2122╊2221╋2222╌0101╍0202╎1010╏2020' +
  '═0303║3030╒0310╓0130╔0330╕0013╖0031╗0033╘1300╙3100╚3300╛1003╜3001╝3003╞1310╟3130' +
  '╠3330╡1013╢3031╣3033╤0313╥0131╦0333╧1303╨3101╩3303╪1313╫3131╬3333╭0110╮0011╯1001' +
  '╰1100╴0001╵1000╶0100╷0010╸0002╹2000╺0200╻0020╼0201╽1020╾0102╿2010';

export const ARMS = new Map();
for (let i = 0; i < ARMS_TABLE.length; i += 5) {
  ARMS.set(ARMS_TABLE[i], [...ARMS_TABLE.slice(i + 1, i + 5)].map(Number));
}

export const ARC = new Set(['╭', '╮', '╯', '╰']);

// Dashed chars, with how many dashes each one has per cell.
const DASH_COUNT = new Map([
  ['╌', 2], ['╍', 2], ['╎', 2], ['╏', 2],
  ['┄', 3], ['┅', 3], ['┆', 3], ['┇', 3],
  ['┈', 4], ['┉', 4], ['┊', 4], ['┋', 4],
]);
export const DASHED = new Set(DASH_COUNT.keys());

// Reverse lookup "nesw" → char. Plain solid chars win over dashed/arc twins.
const BY_ARMS = new Map();
for (const [ch, arms] of ARMS) {
  if (ARC.has(ch) || DASHED.has(ch)) continue;
  const key = arms.join('');
  if (!BY_ARMS.has(key)) BY_ARMS.set(key, ch);
}

export function isBoxChar(ch) {
  return ARMS.has(ch);
}

export function charForArms(n, e, s, w) {
  return BY_ARMS.get(`${n}${e}${s}${w}`) ?? null;
}

const sameArms = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

// A pure corner: exactly two arms, at right angles.
const isCorner = (a) => {
  const on = a.map((x) => x > 0);
  return on.filter(Boolean).length === 2 && on[0] !== on[2];
};

const ASCII_LINE = new Set(['-', '|', '+']);

// Combine `above` drawn on top of `below` in the same cell.
export function mergeBox(below, above) {
  if (below === above) return above;
  const a = ARMS.get(above), b = ARMS.get(below);
  if (!a || !b) {
    if (ASCII_LINE.has(above) && ASCII_LINE.has(below)) return '+';
    return above;
  }

  // Union of arms; above's weight wins where both have an arm.
  const u = a.map((wt, i) => wt || b[i]);

  // Rounded corners stay rounded if the shape didn't change.
  if (isCorner(u) && u.every((wt) => wt <= LIGHT)) {
    if (ARC.has(above) && sameArms(a, u)) return above;
    if (ARC.has(below) && sameArms(b, u)) return below;
  }
  // Shape unchanged: keep whichever char already had it (keeps dashes).
  if (sameArms(u, a)) return above;
  if (sameArms(u, b)) return below;

  let ch = charForArms(...u);
  if (ch) return ch;

  // No such Unicode char (e.g. heavy mixed with double). Unify heavy/double
  // to above's dominant weight, then try everything light.
  const heavyOrDouble = (arr) => arr.filter((wt) => wt === HEAVY || wt === DOUBLE);
  const pick = (arr) => {
    const h = arr.filter((wt) => wt === HEAVY).length;
    const d = arr.filter((wt) => wt === DOUBLE).length;
    if (!h && !d) return 0;
    return d >= h ? DOUBLE : HEAVY;
  };
  const dom = pick(heavyOrDouble(a)) || pick(heavyOrDouble(u));
  if (dom) {
    ch = charForArms(...u.map((wt) => (wt === HEAVY || wt === DOUBLE ? dom : wt)));
    if (ch) return ch;
  }
  ch = charForArms(...u.map((wt) => (wt ? LIGHT : NONE)));
  return ch ?? above;
}

// ---------------------------------------------------------------------------
// Procedural drawing

// Draw `ch` into the device-pixel cell (x, y, w, h) with ctx.fillStyle.
// Returns false when the char isn't one we draw, so the caller uses the font.
export function drawGlyph(ctx, ch, x, y, w, h) {
  if (!ch) return false;
  const cp = ch.codePointAt(0);

  if (ARMS.has(ch)) {
    if (ARC.has(ch)) drawArc(ctx, ARMS.get(ch), x, y, w, h);
    else if (DASHED.has(ch)) drawDashed(ctx, ch, x, y, w, h);
    else drawLines(ctx, ARMS.get(ch), x, y, w, h);
    return true;
  }
  if (cp >= 0x2571 && cp <= 0x2573) return drawDiagonal(ctx, cp, x, y, w, h);
  if (cp >= 0x2580 && cp <= 0x259f) return drawBlock(ctx, cp, x, y, w, h);
  if (cp >= 0x2800 && cp <= 0x28ff) return drawBraille(ctx, cp - 0x2800, x, y, w, h);
  if (cp >= 0xe0b0 && cp <= 0xe0b7) return drawPowerline(ctx, cp, x, y, w, h);
  return false;
}

const lightWidth = (w) => Math.max(1, Math.round(w / 8));

function rect(ctx, x0, y0, x1, y1) {
  if (x1 > x0 && y1 > y0) ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

// Straight lines and junctions, including double lines.
function drawLines(ctx, [n, e, s, wa], x, y, w, h) {
  const lt = lightWidth(w);
  const thick = (wt) => (wt === HEAVY ? 2 * lt : wt ? lt : 0);
  const single = (wt) => wt === LIGHT || wt === HEAVY;
  // Left/top edge of a stroke of thickness t centred in the cell.
  const cx = (t) => x + Math.floor((w - t) / 2);
  const cy = (t) => y + Math.floor((h - t) / 2);
  // Double lines: two light strokes with a light-width gap between them.
  const dx1 = cx(3 * lt), dx2 = dx1 + 2 * lt; // the two vertical strokes
  const dy1 = cy(3 * lt), dy2 = dy1 + 2 * lt; // the two horizontal strokes
  const hDouble = e === DOUBLE || wa === DOUBLE;
  const vDouble = n === DOUBLE || s === DOUBLE;
  const maxH = Math.max(single(e) ? thick(e) : 0, single(wa) ? thick(wa) : 0);
  const maxV = Math.max(single(n) ? thick(n) : 0, single(s) ? thick(s) : 0);

  // --- light/heavy arms ---
  if (single(n)) {
    const t = thick(n), X = cx(t);
    let end;
    if (single(s)) { const T = Math.max(t, thick(s)); end = cy(T) + T; }
    else if (hDouble) end = (e === DOUBLE && wa === DOUBLE ? dy1 : dy2) + lt;
    else if (maxH) end = cy(maxH) + maxH;
    else end = cy(t) + t;
    rect(ctx, X, y, X + t, end);
  }
  if (single(s)) {
    const t = thick(s), X = cx(t);
    let start;
    if (single(n)) start = cy(Math.max(t, thick(n)));
    else if (hDouble) start = e === DOUBLE && wa === DOUBLE ? dy2 : dy1;
    else if (maxH) start = cy(maxH);
    else start = cy(t);
    rect(ctx, X, start, X + t, y + h);
  }
  if (single(wa)) {
    const t = thick(wa), Y = cy(t);
    let end;
    if (single(e)) { const T = Math.max(t, thick(e)); end = cx(T) + T; }
    else if (vDouble) end = (n === DOUBLE && s === DOUBLE ? dx1 : dx2) + lt;
    else if (maxV) end = cx(maxV) + maxV;
    else end = cx(t) + t;
    rect(ctx, x, Y, end, Y + t);
  }
  if (single(e)) {
    const t = thick(e), Y = cy(t);
    let start;
    if (single(wa)) start = cx(Math.max(t, thick(wa)));
    else if (vDouble) start = n === DOUBLE && s === DOUBLE ? dx2 : dx1;
    else if (maxV) start = cx(maxV);
    else start = cx(t);
    rect(ctx, start, Y, x + w, Y + t);
  }

  // --- double arms ---
  // Each double arm is two strokes. Where a stroke stops depends on whether
  // the double arm on its own side (outer corner) or the opposite side
  // (inner corner) exists, so ╔═╦═╗ / ╠═╬═╣ grids join correctly.
  if (wa === DOUBLE || e === DOUBLE) {
    for (const [Y, side, opp] of [[dy1, n, s], [dy2, s, n]]) {
      if (wa === DOUBLE) {
        let end;
        if (side === DOUBLE) end = dx1 + lt;
        else if (opp === DOUBLE) end = dx2 + lt;
        else if (maxV) end = cx(maxV) + maxV;
        else end = e === DOUBLE ? x + w : cx(lt) + lt;
        rect(ctx, x, Y, end, Y + lt);
      }
      if (e === DOUBLE) {
        let start;
        if (side === DOUBLE) start = dx2;
        else if (opp === DOUBLE) start = dx1;
        else if (maxV) start = cx(maxV);
        else start = wa === DOUBLE ? x : cx(lt);
        rect(ctx, start, Y, x + w, Y + lt);
      }
    }
  }
  if (n === DOUBLE || s === DOUBLE) {
    for (const [X, side, opp] of [[dx1, wa, e], [dx2, e, wa]]) {
      if (n === DOUBLE) {
        let end;
        if (side === DOUBLE) end = dy1 + lt;
        else if (opp === DOUBLE) end = dy2 + lt;
        else if (maxH) end = cy(maxH) + maxH;
        else end = s === DOUBLE ? y + h : cy(lt) + lt;
        rect(ctx, X, y, X + lt, end);
      }
      if (s === DOUBLE) {
        let start;
        if (side === DOUBLE) start = dy2;
        else if (opp === DOUBLE) start = dy1;
        else if (maxH) start = cy(maxH);
        else start = n === DOUBLE ? y : cy(lt);
        rect(ctx, X, start, X + lt, y + h);
      }
    }
  }
}

// Stroke a path with the current fill color.
function strokeWith(ctx, width, path) {
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  path();
  ctx.stroke();
  ctx.restore();
}

// Rounded corners ╭╮╯╰: a quarter circle joining the two edge midpoints.
function drawArc(ctx, [n, e, s], x, y, w, h) {
  const lt = lightWidth(w);
  const xc = x + Math.floor((w - lt) / 2) + lt / 2; // centre of the stroke
  const yc = y + Math.floor((h - lt) / 2) + lt / 2;
  const hx = e ? x + w : x;           // where the horizontal arm meets the edge
  const vy = s ? y + h : y;           // where the vertical arm meets the edge
  const r = Math.min(Math.abs(hx - xc), Math.abs(vy - yc));
  strokeWith(ctx, lt, () => {
    ctx.moveTo(hx, yc);
    ctx.arcTo(xc, yc, xc, vy, r);
    ctx.lineTo(xc, vy);
  });
}

// Dashed lines: the cell is split into equal segments with a dash centred in
// each, so dashes keep an even rhythm across neighbouring cells.
function drawDashed(ctx, ch, x, y, w, h) {
  const [n, e] = ARMS.get(ch);
  const count = DASH_COUNT.get(ch);
  const lt = lightWidth(w);
  const horizontal = e > 0;
  const t = (horizontal ? e : n) === HEAVY ? 2 * lt : lt;
  const len = horizontal ? w : h;
  for (let i = 0; i < count; i++) {
    const a = Math.round((i * len) / count), b = Math.round(((i + 1) * len) / count);
    const gap = Math.max(1, Math.round((b - a) / 3));
    const d0 = a + Math.floor(gap / 2), d1 = b - Math.ceil(gap / 2);
    if (horizontal) {
      const Y = y + Math.floor((h - t) / 2);
      rect(ctx, x + d0, Y, x + d1, Y + t);
    } else {
      const X = x + Math.floor((w - t) / 2);
      rect(ctx, X, y + d0, X + t, y + d1);
    }
  }
}

// ╱ ╲ ╳
function drawDiagonal(ctx, cp, x, y, w, h) {
  strokeWith(ctx, lightWidth(w), () => {
    if (cp !== 0x2572) { ctx.moveTo(x + w, y); ctx.lineTo(x, y + h); } // ╱
    if (cp !== 0x2571) { ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); } // ╲
  });
  return true;
}

// Block elements U+2580–U+259F.
function drawBlock(ctx, cp, x, y, w, h) {
  const fromTop = (k) => y + Math.round((h * k) / 8);
  const fromLeft = (k) => x + Math.round((w * k) / 8);
  const mx = x + Math.round(w / 2), my = y + Math.round(h / 2);

  if (cp === 0x2580) rect(ctx, x, y, x + w, my);                         // ▀
  else if (cp >= 0x2581 && cp <= 0x2588) {                               // ▁..█
    rect(ctx, x, fromTop(8 - (cp - 0x2580)), x + w, y + h);
  } else if (cp >= 0x2589 && cp <= 0x258f) {                             // ▉..▏
    rect(ctx, x, y, fromLeft(8 - (cp - 0x2588)), y + h);
  } else if (cp === 0x2590) rect(ctx, mx, y, x + w, y + h);              // ▐
  else if (cp >= 0x2591 && cp <= 0x2593) {                               // ░▒▓
    ctx.save();
    ctx.globalAlpha *= (cp - 0x2590) * 0.25;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  } else if (cp === 0x2594) rect(ctx, x, y, x + w, fromTop(1));          // ▔
  else if (cp === 0x2595) rect(ctx, fromLeft(7), y, x + w, y + h);       // ▕
  else {
    // Quadrants ▖▗▘▙▚▛▜▝▞▟ as bits: 1 upper-left, 2 upper-right,
    // 4 lower-left, 8 lower-right.
    const QUADS = { 0x2596: 4, 0x2597: 8, 0x2598: 1, 0x2599: 13, 0x259a: 9,
      0x259b: 7, 0x259c: 11, 0x259d: 2, 0x259e: 6, 0x259f: 14 };
    const q = QUADS[cp];
    if (q & 1) rect(ctx, x, y, mx, my);
    if (q & 2) rect(ctx, mx, y, x + w, my);
    if (q & 4) rect(ctx, x, my, mx, y + h);
    if (q & 8) rect(ctx, mx, my, x + w, y + h);
  }
  return true;
}

// Braille U+2800–U+28FF: 2 columns × 4 rows of dots. Bit order:
// dots 1,2,3,7 down the left column, 4,5,6,8 down the right.
const BRAILLE_DOTS = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3]];

function drawBraille(ctx, bits, x, y, w, h) {
  const cw = w / 2, rh = h / 4;
  const d = Math.max(1, Math.min(Math.round(w / 4), Math.round(h / 8)));
  for (let i = 0; i < 8; i++) {
    if (!(bits & (1 << i))) continue;
    const [c, r] = BRAILLE_DOTS[i];
    const dx = x + Math.round(c * cw + (cw - d) / 2);
    const dy = y + Math.round(r * rh + (rh - d) / 2);
    if (d >= 4) {
      ctx.beginPath();
      ctx.arc(dx + d / 2, dy + d / 2, d / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(dx, dy, d, d);
    }
  }
  return true;
}

// Powerline separators: E0B0–E0B3 triangles/angles, E0B4–E0B7 half circles.
function drawPowerline(ctx, cp, x, y, w, h) {
  const lt = lightWidth(w);
  const right = cp === 0xe0b0 || cp === 0xe0b1 || cp === 0xe0b4 || cp === 0xe0b5;
  const solid = cp === 0xe0b0 || cp === 0xe0b2 || cp === 0xe0b4 || cp === 0xe0b6;
  const flat = right ? x : x + w;   // the flat edge
  const tip = right ? x + w : x;    // the pointy/round edge
  const cyM = y + h / 2;

  if (cp <= 0xe0b3) {
    const path = () => { ctx.moveTo(flat, y); ctx.lineTo(tip, cyM); ctx.lineTo(flat, y + h); };
    if (solid) {
      ctx.beginPath(); path(); ctx.closePath(); ctx.fill();
    } else {
      strokeWith(ctx, lt, path);
    }
    return true;
  }
  const start = right ? -Math.PI / 2 : Math.PI / 2;
  const end = right ? Math.PI / 2 : (3 * Math.PI) / 2;
  if (solid) {
    ctx.beginPath();
    ctx.ellipse(flat, cyM, w, h / 2, 0, start, end);
    ctx.closePath();
    ctx.fill();
  } else {
    strokeWith(ctx, lt, () => ctx.ellipse(flat, cyM, w - lt / 2, h / 2 - lt / 2, 0, start, end));
  }
  return true;
}
