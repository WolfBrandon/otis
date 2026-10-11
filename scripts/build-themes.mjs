// Builds public/js/themes.js from Omarchy's stock themes plus the themes that
// ship with OTIS in ./themes (Phosphor, PhosphorWolf).
//   npm run themes                       (reads /usr/share/omarchy/themes + ./themes)
//   node scripts/build-themes.mjs <dir>  (any folder of <theme>/colors.toml, + ./themes)
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseThemeFile, prettyName, SLOTS } from '../public/js/palette.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2] || '/usr/share/omarchy/themes';
const out = join(root, 'public', 'js', 'themes.js');
const NAMES = { 'phosphor-wolf': 'PhosphorWolf' };   // names that aren't just the folder name

if (!existsSync(src)) {
  console.error(`No themes folder at ${src}. Pass one: node scripts/build-themes.mjs <dir>`);
  process.exit(1);
}

const byId = new Map();
for (const dir of [src, join(root, 'themes')]) {
  for (const id of readdirSync(dir).sort()) {
    const file = join(dir, id, 'colors.toml');
    if (!existsSync(file)) continue;
    const { mode, colors } = parseThemeFile(readFileSync(file, 'utf8'), `${id}/colors.toml`);
    byId.set(id, { id, name: NAMES[id] || prettyName(id), mode, colors });
  }
}
const themes = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));

const body = themes.map((t) => {
  const keys = [...SLOTS, ...Object.keys(t.colors).filter((k) => !SLOTS.includes(k))];
  const rows = keys.map((k) => `      ${k}: '${t.colors[k]}',`).join('\n');
  return `  {\n    id: '${t.id}',\n    name: '${t.name.replace(/'/g, "\\'")}',\n    mode: '${t.mode}',\n    colors: {\n${rows}\n    },\n  },`;
}).join('\n');

writeFileSync(out, `// GENERATED FILE — do not edit by hand.
// Color values from Omarchy's stock themes (https://github.com/basecamp/omarchy, MIT),
// which adapt the upstream palettes they are named after, plus OTIS's own
// themes from ./themes (Phosphor, PhosphorWolf).
// Regenerate with: npm run themes   (or: node scripts/build-themes.mjs <themes-dir>)
// Missing slots are filled in by completePalette() in palette.js.

export const THEMES = [
${body}
];
`);
console.log(`Wrote ${themes.length} themes to ${out}`);
