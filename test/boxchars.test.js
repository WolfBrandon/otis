import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARMS, ARC, DASHED, isBoxChar, charForArms, mergeBox, drawGlyph } from '../public/js/boxchars.js';

test('ARMS covers U+2500–U+257F except the diagonals', () => {
  for (let cp = 0x2500; cp <= 0x257f; cp++) {
    const ch = String.fromCodePoint(cp);
    const diagonal = cp >= 0x2571 && cp <= 0x2573;
    assert.equal(ARMS.has(ch), !diagonal, ch);
  }
});

test('ARMS spot checks', () => {
  assert.deepEqual(ARMS.get('─'), [0, 1, 0, 1]);
  assert.deepEqual(ARMS.get('┼'), [1, 1, 1, 1]);
  assert.deepEqual(ARMS.get('╬'), [3, 3, 3, 3]);
  assert.deepEqual(ARMS.get('╭'), [0, 1, 1, 0]);
  assert.deepEqual(ARMS.get('┄'), [0, 1, 0, 1]);
  assert.deepEqual(ARMS.get('╿'), [2, 0, 1, 0]);
  assert.deepEqual(ARMS.get('┞'), [2, 1, 1, 0]);
  assert.deepEqual(ARMS.get('╼'), [0, 2, 0, 1]);
  assert.deepEqual(ARMS.get('╒'), [0, 3, 1, 0]);
  assert.ok(ARC.has('╰') && ARC.size === 4);
  assert.ok(DASHED.has('┆') && DASHED.has('╏') && DASHED.size === 12);
});

test('isBoxChar', () => {
  assert.ok(isBoxChar('│'));
  assert.ok(isBoxChar('╯'));
  assert.ok(!isBoxChar('A'));
  assert.ok(!isBoxChar('+'));
  assert.ok(!isBoxChar('╱'));
});

test('charForArms round-trips and prefers solid chars', () => {
  for (const [ch, arms] of ARMS) {
    const back = charForArms(...arms);
    assert.ok(back, `no reverse for ${ch}`);
    assert.deepEqual(ARMS.get(back), arms);
    if (!ARC.has(ch) && !DASHED.has(ch)) assert.equal(back, ch);
  }
  assert.equal(charForArms(0, 1, 0, 1), '─');
  assert.equal(charForArms(0, 1, 1, 0), '┌');
  assert.equal(charForArms(3, 2, 0, 0), null);
});

test('mergeBox: union of arms', () => {
  assert.equal(mergeBox('─', '│'), '┼');
  assert.equal(mergeBox('│', '─'), '┼');
  assert.equal(mergeBox('├', '─'), '┼');
  assert.equal(mergeBox('│', '╶'), '├');
  assert.equal(mergeBox('┌', '┐'), '┬');
  assert.equal(mergeBox('┌', '┘'), '┼');
  assert.equal(mergeBox('─', '─'), '─');
});

test('mergeBox: weights', () => {
  assert.equal(mergeBox('┃', '─'), '╂');
  assert.equal(mergeBox('║', '─'), '╫');
  assert.equal(mergeBox('═', '│'), '╪');
  assert.equal(mergeBox('━', '━'), '━');
  // above's weight wins where both have an arm
  assert.equal(mergeBox('─', '━'), '━');
  assert.equal(mergeBox('━', '┼'), '┼');
});

test('mergeBox: degrade heavy/double mixes', () => {
  // ║ + ━ has no char; above is heavy, so all arms go heavy
  assert.equal(mergeBox('║', '━'), '╋');
  // ┃ + ═ : above is double
  assert.equal(mergeBox('┃', '═'), '╬');
  // double up + light down + light right has no char → all light
  assert.equal(mergeBox('╨', '┌'), '┼');
});

test('mergeBox: arcs and dashes', () => {
  assert.equal(mergeBox('╭', '┌'), '╭');
  assert.equal(mergeBox('┌', '╭'), '╭');
  assert.equal(mergeBox('╭', '╶'), '╭');
  assert.equal(mergeBox('╭', '─'), '┬');
  assert.equal(mergeBox('┄', '╴'), '┄');
  assert.equal(mergeBox('┄', '│'), '┼');
  assert.equal(mergeBox('┆', '┆'), '┆');
});

test('mergeBox: ascii and non-box passthrough', () => {
  assert.equal(mergeBox('-', '|'), '+');
  assert.equal(mergeBox('|', '-'), '+');
  assert.equal(mergeBox('+', '-'), '+');
  assert.equal(mergeBox('-', '+'), '+');
  assert.equal(mergeBox('-', '-'), '-');
  assert.equal(mergeBox('A', '─'), '─');
  assert.equal(mergeBox('─', 'A'), 'A');
  assert.equal(mergeBox('-', '│'), '│');
  assert.equal(mergeBox(' ', '|'), '|');
});

// --- drawing ---------------------------------------------------------------

// A fake 2D context that records calls and rasterises fillRect into a grid.
function fakeCtx(W = 0, H = 0) {
  const calls = [];
  const px = Array.from({ length: H }, () => new Array(W).fill(0));
  const ctx = { fillStyle: '#fff', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, lineCap: 'butt', calls, px };
  for (const m of ['beginPath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'ellipse', 'closePath', 'fill', 'stroke', 'save', 'restore', 'fillText']) {
    ctx[m] = (...args) => calls.push([m, ...args]);
  }
  ctx.fillRect = (x, y, w, h) => {
    calls.push(['fillRect', x, y, w, h]);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (px[j] && i < W) px[j][i] = 1;
  };
  return ctx;
}

test('drawGlyph handles box, block, braille, powerline; not plain text', () => {
  for (const ch of ['─', '╬', '╭', '┄', '█', '░', '▚', '⣿', '⠁', '', '', '╳']) {
    const ctx = fakeCtx(10, 20);
    assert.equal(drawGlyph(ctx, ch, 0, 0, 10, 20), true, ch);
    assert.ok(ctx.calls.length > 0, `${ch} drew nothing`);
    assert.ok(!ctx.calls.some(([m]) => m === 'fillText'), `${ch} used fillText`);
  }
  for (const ch of ['A', '', ' ', '+', '→']) {
    const ctx = fakeCtx(10, 20);
    assert.equal(drawGlyph(ctx, ch, 0, 0, 10, 20), false, JSON.stringify(ch));
    assert.equal(ctx.calls.length, 0);
  }
});

test('drawGlyph keeps fillStyle and balances save/restore', () => {
  for (let cp = 0x2500; cp <= 0x259f; cp++) {
    const ctx = fakeCtx(12, 24);
    drawGlyph(ctx, String.fromCodePoint(cp), 0, 0, 12, 24);
    assert.equal(ctx.fillStyle, '#fff');
    const saves = ctx.calls.filter(([m]) => m === 'save').length;
    const restores = ctx.calls.filter(([m]) => m === 'restore').length;
    assert.equal(saves, restores);
  }
});

test('line rectangles are pixel aligned', () => {
  for (const [w, h] of [[9, 19], [10, 20], [17, 34], [24, 48]]) {
    for (const ch of ARMS.keys()) {
      if (ARC.has(ch)) continue;
      const ctx = fakeCtx(w, h);
      drawGlyph(ctx, ch, 3, 5, w, h);
      for (const [m, ...args] of ctx.calls) {
        if (m === 'fillRect') assert.ok(args.every(Number.isInteger), `${ch} at ${w}x${h}: ${args}`);
      }
    }
  }
});

// Runs of filled pixels along an edge, e.g. [3] for a light line 3px wide.
function runs(line) {
  const out = [];
  let n = 0;
  for (const v of line) {
    if (v) n++;
    else if (n) { out.push(n); n = 0; }
  }
  if (n) out.push(n);
  return out;
}

test('every solid box char reaches exactly the cell edges its arms say', () => {
  for (const [w, h] of [[10, 20], [16, 32], [9, 21]]) {
    const lt = Math.max(1, Math.round(w / 8));
    const expect = (wt) => (wt === 0 ? [] : wt === 1 ? [lt] : wt === 2 ? [2 * lt] : [lt, lt]);
    for (const [ch, [n, e, s, wa]] of ARMS) {
      if (ARC.has(ch) || DASHED.has(ch)) continue;
      const ctx = fakeCtx(w, h);
      drawGlyph(ctx, ch, 0, 0, w, h);
      const { px } = ctx;
      const col = (i) => px.map((row) => row[i]);
      assert.deepEqual(runs(px[0]), expect(n), `${ch} north edge ${w}x${h}`);
      assert.deepEqual(runs(px[h - 1]), expect(s), `${ch} south edge ${w}x${h}`);
      assert.deepEqual(runs(col(0)), expect(wa), `${ch} west edge ${w}x${h}`);
      assert.deepEqual(runs(col(w - 1)), expect(e), `${ch} east edge ${w}x${h}`);
    }
  }
});

test('neighbouring cells line up: ─ next to ┼ next to ═ next to ╬', () => {
  const w = 10, h = 20;
  const ctx = fakeCtx(w * 2, h);
  drawGlyph(ctx, '─', 0, 0, w, h);
  drawGlyph(ctx, '┼', w, 0, w, h);
  const rows = (x) => ctx.px.map((r, j) => (r[x] ? j : -1)).filter((j) => j >= 0);
  assert.deepEqual(rows(w - 1), rows(w));

  const ctx2 = fakeCtx(w * 2, h);
  drawGlyph(ctx2, '═', 0, 0, w, h);
  drawGlyph(ctx2, '╬', w, 0, w, h);
  const rows2 = (x) => ctx2.px.map((r, j) => (r[x] ? j : -1)).filter((j) => j >= 0);
  assert.deepEqual(rows2(w - 1), rows2(w));
});

test('╬ leaves its centre hollow; ╦ keeps a continuous top line', () => {
  const w = 16, h = 32;
  const ctx = fakeCtx(w, h);
  drawGlyph(ctx, '╬', 0, 0, w, h);
  assert.equal(ctx.px[h / 2][w / 2], 0);

  const ctx2 = fakeCtx(w, h);
  drawGlyph(ctx2, '╦', 0, 0, w, h);
  const lt = 2;
  const top = Math.floor((h - 3 * lt) / 2);
  assert.ok(ctx2.px[top].every(Boolean));
  assert.ok(!ctx2.px[top + 2 * lt].every(Boolean));
});

test('blocks fill the right fraction', () => {
  const w = 8, h = 16;
  const filled = (ch) => {
    const ctx = fakeCtx(w, h);
    drawGlyph(ctx, ch, 0, 0, w, h);
    return ctx.px.flat().filter(Boolean).length;
  };
  assert.equal(filled('█'), w * h);
  assert.equal(filled('▄'), (w * h) / 2);
  assert.equal(filled('▀'), (w * h) / 2);
  assert.equal(filled('▌'), (w * h) / 2);
  assert.equal(filled('▁'), w * 2);
  assert.equal(filled('▏'), h);
  assert.equal(filled('▚'), (w * h) / 2);
  assert.equal(filled('▙'), (w * h * 3) / 4);
});

test('braille draws one dot per set bit', () => {
  const dots = (ch) => {
    const ctx = fakeCtx(10, 20);
    drawGlyph(ctx, ch, 0, 0, 10, 20);
    return ctx.calls.filter(([m]) => m === 'fillRect' || m === 'arc').length;
  };
  assert.equal(dots('⠀'), 0);
  assert.equal(dots('⠁'), 1);
  assert.equal(dots('⣿'), 8);
  assert.equal(dots('⡇'), 4);
});
