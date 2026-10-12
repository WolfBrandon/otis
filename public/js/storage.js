// Saving and loading. With the OTIS server, projects and the library are
// files in its data folder. Opened as static files (no server), it falls back
// to the browser's localStorage.

const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// Errors carry the HTTP status; 412 means the project changed elsewhere.
async function api(method, path, body, headers = {}) {
  const res = await fetch('api/' + path, {
    method,
    cache: 'no-store',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch {}
    throw Object.assign(new Error(msg), { status: res.status });
  }
  if (res.status === 204) return null;
  const data = await res.json();
  return path.startsWith('projects/') && method === 'GET' ? { data, etag: res.headers.get('ETag') } : data;
}

// The ETag of each project as we last loaded or saved it. Saves send it back
// (If-Match) so they can't overwrite a change made by the AI or another window.
const etags = new Map();

const server = {
  kind: 'server',
  label: 'Saved on the OTIS server',
  listProjects: () => api('GET', 'projects'),
  async loadProject(id) {
    const { data, etag } = await api('GET', 'projects/' + encodeURIComponent(id));
    etags.set(id, etag);
    return data;
  },
  async saveProject(p) {
    const tag = etags.get(p.id);
    const r = await api('PUT', 'projects/' + encodeURIComponent(p.id), p, tag ? { 'If-Match': tag } : {});
    etags.set(p.id, r.etag);
    return r;
  },
  deleteProject: id => api('DELETE', 'projects/' + encodeURIComponent(id)),
  loadLibrary: () => api('GET', 'library'),
  saveLibrary: lib => api('PUT', 'library', lib),
  omarchyThemes: () => api('GET', 'omarchy/themes').catch(() => []),
  etag: id => etags.get(id),
  // Live updates: handlers = { project, deleted, show, open }
  listen(handlers) {
    const es = new EventSource('api/events');
    es.addEventListener('open', () => handlers.open?.());
    for (const name of ['project', 'deleted', 'show'])
      es.addEventListener(name, e => { try { handlers[name]?.(JSON.parse(e.data)); } catch {} });
  },
  // Tell the server what's open, for the MCP tools.
  setCurrent: (id, tab, selection = []) => api('PUT', 'current', { id, tab, selection }).catch(() => {}),
  health: () => api('GET', 'health'),
  // Updating OTIS itself (Help → About): {kind} says whether it can.
  updateInfo: () => api('GET', 'update'),
  update: () => api('POST', 'update', {}),
};

const local = {
  kind: 'local',
  label: 'Saved in this browser',
  async listProjects() {
    return Object.values(LS.get('otis:index', {})).sort((a, b) => b.updated.localeCompare(a.updated));
  },
  async loadProject(id) {
    const p = LS.get('otis:project:' + id);
    if (!p) throw new Error('Project not found');
    return p;
  },
  async saveProject(p) {
    LS.set('otis:project:' + p.id, p);
    const idx = LS.get('otis:index', {});
    const updated = new Date().toISOString();
    idx[p.id] = { id: p.id, name: p.name, cols: p.tabs[0].cols, rows: p.tabs[0].rows, tabs: p.tabs.length, updated };
    LS.set('otis:index', idx);
    return { id: p.id, updated };
  },
  async deleteProject(id) {
    LS.del('otis:project:' + id);
    const idx = LS.get('otis:index', {});
    delete idx[id];
    LS.set('otis:index', idx);
  },
  async loadLibrary() { return LS.get('otis:library', { snippets: [], palettes: [] }); },
  async saveLibrary(lib) { LS.set('otis:library', lib); },
  async omarchyThemes() { return []; },
  etag: () => null,
  listen() {},
  setCurrent() {},
  async health() { return null; },
  async updateInfo() { return null; },
};

export let storage = local;
export let appVersion = null;

export async function detectStorage() {
  try {
    const res = await fetch('api/health', { cache: 'no-store' });
    const health = res.ok ? await res.json() : {};
    if (health.storage === 'server') { storage = server; appVersion = health.version || null; }
  } catch {}
  // As static files (the online demo), the version comes from version.json,
  // which the GitHub Pages workflow writes.
  if (storage === local) {
    try { appVersion = (await (await fetch('version.json', { cache: 'no-store' })).json()).version || null; } catch {}
  }
  return storage;
}

export const lastProject = {
  get: () => LS.get('otis:last'),
  set: id => { try { LS.set('otis:last', id); } catch {} },
};
