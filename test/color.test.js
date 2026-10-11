import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseColor, toHex, normalizeHex, rgbToHsv, hsvToRgb, rgbToHsl, hslToRgb,
  rgbToOklch, oklchToRgb, luminance, contrastText, mix, shades,
} from '../public/js/color.js';

test('parseColor handles hex forms', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('#1a1b26'), { r: 26, g: 27, b: 38, a: 1 });
  assert.deepEqual(parseColor('1A1B26'), { r: 26, g: 27, b: 38, a: 1 });
  assert.equal(parseColor('#00000080').a.toFixed(2), '0.50');
  assert.equal(parseColor('#f008').a.toFixed(2), '0.53');
});

test('parseColor handles rgb() and hsl()', () => {
  assert.deepEqual(parseColor('rgb(10, 20, 30)'), { r: 10, g: 20, b: 30, a: 1 });
  assert.deepEqual(parseColor('rgba(10,20,30,0.5)'), { r: 10, g: 20, b: 30, a: 0.5 });
  assert.deepEqual(parseColor('rgb(10 20 30 / 50%)'), { r: 10, g: 20, b: 30, a: 0.5 });
  assert.deepEqual(parseColor('hsl(0, 100%, 50%)'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor('hsla(120 100% 25% / 1)'), { r: 0, g: 128, b: 0, a: 1 });
});

test('parseColor rejects junk', () => {
  for (const bad of ['', 'red', '#12', '#12345', 'rgb(1,2)', 'hsl(a,b,c)', null, 42]) {
    assert.equal(parseColor(bad), null, String(bad));
  }
});

test('toHex / normalizeHex', () => {
  assert.equal(toHex({ r: 26, g: 27, b: 38 }), '#1a1b26');
  assert.equal(toHex({ r: 300, g: -4, b: 15.6 }), '#ff0010');
  assert.equal(normalizeHex('#ABC'), '#aabbcc');
  assert.equal(normalizeHex('nope'), null);
});

const samples = ['#000000', '#ffffff', '#1a1b26', '#f7768e', '#9ece6a', '#7aa2f7', '#e0af68', '#808080', '#123456'];

test('HSV round-trips', () => {
  for (const hex of samples) assert.equal(toHex(hsvToRgb(rgbToHsv(parseColor(hex)))), hex);
  assert.deepEqual(rgbToHsv({ r: 255, g: 0, b: 0 }), { h: 0, s: 1, v: 1 });
});

test('HSL round-trips', () => {
  for (const hex of samples) assert.equal(toHex(hslToRgb(rgbToHsl(parseColor(hex)))), hex);
  const { h, s, l } = rgbToHsl({ r: 0, g: 0, b: 255 });
  assert.equal(Math.round(h), 240); assert.equal(s, 1); assert.equal(l, 0.5);
});

test('OKLCH round-trips and clamps to gamut', () => {
  for (const hex of samples) assert.equal(toHex(oklchToRgb(rgbToOklch(parseColor(hex)))), hex);
  const white = rgbToOklch({ r: 255, g: 255, b: 255 });
  assert.ok(Math.abs(white.l - 1) < 1e-3 && white.c < 1e-3);
  // Way out of gamut: still a valid color with roughly the requested lightness.
  const rgb = oklchToRgb({ l: 0.7, c: 0.5, h: 150 });
  for (const v of Object.values(rgb)) assert.ok(v >= 0 && v <= 255);
  assert.ok(Math.abs(rgbToOklch(rgb).l - 0.7) < 0.02);
});

test('luminance and contrastText', () => {
  assert.equal(luminance('#000000'), 0);
  assert.ok(Math.abs(luminance('#ffffff') - 1) < 1e-9);
  assert.equal(contrastText('#ffffff'), '#000000');
  assert.equal(contrastText('#1a1b26'), '#ffffff');
  assert.equal(contrastText('#e0af68'), '#000000');
});

test('mix', () => {
  assert.equal(mix('#000000', '#ffffff', 0), '#000000');
  assert.equal(mix('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
});

test('shades go from light to dark and keep the hue', () => {
  const s = shades('#7aa2f7');
  assert.equal(s.length, 9);
  const ls = s.map((h) => rgbToOklch(parseColor(h)).l);
  for (let i = 1; i < ls.length; i++) assert.ok(ls[i] < ls[i - 1], `step ${i} is darker`);
  const baseHue = rgbToOklch(parseColor('#7aa2f7')).h;
  assert.ok(Math.abs(rgbToOklch(parseColor(s[4])).h - baseHue) < 6);
  assert.equal(shades('#808080', 5).length, 5);
  assert.deepEqual(shades('nope'), []);
});
