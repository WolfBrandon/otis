// The TextArt dialog: type some text, pick a font and size, and insert it as
// big letters. The result is a text object that remembers how it was made
// (`art`), so it can be changed later from the dialog or the Properties panel.

import { el, modal, toast } from './ui.js';
import { state, mutate, findDeep, activeTab } from './state.js';
import { makeText, fitText, chars } from './model.js';
import { compositeObjects } from './composite.js';
import { TEXTART_FONTS, TEXTART_SIZES, fitSize, renderTextArt } from './textart.js';
import { paintGrid, measureFont } from './render.js';
import * as A from './actions.js';

export const loadFlf = name => fetch(`fonts/figlet/${name}.flf`).then(r => {
  if (!r.ok) throw new Error(`Couldn't load the font "${name}"`);
  return r.text();
});

export const artText = art => renderTextArt(art.text, art.font, art.size, loadFlf);

function remembered() {
  try { return JSON.parse(localStorage.getItem('otis:textart')) || {}; } catch { return {}; }
}
function remember(art) {
  try { localStorage.setItem('otis:textart', JSON.stringify(art)); } catch {}
}

const sizeOf = text => {
  const lines = text.split('\n');
  return { w: Math.max(0, ...lines.map(l => chars(l).length)), h: lines.length };
};

// Draw a TextArt object again with a changed text, font or size.
export async function updateArt(id, patch, coalesce = null) {
  const start = findDeep(id)?.obj;
  if (!start?.art) return;
  const art = { ...start.art, ...patch };
  art.size = fitSize(art.font, art.size);
  let text;
  try { text = await artText(art); } catch (e) { return toast(e.message, 5000); }
  const o = findDeep(id)?.obj;   // the project may have changed meanwhile
  if (!o) return;
  mutate(() => { o.art = art; o.text = text; fitText(o); }, { coalesce });
}

// Without `edit`, insert a new TextArt object; with a TextArt object, change it.
export async function textArtDialog(edit = null) {
  const s = { text: 'OTIS', font: TEXTART_FONTS[0].id, size: 'm', ...remembered(), ...(edit?.art || {}) };
  const p = state.project;
  const fg = edit ? edit.fg : state.brush.fg;
  const input = el('input', { type: 'text', value: s.text, spellcheck: false, placeholder: 'Type some text' });
  const fontSel = el('select', {}, ...TEXTART_FONTS.map(f => el('option', { value: f.id, selected: f.id === s.font }, f.name)));
  const sizes = el('div.seg');
  // drawn the way the canvas draws it, shrunk to fit the dialog if needed
  const canvas = el('canvas');
  const preview = el('div.textart-preview', {}, canvas);
  const info = el('p.hint');
  let art = '', seq = 0;
  const draw = () => {
    const { w, h } = sizeOf(art || ' ');
    const grid = compositeObjects([makeText(0, 0, art, { transparent: true, fg })], w, h);
    const m = measureFont(p.font), d = window.devicePixelRatio || 1;
    const z = Math.min(1, ((preview.clientWidth || 768) - 30) / (w * m.w));
    const cw = Math.max(1, Math.round(m.w * z * d)), ch = Math.max(1, Math.round(m.h * z * d));
    Object.assign(canvas, { width: w * cw, height: h * ch });
    Object.assign(canvas.style, { width: w * cw / d + 'px', height: h * ch / d + 'px' });
    paintGrid(canvas.getContext('2d'), grid, p, m, { ox: 0, oy: 0, cw, ch, scale: z * d });
  };

  const update = async () => {
    const font = TEXTART_FONTS.find(f => f.id === s.font) || TEXTART_FONTS[0];
    s.size = fitSize(font.id, s.size);
    sizes.replaceChildren(...TEXTART_SIZES.map(([k, label]) => el('button' + (k === s.size ? '.on' : ''), {
      type: 'button', disabled: !font.sizes[k],
      title: font.sizes[k] ? label : `${font.name} comes in ${TEXTART_SIZES.filter(([z]) => font.sizes[z]).map(([, l]) => l.toLowerCase()).join(' and ')} only`,
      onclick: () => { s.size = k; update(); },
    }, label)));
    const n = ++seq;
    let out;
    try { out = await renderTextArt(s.text, s.font, s.size, loadFlf); }
    catch (e) { if (n === seq) { art = ''; draw(); info.textContent = e.message; } return; }
    if (n !== seq) return;
    art = out;
    draw();
    const { w, h } = sizeOf(art), tab = activeTab();
    info.textContent = !art ? 'Type some text above.'
      : `${w} × ${h} characters` + (w > tab.cols ? ` · wider than the ${tab.cols}-column canvas` : '');
  };
  input.addEventListener('input', () => { s.text = input.value; update(); });
  fontSel.addEventListener('change', () => { s.font = fontSel.value; update(); });

  const body = el('div.form.textart', {},
    el('label.field', {}, el('span.label', {}, 'Text'), input),
    el('div.field', {}, el('span.label', {}, 'Font'), el('span.controls', {}, fontSel, sizes)),
    preview, info,
    el('p.hint', {}, 'Blocks fonts are OTIS’s own; the others are FIGlet fonts (BSD license).'));
  update();

  const ok = await modal(edit ? 'Edit TextArt' : 'TextArt', body, [
    { label: 'Cancel', value: false },
    { label: edit ? 'Update' : 'Insert', value: true, primary: true },
  ], { wide: true });
  if (!ok) return;
  ++seq;
  try { art = await renderTextArt(s.text, s.font, s.size, loadFlf); } catch (e) { return toast(e.message, 5000); }
  if (!art.trim()) return toast('Type some text to make TextArt.');
  const choice = { text: s.text, font: s.font, size: s.size };
  remember(choice);
  if (edit) return updateArt(edit.id, choice);
  const o = A.insertObjects([makeText(0, 0, art, { transparent: true, fg: state.brush.fg, bg: state.brush.bg, art: choice })]);
  if (o && sizeOf(art).w > activeTab().cols) toast('The TextArt is wider than the canvas. Try a smaller size or a narrower font.', 5000);
}
