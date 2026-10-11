// OTIS server: serves the web app from ./public and stores projects and the
// snippet/palette library as JSON files in DATA_DIR. Node stdlib only.
//
// Every saved project has an ETag (a hash of the file). A save that sends
// If-Match with an old tag is refused with 412, so the browser and the MCP
// server (mcp.js) never overwrite each other's changes. Browsers listen on
// /api/events and reload a project when it changes elsewhere.
//
// There is no authentication. OTIS is meant for a desktop or a homelab LAN;
// put it behind a reverse proxy with auth before exposing it anywhere else.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 20 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const EMPTY_LIBRARY = { snippets: [], palettes: [] };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.flf': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readVersion() {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(HERE, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function sendJson(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-cache',
    ...headers,
  });
  res.end(body);
}

const etagOf = (text) => '"' + crypto.createHash('sha1').update(text).digest('hex').slice(0, 16) + '"';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const tooBig = () => new HttpError(413, 'Request body too large (limit 20 MB)');
    if (Number(req.headers['content-length']) > MAX_BODY) {
      req.resume(); // discard the upload so the 413 can be sent
      return reject(tooBig());
    }
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk) => {
      if (over) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        over = true;
        chunks.length = 0;
        reject(tooBig());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!over) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const text = await readBody(req);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Body is not valid JSON');
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Write to a temp file in the same directory, then rename over the target,
// so a crash mid-write never leaves a half-written project behind.
async function writeAtomic(file, text) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, file);
}

function titleCase(id) {
  return id.split(/[-_]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

export function createServer({
  dataDir = path.join(HERE, 'data'),
  themeDirs = ['/themes'],
  publicDir = path.join(HERE, 'public'),
} = {}) {
  dataDir = path.resolve(dataDir);
  publicDir = path.resolve(publicDir);
  const projectsDir = path.join(dataDir, 'projects');
  const libraryFile = path.join(dataDir, 'library.json');
  const versionPromise = readVersion();
  const ready = fs.mkdir(projectsDir, { recursive: true });

  // Live updates over Server-Sent Events.
  const listeners = new Set();
  const broadcast = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of listeners) res.write(msg);
  };
  // What the browser has open, so MCP tools can default to it.
  let current = { id: null, tab: null, selection: [] };

  // One save at a time per project, so the If-Match check and the write
  // can't interleave with another save.
  const locks = new Map();
  const withLock = (id, fn) => {
    const run = (locks.get(id) || Promise.resolve()).then(fn);
    const tail = run.catch(() => {});
    locks.set(id, tail);
    tail.then(() => { if (locks.get(id) === tail) locks.delete(id); });
    return run;
  };

  const projectFile = (id) => {
    if (!ID_RE.test(id)) throw new HttpError(400, 'Invalid project id');
    return path.join(projectsDir, `${id}.otis.json`);
  };

  async function listProjects() {
    const names = await fs.readdir(projectsDir).catch(() => []);
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.otis.json')) continue;
      const file = path.join(projectsDir, name);
      try {
        const [stat, text] = await Promise.all([fs.stat(file), fs.readFile(file, 'utf8')]);
        const p = JSON.parse(text);
        const first = p.tabs?.[0] || p; // files from before tabs keep the size at the top
        out.push({
          id: name.slice(0, -'.otis.json'.length),
          name: p.name || '',
          cols: first.cols,
          rows: first.rows,
          tabs: p.tabs?.length || 1,
          updated: stat.mtime.toISOString(),
        });
      } catch {
        // skip unreadable or corrupt files
      }
    }
    out.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
    return out;
  }

  // A theme is a folder with a colors.toml. Theme dirs may hold themes
  // directly (/themes/tokyo-night) or one level down (/themes/user/tokyo-night),
  // which is how compose.yaml mounts them.
  async function scanThemes(dir, depth, out) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // missing theme dirs are fine
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sub = path.join(dir, entry.name);
      try {
        const toml = await fs.readFile(path.join(sub, 'colors.toml'), 'utf8');
        out.push({ id: entry.name, name: titleCase(entry.name), source: dir, toml });
      } catch {
        if (depth > 0) await scanThemes(sub, depth - 1, out);
      }
    }
  }

  async function listThemes() {
    const out = [];
    for (const dir of themeDirs) await scanThemes(dir, 1, out);
    return out;
  }

  async function handleApi(req, res, pathname) {
    const method = req.method;
    const parts = pathname.split('/').filter(Boolean).slice(1); // drop "api"

    if (parts.length === 1 && parts[0] === 'health' && method === 'GET') {
      return sendJson(res, 200, { ok: true, name: 'otis', version: await versionPromise, storage: 'server' });
    }

    if (parts[0] === 'projects') {
      if (parts.length === 1 && method === 'GET') return sendJson(res, 200, await listProjects());
      if (parts.length === 2) {
        const id = parts[1];
        const file = projectFile(id);
        if (method === 'GET') {
          let text;
          try {
            text = await fs.readFile(file, 'utf8');
          } catch {
            throw new HttpError(404, 'Project not found');
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', ETag: etagOf(text) });
          return res.end(text);
        }
        if (method === 'PUT') {
          const body = await readJsonBody(req);
          if (!isPlainObject(body) || !('otis' in body)) throw new HttpError(400, 'Not an OTIS project (missing "otis" field)');
          const ifMatch = req.headers['if-match'];
          const by = String(req.headers['x-otis-client'] || '').replace(/[^a-z0-9-]/gi, '').slice(0, 20);
          return withLock(id, async () => {
            if (ifMatch && ifMatch !== '*') {
              const old = await fs.readFile(file, 'utf8').catch(() => null);
              if (old !== null && etagOf(old) !== ifMatch) {
                return sendJson(res, 412, { error: 'The project was changed somewhere else since you loaded it', etag: etagOf(old) });
              }
            }
            const text = JSON.stringify(body, null, 2);
            await writeAtomic(file, text);
            const stat = await fs.stat(file);
            const etag = etagOf(text);
            broadcast('project', { id, etag, name: body.name || '', by });
            return sendJson(res, 200, { id, updated: stat.mtime.toISOString(), etag }, { ETag: etag });
          });
        }
        if (method === 'DELETE') {
          try {
            await fs.unlink(file);
          } catch {
            throw new HttpError(404, 'Project not found');
          }
          broadcast('deleted', { id });
          res.writeHead(204);
          return res.end();
        }
        throw new HttpError(405, 'Method not allowed');
      }
    }

    if (parts.length === 1 && parts[0] === 'library') {
      if (method === 'GET') {
        try {
          const text = await fs.readFile(libraryFile, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
          return res.end(text);
        } catch {
          return sendJson(res, 200, EMPTY_LIBRARY);
        }
      }
      if (method === 'PUT') {
        const body = await readJsonBody(req);
        if (!isPlainObject(body) || !Array.isArray(body.snippets) || !Array.isArray(body.palettes)) {
          throw new HttpError(400, 'Library needs "snippets" and "palettes" arrays');
        }
        await writeAtomic(libraryFile, JSON.stringify(body, null, 2));
        return sendJson(res, 200, { ok: true });
      }
      throw new HttpError(405, 'Method not allowed');
    }

    if (parts.length === 2 && parts[0] === 'omarchy' && parts[1] === 'themes' && method === 'GET') {
      return sendJson(res, 200, await listThemes());
    }

    // Server-Sent Events: "project" {id, etag, by} after every save,
    // "deleted" {id}, and "show" {id, tab} when the MCP asks windows to open one.
    if (parts.length === 1 && parts[0] === 'events' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      listeners.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      ping.unref();
      req.on('close', () => { clearInterval(ping); listeners.delete(res); });
      return;
    }

    // The project (and selection) open in the browser. The browser reports
    // it; the MCP server reads it.
    if (parts.length === 1 && parts[0] === 'current') {
      if (method === 'GET') return sendJson(res, 200, { ...current, windows: listeners.size });
      if (method === 'PUT') {
        const body = await readJsonBody(req);
        const id = isPlainObject(body) && typeof body.id === 'string' && ID_RE.test(body.id) ? body.id : null;
        const tab = typeof body?.tab === 'string' ? body.tab.slice(0, 64) : null;
        const selection = Array.isArray(body?.selection) ? body.selection.filter((s) => typeof s === 'string').slice(0, 500) : [];
        current = { id, tab, selection };
        return sendJson(res, 200, current);
      }
      throw new HttpError(405, 'Method not allowed');
    }

    // Ask open windows to switch to a project.
    if (parts.length === 1 && parts[0] === 'show' && method === 'POST') {
      const body = await readJsonBody(req);
      const id = isPlainObject(body) ? String(body.id || '') : '';
      projectFile(id); // validates the id
      const tab = typeof body.tab === 'string' ? body.tab.slice(0, 64) : null;
      broadcast('show', { id, tab });
      return sendJson(res, 200, { id, tab, windows: listeners.size });
    }

    throw new HttpError(404, 'Not found');
  }

  async function handleStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      throw new HttpError(400, 'Bad path');
    }
    if (rel.includes('\0')) throw new HttpError(400, 'Bad path');
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(publicDir, '.' + rel);
    if (file !== publicDir && !file.startsWith(publicDir + path.sep)) throw new HttpError(404, 'Not found');
    let data;
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) throw new Error('not a file');
      data = await fs.readFile(file);
    } catch {
      throw new HttpError(404, 'Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  const server = http.createServer(async (req, res) => {
    try {
      await ready;
      // Parse the path without letting the URL parser resolve "..": we want to
      // see traversal attempts and reject them ourselves.
      const rawPath = (req.url || '/').split('?')[0].split('#')[0];
      const pathname = rawPath.startsWith('/') ? rawPath : '/' + rawPath;
      if (pathname === '/api' || pathname.startsWith('/api/')) await handleApi(req, res, pathname);
      else await handleStatic(req, res, pathname);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { error: err.message || 'Server error' });
      else res.end();
    }
  });
  return server;
}

// Where projects go without DATA_DIR: ./data next to OTIS, or, when OTIS is
// installed somewhere read-only (a system package in /usr/share/otis), the
// usual per-user place, ~/.local/share/otis.
export function defaultDataDir(appDir = HERE, env = process.env) {
  try {
    fsSync.accessSync(appDir, fsSync.constants.W_OK);
    return path.join(appDir, 'data');
  } catch {
    const base = env.XDG_DATA_HOME || path.join(env.HOME || os.homedir(), '.local', 'share');
    return path.join(base, 'otis');
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const PORT = Number(process.env.PORT || 6847);
  const HOST = process.env.HOST || '0.0.0.0';
  const DATA_DIR = process.env.DATA_DIR ? path.resolve(HERE, process.env.DATA_DIR) : defaultDataDir();
  // the Docker image's /themes, and your own Omarchy themes
  const userThemes = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'omarchy', 'themes');
  const THEME_DIRS = (process.env.THEME_DIRS || `/themes:${userThemes}`).split(':').filter(Boolean);
  createServer({ dataDir: DATA_DIR, themeDirs: THEME_DIRS }).listen(PORT, HOST, () => {
    console.log(`OTIS listening on http://${HOST}:${PORT} (data: ${DATA_DIR})`);
  });
}
