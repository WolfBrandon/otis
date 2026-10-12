// OTIS entry point: wires the renderer, tools, panels and storage together.

import { state, on, emit, setProject, replaceProject, gestureActive, switchTab } from './state.js';
import { Renderer } from './render.js';
import { initTools, commands } from './tools.js';
import { initPanels, hooks } from './panels.js';
import { textArtDialog } from './artdialog.js';
import { initTabs } from './tabs.js';
import { initSidebar } from './sidebar.js';
import { initLibrary } from './library.js';
import { initMenus, chromeFollows } from './menus.js';
import { detectStorage, storage, lastProject, appVersion } from './storage.js';
import { sampleProject } from './snippets.js';
import { setRenderer } from './actions.js';
import { mix, contrastText } from './color.js';
import { defaultFont } from './fonts.js';
import { $, el, toast } from './ui.js';
import { REPO_URL, justUpdated } from './version.js';

const renderer = new Renderer($('#canvas'));
setRenderer(renderer);
window.OTIS = { state, renderer };   // handy from the browser console

// ── App colors follow the project palette (Omarchy-style) ────────────────────

const CHROME_VARS = ['--stage', '--bg', '--panel', '--panel-2', '--text', '--muted', '--border', '--accent', '--accent-text', '--hover', '--sel'];
let chromeKey = '';

function applyChrome(force = false) {
  const pal = state.project?.palette;
  const key = chromeFollows() + JSON.stringify(pal?.colors);
  if (!force && key === chromeKey) return;
  chromeKey = key;
  const root = document.documentElement;
  if (!pal || !chromeFollows()) {
    CHROME_VARS.forEach(v => root.style.removeProperty(v));
    delete root.dataset.mode;
  } else {
    const c = pal.colors;
    const bg = c.background || '#1a1b26', fg = c.foreground || '#c0caf5';
    const set = (k, v) => v && root.style.setProperty(k, v);
    set('--stage', c.darker_background || mix(bg, '#000000', 0.3));
    set('--bg', c.dark_background || bg);
    set('--panel', c.dark_background || bg);
    set('--panel-2', c.lighter_background || mix(bg, fg, 0.08));
    set('--text', fg);
    set('--muted', mix(fg, bg, 0.4));
    set('--border', mix(bg, fg, 0.16));
    set('--accent', c.accent || c.blue);
    set('--accent-text', contrastText(c.accent || c.blue || '#7aa2f7'));
    set('--hover', mix(c.dark_background || bg, fg, 0.08));
    set('--sel', c.selection || mix(bg, c.accent || fg, 0.25));
    root.dataset.mode = pal.mode || 'dark';
  }
  renderer.refreshChrome();
}

// ── Saving ───────────────────────────────────────────────────────────────────

let saveTimer = null;
let saving = null;
const status = text => { $('#save-status').textContent = text; };

async function saveNow(announce = false) {
  clearTimeout(saveTimer);
  if (!state.project || (!state.dirty && !announce)) return;
  if (saving) await saving;
  status('Saving…');
  const p = state.project;
  saving = storage.saveProject(p).then(() => {
    if (state.project === p) state.dirty = false;
    lastProject.set(p.id);
    status('Saved');
    if (announce) toast('Saved');
  }).catch(e => {
    if (e.status === 412) {
      // the AI or another window saved this project since we loaded it
      status('Changed elsewhere');
      return syncSoon(true);
    }
    status('Not saved');
    toast('Save failed: ' + e.message, 5000);
  }).finally(() => { saving = null; });
  return saving;
}

// ── Live updates ─────────────────────────────────────────────────────────────
// The MCP server (an AI drawing in OTIS) and other windows save through the
// same server, which announces every save. A project that changed elsewhere
// reloads here; the version it replaces goes on the undo stack.

let syncTimer = null;
let remoteTag = null;   // ETag from the latest save announced for the open project
let lastBy = '';        // who saved it: 'mcp' for the AI
let conflicted = false;

// Reload the open project from the server once nothing is in progress.
// `conflict`: our save was refused, so reload even with unsaved edits
// (they stay one Ctrl+Z away).
function syncSoon(conflict = false) {
  conflicted ||= conflict;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    const p = state.project;
    if (!p) return;
    if (saving || gestureActive() || state.editing || (state.dirty && !conflicted)) return syncSoon();
    if (!conflicted && remoteTag === storage.etag(p.id)) return;
    let fresh;
    try { fresh = await storage.loadProject(p.id); } catch { return; }
    if (state.project !== p) return;
    const lost = conflicted && state.dirty;
    conflicted = false;
    const before = new Map(p.tabs.map(t => [t.id, JSON.stringify(t)]));
    replaceProject(fresh);
    status('Saved');
    // say so when the change was on a tab other than the open one
    const changed = state.project.tabs.filter(t => before.get(t.id) !== JSON.stringify(t));
    const elsewhere = changed.length && !changed.some(t => t.id === state.tabId)
      ? ` on tab \u201c${changed[0].name}\u201d` : '';
    toast(lost
      ? 'This project was changed outside this window, so your last edit wasn\u2019t saved. Ctrl+Z brings it back.'
      : (lastBy === 'mcp' ? 'Updated by the AI' : 'Updated in another window') + elsewhere + ' \u2014 Ctrl+Z to undo', lost ? 8000 : 4000);
  }, 250);
}

// Open a project (and tab) the AI asked to show, or a #p=<id> link.
async function openProject(id, tab = null) {
  if (!id) return;
  if (gestureActive()) return setTimeout(() => openProject(id, tab), 500);
  if (id !== state.project?.id) {
    await saveNow();
    try {
      const p = await storage.loadProject(id);
      setProject(p);
      lastProject.set(id);
      status('Saved');
      toast(`Opened \u201c${p.name || 'Untitled'}\u201d`);
    } catch (e) { toast('Could not open the project: ' + e.message, 5000); return; }
  }
  if (tab && state.project.id === id) switchTab(tab);
}

let reportTimer = null;
function reportCurrent() {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => storage.setCurrent(state.project?.id, state.tabId, state.selection), 300);
}
on('project', reportCurrent);
on('tab', reportCurrent);
on('selection', reportCurrent);

on('dirty', () => {
  status('Editing…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 800);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
window.addEventListener('beforeunload', e => { if (state.dirty) { saveNow(); e.preventDefault(); } });

// Where projects are saved, in the status bar. Without the OTIS server (the
// online demo) that's this browser, so point people at the full version once.
function showStorage() {
  const cell = $('#st-storage');
  if (storage.kind !== 'local') { cell.textContent = storage.label; return; }
  cell.replaceChildren(storage.label + ' · ',
    el('a', { href: REPO_URL + '#install', target: '_blank', rel: 'noopener' }, 'Get OTIS'));
  let seen = true;
  try { seen = !!localStorage.getItem('otis:welcomed'); localStorage.setItem('otis:welcomed', '1'); } catch {}
  if (!seen) toast('You\u2019re using OTIS in the browser: designs stay in this browser. Install OTIS for your own Omarchy themes and AI drawing (\u201cGet OTIS\u201d, bottom right).', 9000);
}

// When the server comes back on a new version (OTIS updated itself), save and
// reload, so this window runs the same code as the server.
async function reloadIfUpdated() {
  const h = await storage.health().catch(() => null);
  if (!h?.version || !appVersion || h.version === appVersion) return;
  await saveNow();
  justUpdated.set(h.version);
  location.reload();
}

// ── Boot ─────────────────────────────────────────────────────────────────────

on('doc', () => applyChrome());
on('project', () => { applyChrome(); requestAnimationFrame(() => renderer.fit()); });
on('chrome', () => applyChrome(true));

async function boot() {
  initSidebar();
  initTools(renderer);
  initPanels();
  initTabs();
  hooks.textArt = commands.textArt = o => textArtDialog(o);
  initMenus(renderer, saveNow);
  await detectStorage();
  showStorage();
  const updated = justUpdated.take();
  if (updated && updated === appVersion) toast(`OTIS updated to ${updated}. Help → About → What’s new lists the changes.`, 6000);

  try { state.library = await storage.loadLibrary(); }
  catch { state.library = { snippets: [], palettes: [] }; }
  state.library.snippets ||= [];
  state.library.palettes ||= [];

  let project = null;
  const linked = location.hash.match(/^#p=([\w-]+)/)?.[1];
  for (const id of [linked, lastProject.get()]) {
    if (!project && id) { try { project = await storage.loadProject(id); lastProject.set(id); } catch {} }
  }
  setProject(project || sampleProject(defaultFont()));
  status(project ? 'Saved' : '');
  if (linked) history.replaceState(null, '', location.pathname);
  storage.listen({
    project: ({ id, etag, by }) => {
      if (id !== state.project?.id || etag === storage.etag(id)) return;
      remoteTag = etag;
      lastBy = by;
      syncSoon();
    },
    show: ({ id, tab }) => openProject(id, tab),
    open: () => { reportCurrent(); reloadIfUpdated(); },   // (re)connected: the server may have restarted
  });
  window.addEventListener('hashchange', () => {
    const id = location.hash.match(/^#p=([\w-]+)/)?.[1];
    if (id) { history.replaceState(null, '', location.pathname); openProject(id); }
  });
  await initLibrary();
  renderer.refreshChrome();
  emit('tool');
  emit('view');
}

boot().catch(e => { console.error(e); toast('OTIS failed to start: ' + e.message, 10000); });
