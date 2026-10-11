import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  SLOTS, SLOT_GROUPS, ANSI_SLOTS, resolveColor, completePalette, parseThemeFile, paletteToToml, parseToml, prettyName,
} from '../public/js/palette.js';
import { THEMES } from '../public/js/themes.js';

const isHex = (v) => /^#[0-9a-f]{6}$/.test(v);

test('slot lists agree', () => {
  assert.equal(SLOTS.length, 25);
  assert.deepEqual(SLOT_GROUPS.flatMap((g) => g.keys).sort(), [...SLOTS].sort());
  assert.equal(ANSI_SLOTS.length, 16);
  for (const k of ANSI_SLOTS) assert.ok(SLOTS.includes(k), k);
  assert.equal(ANSI_SLOTS[0], 'background');
  assert.equal(ANSI_SLOTS[7], 'foreground');
  assert.equal(ANSI_SLOTS[8], 'muted');
  assert.equal(ANSI_SLOTS[14], 'bright_cyan');
  assert.equal(ANSI_SLOTS[15], 'bright_foreground');
});

test('resolveColor', () => {
  const p = { colors: { red: '#F7768E', brand: '#123456' } };
  assert.equal(resolveColor(null, p), null);
  assert.equal(resolveColor('', p), null);
  assert.equal(resolveColor('#ABCDEF', p), '#abcdef');
  assert.equal(resolveColor('red', p), '#f7768e');
  assert.equal(resolveColor('brand', p), '#123456');
  assert.equal(resolveColor('blue', p), null);
  assert.equal(resolveColor('red', null), null);
});

test('completePalette fills every slot and keeps custom keys', () => {
  for (const input of [{}, { background: '#1a1b26', foreground: '#c0caf5' }, { background: '#ffffff' }, { foreground: '#000000', brand: '#FF00AA' }]) {
    const c = completePalette(input);
    for (const k of SLOTS) assert.ok(isHex(c[k]), `${k} in ${JSON.stringify(input)}`);
    if (input.brand) assert.equal(c.brand, '#ff00aa');
  }
  const c = completePalette({ background: '#1a1b26', foreground: '#c0caf5', blue: '#7aa2f7' });
  assert.equal(c.accent, '#7aa2f7');
  assert.equal(c.background, '#1a1b26');
});

test('prettyName', () => {
  assert.equal(prettyName('tokyo-night'), 'Tokyo Night');
  assert.equal(prettyName('catppuccin-latte'), 'Catppuccin Latte');
  assert.equal(prettyName('rose-pine'), 'Rosé Pine');
});

test('parseToml subset', () => {
  const t = parseToml('# c\nmode = "dark" # trailing\n[colors.primary]\nbackground = \'#000000\'\nsize = 12\n');
  assert.equal(t[''].mode, 'dark');
  assert.equal(t['colors.primary'].background, '#000000');
  assert.equal(t['colors.primary'].size, 12);
});

test('parses Omarchy colors.toml', () => {
  const p = parseThemeFile(`mode = "light"\naccent = "#1E66F5"\nbackground = "#eff1f5"\nforeground = "#4c4f69"\nred = "#d20f39"\nhyprland_active_border = "rgba(1e66f5ee) 45deg"\nbrand = "#ff00aa"\n`, 'themes/catppuccin-latte/colors.toml');
  assert.equal(p.name, 'Catppuccin Latte');
  assert.equal(p.mode, 'light');
  assert.equal(p.colors.accent, '#1e66f5');
  assert.equal(p.colors.red, '#d20f39');
  assert.equal(p.colors.brand, '#ff00aa');
  assert.equal(p.colors.hyprland_active_border, undefined);
  for (const k of SLOTS) assert.ok(isHex(p.colors[k]), k);
});

test('parses alacritty.toml', () => {
  const p = parseThemeFile(`
[colors.primary]
background = "#1a1b26"
foreground = "#a9b1d6"

[colors.selection]
background = "#283457"

[colors.normal]
black = "#15161e"
red = "#f7768e"
green = "#9ece6a"
yellow = "#e0af68"
blue = "#7aa2f7"
magenta = "#bb9af7"
cyan = "#7dcfff"
white = "#a9b1d6"

[colors.bright]
black = "#414868"
red = "0xff7a93"
green = "#b9f27c"
yellow = "#ff9e64"
blue = "#7da6ff"
magenta = "#bb9af7"
cyan = "#0db9d7"
white = "#c0caf5"
`, 'tokyo-night.toml');
  assert.equal(p.name, 'Tokyo Night');
  assert.equal(p.mode, 'dark');
  assert.equal(p.colors.background, '#1a1b26');
  assert.equal(p.colors.foreground, '#a9b1d6');
  assert.equal(p.colors.selection, '#283457');
  assert.equal(p.colors.muted, '#414868');
  assert.equal(p.colors.bright_red, '#ff7a93');
  assert.equal(p.colors.bright_foreground, '#c0caf5');
  assert.equal(p.colors.black, '#15161e'); // ANSI 0 kept as a custom swatch
  assert.equal(p.colors.white, undefined); // same as foreground, so dropped
});

test('parses a Ghostty theme', () => {
  const p = parseThemeFile(`# Ghostty
palette = 0=#45475a
palette = 1=#f38ba8
palette = 2=#a6e3a1
palette = 3=#f9e2af
palette = 4=#89b4fa
palette = 5=#f5c2e7
palette = 6=#94e2d5
palette = 7=#bac2de
palette = 8=#585b70
palette = 9=#f38ba8
palette = 15=#a6adc8
background = 1e1e2e
foreground = cdd6f4
selection-background = 585b70
`, 'catppuccin-mocha');
  assert.equal(p.name, 'Catppuccin Mocha');
  assert.equal(p.colors.background, '#1e1e2e');
  assert.equal(p.colors.foreground, '#cdd6f4');
  assert.equal(p.colors.red, '#f38ba8');
  assert.equal(p.colors.blue, '#89b4fa');
  assert.equal(p.colors.muted, '#585b70');
  assert.equal(p.colors.bright_foreground, '#a6adc8');
  assert.equal(p.colors.selection, '#585b70');
});

test('parses a kitty theme', () => {
  const p = parseThemeFile(`# vim:ft=kitty
background #282828
foreground #ebdbb2
selection_background #504945
color0 #282828
color1 #cc241d
color2 #98971a
color3 #d79921
color4 #458588
color5 #b16286
color6 #689d6a
color7 #a89984
color8 #928374
color12 #83a598
`, '/home/me/.config/kitty/gruvbox.conf');
  assert.equal(p.name, 'Gruvbox');
  assert.equal(p.colors.background, '#282828');
  assert.equal(p.colors.foreground, '#ebdbb2');
  assert.equal(p.colors.green, '#98971a');
  assert.equal(p.colors.muted, '#928374');
  assert.equal(p.colors.bright_blue, '#83a598');
  assert.equal(p.colors.white, '#a89984');
  assert.equal(p.colors.black, undefined);
});

test('parseThemeFile errors are friendly', () => {
  assert.throws(() => parseThemeFile(''), /empty/);
  assert.throws(() => parseThemeFile('hello world\nnothing here'), /No colors found/);
});

test('real Omarchy theme parses', { skip: !existsSync('/usr/share/omarchy/themes/tokyo-night/colors.toml') }, () => {
  const p = parseThemeFile(readFileSync('/usr/share/omarchy/themes/tokyo-night/colors.toml', 'utf8'), '/usr/share/omarchy/themes/tokyo-night/colors.toml');
  assert.equal(p.name, 'Tokyo Night');
  assert.equal(p.colors.background, '#1a1b26');
  for (const k of SLOTS) assert.ok(isHex(p.colors[k]), k);
});

test('paletteToToml round-trips through parseThemeFile', () => {
  const src = { name: 'Mine', mode: 'dark', colors: completePalette({ background: '#101010', foreground: '#eeeeee', brand: '#ff00aa' }) };
  const toml = paletteToToml(src);
  assert.match(toml, /^# Mine/);
  assert.match(toml, /brand = "#ff00aa"/);
  const back = parseThemeFile(toml, 'mine/colors.toml');
  assert.equal(back.mode, 'dark');
  assert.deepEqual(back.colors, src.colors);
});

test('bundled THEMES are complete', () => {
  assert.ok(THEMES.length > 0);
  for (const t of THEMES) {
    assert.ok(t.id && t.name && (t.mode === 'dark' || t.mode === 'light'), t.id);
    for (const k of SLOTS) assert.ok(isHex(t.colors[k]), `${t.id}.${k}`);
  }
});
