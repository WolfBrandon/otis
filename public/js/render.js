// Canvas renderer. Draws the composited grid cell by cell, in device pixels so
// box-drawing lines stay crisp and connect, then draws the editing overlays.

import { drawGlyph } from './boxchars.js';
import { resolveColor } from './palette.js';
import { ATTR, composite } from './composite.js';
import { state, on, emit, editTarget, selected, activeTab } from './state.js';
import { bounds, unionBounds, RESIZABLE, caretCell, tableEdges } from './model.js';

export function fontStack(family) {
  return `"${family}", ui-monospace, "DejaVu Sans Mono", monospace`;
}

// Cell size for a project font, in CSS pixels.
export function measureFont(font) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${font.size}px ${fontStack(font.family)}`;
  const m = ctx.measureText('M');
  return {
    w: m.width || font.size * 0.6,
    h: font.size * (font.lineHeight || 1.2),
    asc: m.fontBoundingBoxAscent ?? font.size * 0.8,
    desc: m.fontBoundingBoxDescent ?? font.size * 0.2,
  };
}

// Paint grid cells c0..c1 × r0..r1 at device origin (ox, oy).
// `scale` = device pixels per CSS pixel of the project font.
export function paintGrid(ctx, grid, project, metrics, { ox, oy, cw, ch, scale, c0 = 0, r0 = 0, c1 = grid.cols, r1 = grid.rows, blinkOff = false }) {
  const pal = project.palette;
  const cache = new Map();
  const color = ref => {
    if (ref == null) return null;
    let v = cache.get(ref);
    if (v === undefined) { v = resolveColor(ref, pal); cache.set(ref, v); }
    return v;
  };
  const defFg = color(project.foreground) || '#c0caf5';

  ctx.fillStyle = color(project.background) || '#000000';
  ctx.fillRect(ox + c0 * cw, oy + r0 * ch, (c1 - c0) * cw, (r1 - r0) * ch);

  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const bg = grid.bg[r * grid.cols + c];
      if (bg == null) continue;
      const hex = color(bg);
      if (!hex) continue;
      ctx.fillStyle = hex;
      ctx.fillRect(ox + c * cw, oy + r * ch, cw, ch);
    }
  }

  const fontPx = project.font.size * scale;
  const base = Math.round((ch - (metrics.asc + metrics.desc) * scale) / 2 + metrics.asc * scale);
  const thin = Math.max(1, Math.round(scale));
  ctx.textBaseline = 'alphabetic';
  let curFont = '';
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const i = r * grid.cols + c;
      const g = grid.ch[i];
      if (g == null || g === ' ') continue;
      const a = grid.attr[i];
      if (blinkOff && (a & ATTR.blink)) continue;
      const x = ox + c * cw, y = oy + r * ch;
      ctx.fillStyle = color(grid.fg[i]) || defFg;
      ctx.globalAlpha = a & ATTR.dim ? 0.5 : 1;
      if (!drawGlyph(ctx, g, x, y, cw, ch)) {
        const f = `${a & ATTR.italic ? 'italic ' : ''}${a & ATTR.bold ? 'bold ' : ''}${fontPx}px ${fontStack(grid.font[i] || project.font.family)}`;
        if (f !== curFont) { ctx.font = f; curFont = f; }
        ctx.fillText(g, x, y + base);
      }
      if (a & ATTR.underline) ctx.fillRect(x, Math.min(y + ch - thin, y + base + thin), cw, thin);
      if (a & ATTR.strike) ctx.fillRect(x, y + Math.round(ch / 2), cw, thin);
    }
  }
  ctx.globalAlpha = 1;
}

// Render a grid to a PNG blob at `scale`× the project font size.
export async function renderPNG(project, grid, { scale = 2, rect = null } = {}) {
  await document.fonts.ready;
  const m = measureFont(project.font);
  const cw = Math.max(1, Math.round(m.w * scale)), ch = Math.max(1, Math.round(m.h * scale));
  const a = rect || { x: 0, y: 0, w: grid.cols, h: grid.rows };
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, a.w * cw);
  canvas.height = Math.max(1, a.h * ch);
  const ctx = canvas.getContext('2d');
  paintGrid(ctx, grid, project, m, { ox: -a.x * cw, oy: -a.y * ch, cw, ch, scale, c0: a.x, r0: a.y, c1: a.x + a.w, r1: a.y + a.h });
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}

const HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.grid = null;
    this.metrics = { w: 9.6, h: 19.2, asc: 13, desc: 3 };
    this.dirtyGrid = true;
    this.queued = false;
    this.blinkOff = false;
    this.overlay = { marquee: null, hover: null };
    this.chrome = {};

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    on('doc', () => this.invalidate(true));
    on('project', () => { this.remeasure(); this.fit(); });
    on('tab', e => { if (e?.resized) this.fit(); });
    for (const e of ['view', 'selection', 'tool']) on(e, () => this.invalidate());
    setInterval(() => {
      const on = state.view.blink && this.grid?.hasBlink;
      if (!on && !this.blinkOff) return;
      this.blinkOff = on ? !this.blinkOff : false;
      this.invalidate();
    }, 530);
  }

  get dpr() { return window.devicePixelRatio || 1; }

  // Device-pixel cell size and grid origin.
  get cell() {
    const z = state.view.zoom, d = this.dpr;
    return {
      cw: Math.max(1, Math.round(this.metrics.w * z * d)),
      ch: Math.max(1, Math.round(this.metrics.h * z * d)),
      ox: Math.round(state.view.x * d),
      oy: Math.round(state.view.y * d),
    };
  }

  remeasure() {
    if (!state.project) return;
    this.metrics = measureFont(state.project.font);
    this.fontKey = JSON.stringify(state.project.font);
    this.invalidate(true);
  }

  // Re-measure when the project font changes.
  syncMetrics() {
    const p = state.project;
    if (p && JSON.stringify(p.font) !== this.fontKey) this.remeasure();
  }

  refreshChrome() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['stage', 'accent', 'border', 'text', 'muted'])
      this.chrome[k] = cs.getPropertyValue('--' + k).trim();
    this.invalidate();
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.draw();
  }

  invalidate(regrid = false) {
    if (regrid) this.dirtyGrid = true;
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => { this.queued = false; this.draw(); });
  }

  getGrid() {
    if (this.dirtyGrid || !this.grid) {
      this.grid = composite(state.project, { tab: activeTab() });
      this.grid.hasBlink = this.grid.attr.some(a => a & ATTR.blink);
      this.dirtyGrid = false;
    }
    return this.grid;
  }

  // Pointer position → cell coordinates (fractional; floor them for the cell).
  clientToCell(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const { cw, ch, ox, oy } = this.cell;
    const px = (clientX - r.left) * this.dpr, py = (clientY - r.top) * this.dpr;
    return { fx: (px - ox) / cw, fy: (py - oy) / ch, x: Math.floor((px - ox) / cw), y: Math.floor((py - oy) / ch) };
  }

  // Cell corner → CSS pixels relative to the canvas.
  cellToCss(x, y) {
    const { cw, ch, ox, oy } = this.cell;
    return { x: (ox + x * cw) / this.dpr, y: (oy + y * ch) / this.dpr };
  }

  zoomAt(factor, clientX, clientY) {
    const v = state.view;
    const r = this.canvas.getBoundingClientRect();
    const mx = clientX - r.left, my = clientY - r.top;
    const z = Math.min(8, Math.max(0.2, v.zoom * factor));
    v.x = mx - (mx - v.x) * (z / v.zoom);
    v.y = my - (my - v.y) * (z / v.zoom);
    v.zoom = z;
    emit('view');
  }

  setZoom(z) {
    const r = this.canvas.getBoundingClientRect();
    this.zoomAt(z / state.view.zoom, r.left + r.width / 2, r.top + r.height / 2);
  }

  // Zoom so the whole canvas fits the stage.
  fit() {
    if (!state.project) return;
    const p = activeTab();
    this.syncMetrics();
    const r = this.canvas.parentElement.getBoundingClientRect();
    if (!r.width) return;
    const z = Math.min(2, (r.width - 64) / (p.cols * this.metrics.w), (r.height - 64) / (p.rows * this.metrics.h));
    state.view.zoom = Math.max(0.2, z);
    state.view.x = (r.width - p.cols * this.metrics.w * state.view.zoom) / 2;
    state.view.y = Math.max(24, (r.height - p.rows * this.metrics.h * state.view.zoom) / 2);
    emit('view');
  }

  // Handles for the selection, in CSS px: endpoints of a line, resize
  // handles of a box, text or block, and scale handles around several
  // objects or a group.
  handles() {
    const sel = selected();
    if (!sel.length || state.editing) return [];
    const o = sel[0];
    if (sel.length === 1 && o.type === 'line') return o.points.map((p, i) => {
      const c = this.cellToCss(p[0] + 0.5, p[1] + 0.5);
      return { kind: 'point', index: i, x: c.x, y: c.y };
    });
    const kind = sel.length > 1 || o.type === 'group' ? 'scale' : RESIZABLE.has(o.type) ? 'resize' : null;
    if (!kind) return [];
    const b = unionBounds(sel.map(bounds));
    const a = this.cellToCss(b.x, b.y), z = this.cellToCss(b.x + b.w, b.y + b.h);
    const mx = (a.x + z.x) / 2, my = (a.y + z.y) / 2;
    const pos = { nw: [a.x, a.y], n: [mx, a.y], ne: [z.x, a.y], e: [z.x, my], se: [z.x, z.y], s: [mx, z.y], sw: [a.x, z.y], w: [a.x, my] };
    return HANDLE_DIRS.map(d => ({ kind, dir: d, x: pos[d][0], y: pos[d][1] }));
  }

  draw() {
    const p = state.project;
    if (!p) return;
    this.syncMetrics();
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height, d = this.dpr;
    const grid = this.getGrid();
    const { cw, ch, ox, oy } = this.cell;
    const C = this.chrome;
    const { cols, rows } = activeTab();

    ctx.fillStyle = C.stage || '#101014';
    ctx.fillRect(0, 0, W, H);

    // visible cell range
    const c0 = Math.max(0, Math.floor(-ox / cw)), r0 = Math.max(0, Math.floor(-oy / ch));
    const c1 = Math.min(cols, Math.ceil((W - ox) / cw)), r1 = Math.min(rows, Math.ceil((H - oy) / ch));
    const gw = cols * cw, gh = rows * ch;

    // drop shadow + frame
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(ox + 4 * d, oy + 4 * d, gw, gh);
    if (c1 > c0 && r1 > r0)
      paintGrid(ctx, grid, p, this.metrics, { ox, oy, cw, ch, scale: state.view.zoom * d, c0, r0, c1, r1, blinkOff: this.blinkOff });
    ctx.strokeStyle = C.border || '#444';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox - 0.5, oy - 0.5, gw + 1, gh + 1);

    if (state.view.grid && cw >= 5) {
      ctx.fillStyle = 'rgba(128,128,128,0.16)';
      for (let c = c0; c <= c1; c++) ctx.fillRect(ox + c * cw, oy + r0 * ch, 1, (r1 - r0) * ch);
      for (let r = r0; r <= r1; r++) ctx.fillRect(ox + c0 * cw, oy + r * ch, (c1 - c0) * cw, 1);
    }

    const accent = C.accent || '#7aa2f7';
    const rectPx = b => [ox + b.x * cw, oy + b.y * ch, b.w * cw, b.h * ch];

    // hover cell for drawing tools
    const hv = this.overlay.hover;
    if (hv && !['select', 'hand'].includes(state.tool)) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(1, d);
      ctx.strokeRect(ox + hv.x * cw + 0.5, oy + hv.y * ch + 0.5, cw - 1, ch - 1);
    }

    // selection outlines, and a dashed one around several objects
    ctx.lineWidth = Math.max(1, Math.round(d));
    const sel = selected();
    for (const o of sel) {
      const [x, y, w, h] = rectPx(bounds(o));
      ctx.strokeStyle = accent;
      ctx.setLineDash(o.type === 'group' ? [4 * d, 3 * d] : []);
      ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
    }
    if (sel.length > 1 && !state.editing) {
      const [x, y, w, h] = rectPx(unionBounds(sel.map(bounds)));
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([2 * d, 3 * d]);
      ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
      ctx.globalAlpha = 1;
    }
    ctx.setLineDash([]);

    // handles
    for (const hd of this.handles()) {
      const x = hd.x * d, y = hd.y * d, s = 4 * d;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = accent;
      ctx.beginPath();
      if (hd.kind === 'point') ctx.arc(x, y, s + d, 0, Math.PI * 2);
      else ctx.rect(x - s, y - s, s * 2, s * 2);
      ctx.fill();
      ctx.stroke();
    }

    // table edges you can drag
    if (sel.length === 1 && sel[0].type === 'table' && !state.editing) {
      const o = sel[0], E = tableEdges(o);
      const s = Math.max(3, Math.round(3 * d));
      ctx.fillStyle = accent;
      for (const c of E.cols) ctx.fillRect(Math.round(ox + c.x * cw - s / 2), oy + o.y * ch - s * 3, s, s * 2);
      for (const r of E.rows) ctx.fillRect(ox + o.x * cw - s * 3, Math.round(oy + r.y * ch - s / 2), s * 2, s);
    }

    // text caret (in a text object, or a table cell)
    const t = state.editing && editTarget();
    if (t) {
      const f = t.frame;
      const c = caretCell(f, state.editing.caret);
      const [x, y, w, h] = rectPx({ x: f.x, y: f.y, w: f.w, h: f.h });
      ctx.strokeStyle = accent;
      ctx.setLineDash([2 * d, 2 * d]);
      ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
      ctx.setLineDash([]);
      if (state.editing.fresh) { ctx.fillStyle = accent + '33'; ctx.fillRect(x, y, w, h); }
      ctx.fillStyle = accent;
      ctx.fillRect(ox + (f.x + c.x) * cw, oy + (f.y + c.y) * ch, Math.max(2, Math.round(2 * d)), ch);
    }

    // marquee
    const mq = this.overlay.marquee;
    if (mq) {
      const [x, y, w, h] = rectPx(mq);
      ctx.fillStyle = accent + '22';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = accent;
      ctx.setLineDash([4 * d, 3 * d]);
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.setLineDash([]);
    }
  }
}
