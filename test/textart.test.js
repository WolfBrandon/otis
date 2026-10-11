import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTextArt, fitSize, TEXTART_FONTS, parseFlf } from '../public/js/textart.js';

const FONTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts', 'figlet');
const load = (name) => fs.readFile(path.join(FONTS, name + '.flf'), 'utf8');
const art = (text, font, size = 'm') => renderTextArt(text, font, size, load);

// These match the output of the figlet program itself.
test('Standard smushes like figlet', async () => {
  assert.equal(await art('Hello', 'standard'), [
    ' _   _      _ _',
    '| | | | ___| | | ___',
    '| |_| |/ _ \\ | |/ _ \\',
    '|  _  |  __/ | | (_) |',
    '|_| |_|\\___|_|_|\\___/',
  ].join('\n'));
});

test('Slant, and the small and big sizes', async () => {
  assert.equal(await art('Hi', 'slant'), [
    '    __  ___',
    '   / / / (_)',
    '  / /_/ / /',
    ' / __  / /',
    '/_/ /_/_/',
  ].join('\n'));
  assert.equal((await art('Hi', 'standard', 's')).split('\n').length, 4);
  assert.equal((await art('Hi', 'standard', 'l')).split('\n').length, 6);
});

test('kerning fonts touch without overlapping', async () => {
  assert.equal(await art('ab', 'digital'), '+-+-+\n|a|b|\n+-+-+');
});

test('every font and size renders', async () => {
  for (const f of TEXTART_FONTS) {
    for (const s of ['s', 'm', 'l']) {
      if (!f.sizes[s]) continue;
      const out = await art('OTIS 42!', f.id, s);
      assert.ok(out.split('\n').length >= 2, `${f.id} ${s}`);
      assert.doesNotMatch(out, /[@$]$/m, `${f.id} ${s}: endmarks and hardblanks are gone`);
    }
  }
});

test('missing sizes fall back to the nearest one', () => {
  assert.equal(fitSize('slant', 'l'), 'm');
  assert.equal(fitSize('mini', 's'), 'm');
  assert.equal(fitSize('standard', 'l'), 'l');
});

test('Blocks 3D draws a shadow behind solid letters', async () => {
  assert.equal(await art('OT', 'blocks-3d'), [
    '  ████╗   ██████████╗',
    '██╔═══██╗ ╚═══██╔═══╝',
    '██║   ██║     ██║',
    '██║   ██║     ██║',
    '╚═████╔═╝     ██║',
    '  ╚═══╝       ╚═╝',
  ].join('\n'));
  assert.equal(await art('I', 'blocks', 's'), '▀█▀\n █\n▀▀▀');
});

test('parseFlf reads the header and code-tagged characters', async () => {
  const f = parseFlf(await load('standard'));
  assert.equal(f.height, 6);
  assert.equal(f.hardblank, '$');
  assert.equal(f.mode, 128 + 15);
  assert.ok(f.chars.get(0x41).length === 6);
  assert.ok(f.chars.has(0xc0), 'Latin-1 letters from the code-tagged part');
});
