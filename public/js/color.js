// Color math for OTIS. Pure functions, no DOM.
// RGB channels are 0–255 integers; alpha, saturation, value and lightness are 0–1;
// hue is in degrees. OKLCH uses l 0–1, c ~0–0.4, h degrees.

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const hex2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');

// Parse "#rgb", "#rgba", "#rrggbb", "#rrggbbaa", "rgb()/rgba()", "hsl()/hsla()".
// Returns {r, g, b, a} or null.
export function parseColor(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim().toLowerCase();
  let m = s.match(/^#?([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = s.match(/^(rgba?|hsla?)\((.*)\)$/);
  if (!m) return null;
  const parts = m[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const num = (p) => parseFloat(p);
  if (parts.some((p) => Number.isNaN(num(p)))) return null;
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? num(parts[3]) / 100 : num(parts[3]);
  if (m[1].startsWith('rgb')) {
    const ch = (p) => (p.endsWith('%') ? (num(p) / 100) * 255 : num(p));
    return { r: clamp(Math.round(ch(parts[0])), 0, 255), g: clamp(Math.round(ch(parts[1])), 0, 255),
      b: clamp(Math.round(ch(parts[2])), 0, 255), a: clamp(alpha, 0, 1) };
  }
  const { r, g, b } = hslToRgb({ h: num(parts[0]), s: num(parts[1]) / 100, l: num(parts[2]) / 100 });
  return { r, g, b, a: clamp(alpha, 0, 1) };
}

export function toHex({ r, g, b }) {
  return '#' + hex2(r) + hex2(g) + hex2(b);
}

// Normalize any parseable color to "#rrggbb", or null.
export function normalizeHex(str) {
  const c = parseColor(str);
  return c ? toHex(c) : null;
}

export function rgbToHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }) {
  h = ((h % 360) + 360) % 360;
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: Math.round(f(5) * 255), g: Math.round(f(3) * 255), b: Math.round(f(1) * 255) };
}

export function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const { h } = rgbToHsv({ r: r * 255, g: g * 255, b: b * 255 });
  return { h, s, l };
}

export function hslToRgb({ h, s, l }) {
  h = ((h % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

// --- OKLCH (Björn Ottosson's OKLab) ---------------------------------------
const toLinear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const fromLinear = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklabToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

export function rgbToOklch({ r, g, b }) {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  const c = Math.hypot(A, B);
  return { l: L, c, h: c < 1e-4 ? 0 : (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 };
}

// Converts OKLCH to sRGB. Out-of-gamut colors keep their lightness and hue and
// lose chroma until they fit.
export function oklchToRgb({ l, c, h }) {
  l = clamp(l, 0, 1);
  const rad = (h * Math.PI) / 180;
  const at = (chroma) => oklabToLinear(l, chroma * Math.cos(rad), chroma * Math.sin(rad));
  const inGamut = (rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  let rgb = at(c);
  if (!inGamut(rgb)) {
    let lo = 0, hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(at(mid))) lo = mid; else hi = mid;
    }
    rgb = at(lo);
  }
  const [r, g, b] = rgb.map((v) => clamp(Math.round(fromLinear(clamp(v, 0, 1))), 0, 255));
  return { r, g, b };
}

// WCAG relative luminance, 0 (black) to 1 (white).
export function luminance(hex) {
  const c = parseColor(hex);
  if (!c) return 0;
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

// Black or white, whichever reads better on top of `hex`.
export function contrastText(hex) {
  const L = luminance(hex);
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#000000' : '#ffffff';
}

// Linear sRGB mix: t = 0 gives a, t = 1 gives b.
export function mix(hexA, hexB, t = 0.5) {
  const a = parseColor(hexA), b = parseColor(hexB);
  if (!a || !b) return normalizeHex(hexA) ?? normalizeHex(hexB);
  return toHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
}

// A tint/shade ramp for `hex`, lightest first, like Web Awesome's 95…05 scales.
// Hue is kept; chroma eases off toward the very light and very dark ends.
export function shades(hex, steps = 9) {
  const c = parseColor(hex);
  if (!c || steps < 1) return [];
  const base = rgbToOklch(c);
  const hi = 0.96, lo = 0.24;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const l = steps === 1 ? base.l : hi - (i * (hi - lo)) / (steps - 1);
    const edge = Math.abs(l - 0.6) / 0.38; // 0 in the middle, ~1 at the ends
    const chroma = base.c * clamp(1 - 0.75 * edge * edge, 0.15, 1);
    out.push(toHex(oklchToRgb({ l, c: chroma, h: base.h })));
  }
  return out;
}
