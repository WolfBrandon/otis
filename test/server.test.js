import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, defaultDataDir } from '../server.js';

let server, base, port, tmp;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'otis-test-'));
  const dataDir = path.join(tmp, 'data');
  const publicDir = path.join(tmp, 'public');
  const themesDir = path.join(tmp, 'themes');
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(path.join(publicDir, 'index.html'), '<!doctype html><title>OTIS</title>');
  await fs.writeFile(path.join(tmp, 'secret.txt'), 'outside public');
  await fs.mkdir(path.join(themesDir, 'foo'), { recursive: true });
  await fs.writeFile(path.join(themesDir, 'foo', 'colors.toml'), 'background = "#000000"\n');
  await fs.mkdir(path.join(themesDir, 'user', 'bar-baz'), { recursive: true });
  await fs.writeFile(path.join(themesDir, 'user', 'bar-baz', 'colors.toml'), 'background = "#111111"\n');
  server = createServer({ dataDir, publicDir, themeDirs: [themesDir, path.join(tmp, 'missing')] });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  server.closeAllConnections(); // event streams stay open otherwise
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tmp, { recursive: true, force: true });
});

// Raw request so the client doesn't normalize "../" out of the path.
function raw(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const project = { otis: 1, name: 'Test', cols: 80, rows: 24, layers: [] };

test('health', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.name, 'otis');
  assert.equal(body.storage, 'server');
  assert.match(body.version, /^\d+\.\d+\.\d+/);
  assert.equal(typeof body.boot, 'string', 'changes on every start, so windows can tell');
});

test('static index', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /OTIS/);
});

test('path traversal is blocked', async () => {
  for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%2e%2e%2fsecret.txt', '/../server.js']) {
    const res = await raw('GET', p);
    assert.notEqual(res.status, 200, p);
    assert.doesNotMatch(res.body, /outside public/, p);
  }
});

test('missing static file is 404', async () => {
  const res = await fetch(`${base}/nope.js`);
  assert.equal(res.status, 404);
});

test('project put / get / list / delete', async () => {
  let res = await fetch(`${base}/api/projects/demo-1`, { method: 'PUT', body: JSON.stringify(project) });
  assert.equal(res.status, 200);
  const saved = await res.json();
  assert.equal(saved.id, 'demo-1');
  assert.ok(saved.updated);

  res = await fetch(`${base}/api/projects/demo-1`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), project);

  res = await fetch(`${base}/api/projects`);
  const list = await res.json();
  assert.equal(list.length, 1);
  assert.deepEqual(
    { id: list[0].id, name: list[0].name, cols: list[0].cols, rows: list[0].rows, tabs: list[0].tabs },
    { id: 'demo-1', name: 'Test', cols: 80, rows: 24, tabs: 1 },
  );

  res = await fetch(`${base}/api/projects/demo-1`, { method: 'DELETE' });
  assert.equal(res.status, 204);
  res = await fetch(`${base}/api/projects/demo-1`);
  assert.equal(res.status, 404);
  res = await fetch(`${base}/api/projects/demo-1`, { method: 'DELETE' });
  assert.equal(res.status, 404);
});

test('bad project id is 400', async () => {
  for (const id of ['-bad', 'a.b', '%2e%2e', 'x'.repeat(65)]) {
    const res = await raw('PUT', `/api/projects/${id}`, JSON.stringify(project));
    assert.equal(res.status, 400, id);
    assert.ok(JSON.parse(res.body).error);
  }
});

test('bad JSON and non-project bodies are 400', async () => {
  let res = await fetch(`${base}/api/projects/x1`, { method: 'PUT', body: '{nope' });
  assert.equal(res.status, 400);
  res = await fetch(`${base}/api/projects/x1`, { method: 'PUT', body: '{"name":"no otis field"}' });
  assert.equal(res.status, 400);
  res = await fetch(`${base}/api/projects/x1`, { method: 'PUT', body: '[1,2]' });
  assert.equal(res.status, 400);
});

test('body over 20 MB is 413', async () => {
  const big = JSON.stringify({ otis: 1, pad: 'x'.repeat(21 * 1024 * 1024) });
  const res = await fetch(`${base}/api/projects/big`, { method: 'PUT', body: big });
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /too large/);
});

test('library default and roundtrip', async () => {
  let res = await fetch(`${base}/api/library`);
  assert.deepEqual(await res.json(), { snippets: [], palettes: [] });

  const lib = { snippets: [{ id: 's1', name: 'Bar', w: 3, h: 1, objects: [] }], palettes: [{ id: 'p1', name: 'P', colors: {} }] };
  res = await fetch(`${base}/api/library`, { method: 'PUT', body: JSON.stringify(lib) });
  assert.equal(res.status, 200);
  res = await fetch(`${base}/api/library`);
  assert.deepEqual(await res.json(), lib);

  res = await fetch(`${base}/api/library`, { method: 'PUT', body: '{"snippets":[]}' });
  assert.equal(res.status, 400);
});

test('omarchy themes listing', async () => {
  const res = await fetch(`${base}/api/omarchy/themes`);
  const themes = await res.json();
  const byId = Object.fromEntries(themes.map((t) => [t.id, t]));
  assert.deepEqual(Object.keys(byId).sort(), ['bar-baz', 'foo']);
  assert.equal(byId.foo.name, 'Foo');
  assert.match(byId.foo.toml, /#000000/);
  assert.equal(byId['bar-baz'].name, 'Bar Baz');
});

test('unknown api route is 404 json', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  assert.ok((await res.json()).error);
});

test('ETag and If-Match: a stale save is refused with 412', async () => {
  const put = (body, tag) => fetch(`${base}/api/projects/tagged`, {
    method: 'PUT', body: JSON.stringify(body), headers: tag ? { 'If-Match': tag } : {},
  });
  let res = await put(project);
  const first = (await res.json()).etag;
  assert.match(first, /^"[0-9a-f]{16}"$/);
  assert.equal(res.headers.get('etag'), first);

  res = await fetch(`${base}/api/projects/tagged`);
  assert.equal(res.headers.get('etag'), first);

  res = await put({ ...project, name: 'Second' }, first);
  assert.equal(res.status, 200);
  const second = (await res.json()).etag;
  assert.notEqual(second, first);

  res = await put({ ...project, name: 'Stale' }, first);
  assert.equal(res.status, 412);
  assert.equal((await res.json()).etag, second);
  res = await fetch(`${base}/api/projects/tagged`);
  assert.equal((await res.json()).name, 'Second');

  // no If-Match (old clients, imports) still saves
  res = await put({ ...project, name: 'Forced' });
  assert.equal(res.status, 200);
  await fetch(`${base}/api/projects/tagged`, { method: 'DELETE' });
});

test('a save from before a delete doesn’t bring the project back', async () => {
  const put = (body, tag) => fetch(`${base}/api/projects/gone`, {
    method: 'PUT', body: JSON.stringify(body), headers: tag ? { 'If-Match': tag } : {},
  });
  const { etag } = await (await put(project)).json();
  assert.equal((await fetch(`${base}/api/projects/gone`, { method: 'DELETE' })).status, 204);

  // a window that still had it open autosaves with the old ETag
  const res = await put({ ...project, name: 'Stale' }, etag);
  assert.equal(res.status, 412);
  assert.match((await res.json()).error, /deleted/);
  assert.equal((await fetch(`${base}/api/projects/gone`)).status, 404);

  // a new project (no If-Match, or *) is still created
  assert.equal((await put(project, '*')).status, 200);
  assert.equal((await fetch(`${base}/api/projects/gone`, { method: 'DELETE' })).status, 204);
  assert.equal((await put(project)).status, 200);
  await fetch(`${base}/api/projects/gone`, { method: 'DELETE' });
});

// Read Server-Sent Events until `count` have arrived.
function listen(count) {
  return new Promise((resolve, reject) => {
    const events = [];
    const req = http.get({ host: '127.0.0.1', port, path: '/api/events' }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const event = block.match(/^event: (.*)$/m)?.[1];
          const data = block.match(/^data: (.*)$/m)?.[1];
          if (event) events.push({ event, data: JSON.parse(data) });
          if (events.length === count) { req.destroy(); resolve(events); }
        }
      });
    });
    req.on('error', (e) => { if (events.length < count) reject(e); });
  });
}

test('events: saves, deletes and show requests are broadcast', async () => {
  const got = listen(3);
  await new Promise((r) => setTimeout(r, 50));
  const res = await fetch(`${base}/api/projects/live`, { method: 'PUT', body: JSON.stringify(project), headers: { 'X-OTIS-Client': 'mcp' } });
  const { etag } = await res.json();
  let shown = await fetch(`${base}/api/show`, { method: 'POST', body: JSON.stringify({ id: 'live' }) });
  assert.equal((await shown.json()).windows, 1);
  await fetch(`${base}/api/projects/live`, { method: 'DELETE' });
  const events = await got;
  assert.deepEqual(events, [
    { event: 'project', data: { id: 'live', etag, name: 'Test', by: 'mcp' } },
    { event: 'show', data: { id: 'live', tab: null } },
    { event: 'deleted', data: { id: 'live' } },
  ]);
  shown = await fetch(`${base}/api/show`, { method: 'POST', body: JSON.stringify({ id: '../x' }) });
  assert.equal(shown.status, 400);
});

test('current project: the browser reports it, the MCP reads it', async () => {
  let res = await fetch(`${base}/api/current`);
  const empty = await res.json();
  assert.deepEqual([empty.id, empty.selection], [null, []]);
  res = await fetch(`${base}/api/current`, { method: 'PUT', body: JSON.stringify({ id: 'abc', tab: 't2', selection: ['o1', 2] }) });
  assert.deepEqual(await res.json(), { id: 'abc', tab: 't2', selection: ['o1'] });
  res = await fetch(`${base}/api/current`);
  assert.equal((await res.json()).id, 'abc');
  res = await fetch(`${base}/api/current`, { method: 'PUT', body: JSON.stringify({ id: '../etc' }) });
  assert.equal((await res.json()).id, null);
});

test('default data folder: ./data, or ~/.local/share/otis when the app folder is read-only', async () => {
  const app = path.join(tmp, 'app');
  await fs.mkdir(app);
  assert.equal(defaultDataDir(app), path.join(app, 'data'));
  await fs.chmod(app, 0o555);
  try {
    if (process.getuid?.() === 0) return; // root can write anywhere
    assert.equal(defaultDataDir(app, { XDG_DATA_HOME: '/x/share' }), '/x/share/otis');
    assert.equal(defaultDataDir(app, { HOME: '/home/u' }), '/home/u/.local/share/otis');
  } finally {
    await fs.chmod(app, 0o755);
  }
});
