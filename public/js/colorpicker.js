// A color picker popover, modeled on Web Awesome's <wa-color-picker>.
//
//   openColorPicker({ anchor, value, palette, allowNone, onInput, onChange, onClose })
//
// `value` and the refs passed to the callbacks are OTIS color refs: "#rrggbb",
// a palette slot key like "red", or null (none). onInput fires live while you
// drag; onChange fires once when the picker closes, if the value changed.
import { parseColor, toHex, rgbToHsv, hsvToRgb, rgbToHsl, hslToRgb, shades, normalizeHex } from './color.js';
import { SLOTS, SLOT_GROUPS, resolveColor } from './palette.js';

let current = null;               // the open picker's handle
let lastClosed = { anchor: null, at: 0 };

const el = (tag, cls, attrs = {}) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

export function openColorPicker({ anchor, value = null, palette = null, allowNone = true, onInput, onChange, onClose } = {}) {
  // Clicking the anchor of an open picker closes it rather than reopening it.
  if (current?.anchor === anchor) { current.close(); return { close() {} }; }
  if (lastClosed.anchor === anchor && performance.now() - lastClosed.at < 300) return { close() {} };
  current?.close();

  const initial = value ?? null;
  let ref = initial;
  let hsv = rgbToHsv(parseColor(resolveColor(ref, palette) ?? resolveColor('foreground', palette) ?? '#808080'));
  let shadeBase = hexOf();
  let mode = 'rgb';

  function hexOf() { return toHex(hsvToRgb(hsv)); }

  // --- build -------------------------------------------------------------
  const pop = el('div', 'cp-popover', { role: 'dialog', 'aria-label': 'Color picker' });
  const sv = el('div', 'cp-sv', { tabindex: '0', 'aria-label': 'Saturation and brightness' });
  const svThumb = el('div', 'cp-thumb');
  sv.append(svThumb);

  const row1 = el('div', 'cp-row');
  const preview = el('div', 'cp-preview');
  const hue = el('div', 'cp-hue', { tabindex: '0', role: 'slider', 'aria-label': 'Hue', 'aria-valuemin': '0', 'aria-valuemax': '360' });
  const hueThumb = el('div', 'cp-thumb');
  hue.append(hueThumb);
  row1.append(preview, hue);
  if (window.EyeDropper) {
    const eye = el('button', 'cp-btn cp-eye', { type: 'button', title: 'Pick a color from the screen' });
    eye.textContent = '⌖';
    eye.onclick = async () => {
      try { const { sRGBHex } = await new window.EyeDropper().open(); setHex(sRGBHex); } catch { /* cancelled */ }
    };
    row1.append(eye);
  }

  const row2 = el('div', 'cp-row');
  const hexIn = el('input', 'cp-input cp-hex', { type: 'text', spellcheck: 'false', 'aria-label': 'Hex color', maxlength: '9' });
  const modeBtn = el('button', 'cp-btn cp-mode', { type: 'button', title: 'Switch between RGB and HSL' });
  row2.append(hexIn, modeBtn);

  const row3 = el('div', 'cp-row cp-nums');
  const nums = [0, 1, 2].map(() => {
    const label = el('label', 'cp-num');
    const span = el('span');
    const input = el('input', 'cp-input', { type: 'number', min: '0' });
    label.append(span, input);
    row3.append(label);
    return { span, input };
  });

  const swatchBox = el('div', 'cp-swatches');
  const shadeRow = el('div', 'cp-shades');
  const footer = el('div', 'cp-footer');
  const label = el('div', 'cp-label');
  footer.append(label);
  let noneBtn = null;
  if (allowNone) {
    noneBtn = el('button', 'cp-btn cp-none', { type: 'button', title: 'No color (transparent / default)' });
    noneBtn.innerHTML = '<span class="cp-none-chip"></span>None';
    noneBtn.onclick = () => { ref = null; render(); onInput?.(null); };
    footer.prepend(noneBtn);
  }

  // Palette swatches, grouped like Omarchy's colors.toml.
  const groups = SLOT_GROUPS.map((g) => ({ label: g.label, keys: g.keys.filter((k) => palette?.colors?.[k]) }));
  const custom = Object.keys(palette?.colors ?? {}).filter((k) => !SLOTS.includes(k));
  if (custom.length) groups.push({ label: 'Custom', keys: custom });
  const slotButtons = new Map();
  for (const g of groups) {
    if (!g.keys.length) continue;
    const head = el('div', 'cp-group-label');
    head.textContent = g.label;
    const grid = el('div', 'cp-grid');
    for (const k of g.keys) {
      const hex = resolveColor(k, palette);
      const b = el('button', 'cp-swatch', { type: 'button', title: `${k}  ${hex}`, 'aria-label': k });
      b.style.background = hex;
      b.onclick = () => { ref = k; hsv = rgbToHsv(parseColor(hex)); shadeBase = hex; render(); onInput?.(k); };
      b.ondblclick = () => close();
      slotButtons.set(k, b);
      grid.append(b);
    }
    swatchBox.append(head, grid);
  }
  const shadeHead = el('div', 'cp-group-label');
  shadeHead.textContent = 'Shades';

  pop.append(sv, row1, row2, row3);
  if (slotButtons.size) pop.append(swatchBox);
  pop.append(shadeHead, shadeRow, footer);
  document.body.append(pop);

  // --- state → view --------------------------------------------------------
  function render(skip) {
    const hex = hexOf();
    const shown = ref === null ? null : hex;
    sv.style.backgroundColor = toHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));
    svThumb.style.left = `${hsv.s * 100}%`;
    svThumb.style.top = `${(1 - hsv.v) * 100}%`;
    svThumb.style.background = hex;
    hueThumb.style.left = `${(hsv.h / 360) * 100}%`;
    hueThumb.style.background = toHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));
    hue.setAttribute('aria-valuenow', String(Math.round(hsv.h)));
    preview.style.background = shown ?? '';
    preview.classList.toggle('cp-is-none', shown === null);
    if (skip !== hexIn) hexIn.value = hex;

    const rgb = hsvToRgb(hsv);
    const vals = mode === 'rgb'
      ? [['R', rgb.r, 255], ['G', rgb.g, 255], ['B', rgb.b, 255]]
      : (() => { const h = rgbToHsl(rgb); return [['H', Math.round(h.h), 360], ['S', Math.round(h.s * 100), 100], ['L', Math.round(h.l * 100), 100]]; })();
    modeBtn.textContent = mode.toUpperCase();
    vals.forEach(([name, v, max], i) => {
      nums[i].span.textContent = name;
      nums[i].input.max = String(max);
      if (nums[i].input !== skip) nums[i].input.value = String(v);
    });

    for (const [k, b] of slotButtons) b.classList.toggle('cp-selected', ref === k);
    noneBtn?.classList.toggle('cp-selected', ref === null);
    label.textContent = ref === null ? 'None' : ref.startsWith('#') ? hex : `${ref}  ${hex}`;

    shadeRow.replaceChildren(...shades(shadeBase, 9).map((s) => {
      const b = el('button', 'cp-swatch', { type: 'button', title: s, 'aria-label': s });
      b.style.background = s;
      b.classList.toggle('cp-selected', ref === s);
      b.onclick = () => { setHex(s, { keepShades: true }); };
      return b;
    }));
  }

  // A custom color edit: the ref becomes a hex value.
  function changed(skip, { keepShades = false } = {}) {
    ref = hexOf();
    if (!keepShades) shadeBase = ref;
    render(skip);
    onInput?.(ref);
  }

  function setHex(hex, opts) {
    const c = parseColor(hex);
    if (!c) return;
    hsv = rgbToHsv(c);
    changed(null, opts);
  }

  // --- interaction --------------------------------------------------------
  function drag(target, onMove) {
    target.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      target.focus();
      target.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const r = target.getBoundingClientRect();
        onMove(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
        changed();
      };
      move(e);
      const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
    });
  }
  drag(sv, (x, y) => { hsv = { ...hsv, s: x, v: 1 - y }; });
  drag(hue, (x) => { hsv = { ...hsv, h: Math.min(359.9, x * 360) }; });

  const arrows = (target, fn) => target.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    fn(...d);
    changed();
  });
  arrows(sv, (dx, dy) => {
    hsv = { ...hsv, s: Math.min(1, Math.max(0, hsv.s + dx / 100)), v: Math.min(1, Math.max(0, hsv.v + dy / 100)) };
  });
  arrows(hue, (dx, dy) => { hsv = { ...hsv, h: (hsv.h + dx + dy + 360) % 360 }; });

  hexIn.addEventListener('input', () => {
    const hex = normalizeHex(hexIn.value);
    if (hex && /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hexIn.value.trim())) { hsv = rgbToHsv(parseColor(hex)); changed(hexIn); }
  });
  hexIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { setHex(hexIn.value); hexIn.select(); } });
  hexIn.addEventListener('blur', () => render());

  modeBtn.onclick = () => { mode = mode === 'rgb' ? 'hsl' : 'rgb'; render(); };
  nums.forEach(({ input }) => input.addEventListener('input', () => {
    const v = nums.map((n) => Number(n.input.value) || 0);
    const rgb = mode === 'rgb'
      ? { r: v[0], g: v[1], b: v[2] }
      : hslToRgb({ h: v[0], s: Math.min(100, v[1]) / 100, l: Math.min(100, v[2]) / 100 });
    hsv = rgbToHsv({ r: Math.min(255, rgb.r), g: Math.min(255, rgb.g), b: Math.min(255, rgb.b) });
    changed(input);
  }));

  // --- open / close ---------------------------------------------------------
  function place() {
    const a = anchor?.getBoundingClientRect?.() ?? { left: 8, top: 8, bottom: 8, right: 8 };
    const w = pop.offsetWidth, h = pop.offsetHeight, gap = 6, m = 8;
    let top = a.bottom + gap;
    if (top + h > innerHeight - m) top = a.top - h - gap;
    top = Math.max(m, Math.min(top, innerHeight - h - m));
    const left = Math.max(m, Math.min(a.left, innerWidth - w - m));
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
  }

  const onDocDown = (e) => {
    if (pop.contains(e.target)) return;
    close({ refocus: false });
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };

  let closed = false;
  function close({ refocus = true } = {}) {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    pop.remove();
    if (current === handle) current = null;
    lastClosed = { anchor, at: performance.now() };
    if (ref !== initial) onChange?.(ref);
    onClose?.(ref);
    if (refocus) anchor?.focus?.({ preventScroll: true });
  }

  const handle = { anchor, close };
  current = handle;
  render();
  place();
  document.addEventListener('pointerdown', onDocDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);
  return handle;
}

export function closeColorPicker() {
  current?.close();
}
