// Font choices. The browser draws with fonts installed on *your* machine (not
// the container's), so OTIS can only check what's installed and fall back.

export const FONTS = [
  'JetBrainsMono Nerd Font',   // Omarchy's default
  'GeistMono Nerd Font',
  'CaskaydiaMono Nerd Font',
  'FiraCode Nerd Font',
  'Hack Nerd Font',
  'Iosevka Nerd Font',
  'MesloLGS Nerd Font',
  'iA Writer Mono S',
  'JetBrains Mono',
  'Fira Code',
  'Cascadia Mono',
  'Source Code Pro',
  'IBM Plex Mono',
  'Ubuntu Mono',
  'DejaVu Sans Mono',
  'Liberation Mono',
  'Noto Sans Mono',
  'Adwaita Mono',
  'Menlo',
  'Consolas',
];

const SAMPLE = 'mmmmmmmmmmlli10OQ@#─│█';
let ctx = null;
const cache = new Map();

function width(font) {
  ctx ||= document.createElement('canvas').getContext('2d');
  ctx.font = font;
  return ctx.measureText(SAMPLE).width;
}

// True if `family` renders differently from every generic fallback.
export function isInstalled(family) {
  if (cache.has(family)) return cache.get(family);
  const ok = ['monospace', 'serif', 'sans-serif'].some(g => width(`32px "${family}", ${g}`) !== width(`32px ${g}`));
  cache.set(family, ok);
  return ok;
}

// Chromium's Local Font Access API: every installed family that looks monospaced.
export async function localMonospaceFonts() {
  if (!window.queryLocalFonts) return null;
  const fonts = await window.queryLocalFonts();
  const families = [...new Set(fonts.map(f => f.family))];
  ctx ||= document.createElement('canvas').getContext('2d');
  return families.filter(f => {
    ctx.font = `20px "${f}", serif`;
    return Math.abs(ctx.measureText('iiii').width - ctx.measureText('WWWW').width) < 0.5;
  }).sort();
}

export function defaultFont() {
  try {
    const saved = localStorage.getItem('otis:font');
    if (saved) return saved;
  } catch {}
  return FONTS.find(isInstalled) || 'monospace';
}

export function rememberFont(family) {
  try { localStorage.setItem('otis:font', family); } catch {}
}
