// Small DOM helpers: element builder, toasts, prompt/confirm dialogs, files.

export function el(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const n = document.createElement(name || 'div');
  if (classes.length) n.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k in n && typeof v !== 'string') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : String(c));
  return n;
}

export const $ = (sel, root = document) => root.querySelector(sel);

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// Modal dialog built on <dialog>. `body` is a node; buttons are
// [{ label, value, primary }]. Resolves with the clicked value (or null).
export function modal(title, body, buttons = [{ label: 'Close', value: null }], { wide = false } = {}) {
  return new Promise(resolve => {
    const d = el('dialog.modal' + (wide ? '.wide' : ''));
    const done = v => { d.close(); d.remove(); resolve(v); };
    const btns = buttons.map(b => el('button' + (b.primary ? '.primary' : ''), {
      type: 'button',
      onclick: () => done(typeof b.value === 'function' ? b.value() : b.value),
    }, b.label));
    d.append(
      el('header', {}, el('h2', {}, title), el('button.icon.close', { type: 'button', title: 'Close', onclick: () => done(null) }, '✕')),
      el('div.modal-body', {}, body),
      el('footer', {}, ...btns),
    );
    d.addEventListener('cancel', e => { e.preventDefault(); done(null); });
    d.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        const p = buttons.findIndex(b => b.primary);
        if (p >= 0) { e.preventDefault(); btns[p].click(); }
      }
    });
    document.body.append(d);
    d.showModal();
    d.querySelector('input, textarea')?.focus();
  });
}

export async function prompt(title, value = '', { label = '', multiline = false, placeholder = '' } = {}) {
  const input = multiline
    ? el('textarea', { rows: 10, placeholder, spellcheck: false }, value)
    : el('input', { type: 'text', value, placeholder });
  const body = el('div.form', {}, label ? el('label', {}, label) : null, input);
  return modal(title, body, [
    { label: 'Cancel', value: null },
    { label: 'OK', value: () => input.value, primary: true },
  ]);
}

export function confirmDialog(title, message, okLabel = 'OK') {
  return modal(title, el('p', {}, message), [
    { label: 'Cancel', value: false },
    { label: okLabel, value: true, primary: true },
  ]);
}

export function download(filename, data, type = 'text/plain') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// Ask the user for a file and read it as text → { name, text } or null.
export function pickFile(accept = '') {
  return new Promise(resolve => {
    const input = el('input', { type: 'file', accept });
    input.addEventListener('change', async () => {
      const f = input.files[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    });
    input.click();
  });
}

export function slug(s) {
  return (s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
}
