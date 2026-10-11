import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let server, base, tmp, child;
let nextId = 0;
const waiting = new Map();

// One JSON-RPC request to the MCP server over its stdin/stdout.
function rpc(method, params) {
  return new Promise((resolve) => {
    const id = ++nextId;
    waiting.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

async function tool(name, args = {}) {
  const res = await rpc('tools/call', { name, arguments: args });
  return { text: res.result.content[0].text, isError: res.result.isError };
}

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'otis-mcp-'));
  server = createServer({ dataDir: tmp, themeDirs: [] });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  child = spawn(process.execPath, [path.join(ROOT, 'mcp.js')], { env: { ...process.env, OTIS_URL: base } });
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiting.get(msg.id)?.(msg);
    }
  });
});

after(async () => {
  child.stdin.end();
  await new Promise((resolve) => child.on('exit', resolve));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tmp, { recursive: true, force: true });
});

test('legacy handshake: initialize echoes a known version', async () => {
  let res = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(res.result.protocolVersion, '2025-06-18');
  assert.deepEqual(res.result.capabilities, { tools: {} });
  assert.equal(res.result.serverInfo.name, 'otis');
  assert.match(res.result.instructions, /character cells/);
  res = await rpc('initialize', { protocolVersion: '1999-01-01', capabilities: {} });
  assert.equal(res.result.protocolVersion, '2025-11-25');
});

test('modern requests: discover, per-request version, unsupported version', async () => {
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
  let res = await rpc('server/discover', { _meta: meta });
  assert.equal(res.result.resultType, 'complete');
  assert.ok(res.result.supportedVersions.includes('2026-07-28'));
  assert.equal(res.result._meta['io.modelcontextprotocol/serverInfo'].name, 'otis');
  assert.equal(res.result.cacheScope, 'public');
  res = await rpc('tools/list', { _meta: meta });
  assert.equal(res.result.resultType, 'complete');
  assert.ok(res.result.ttlMs > 0);
  assert.equal(res.result.cacheScope, 'public');
  res = await rpc('tools/list', { _meta: { ...meta, 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } });
  assert.equal(res.error.code, -32022);
  assert.equal(res.error.data.requested, '1900-01-01');
  res = await rpc('nope/nothing', {});
  assert.equal(res.error.code, -32601);
  assert.deepEqual((await rpc('ping', {})).result, { resultType: 'complete' });
});

test('tools/list describes every tool with a schema', async () => {
  const { result } = await rpc('tools/list', {});
  const names = result.tools.map((t) => t.name);
  for (const n of ['list_projects', 'render', 'create_project', 'add_objects', 'update_objects', 'delete_objects', 'insert_snippet', 'show_project']) {
    assert.ok(names.includes(n), n);
  }
  for (const t of result.tools) {
    assert.equal(t.inputSchema.type, 'object', t.name);
    assert.ok(t.description, t.name);
    assert.equal(t.run, undefined);
  }
  assert.equal(result.tools.find((t) => t.name === 'render').annotations.readOnlyHint, true);
});

test('no open project: a clear error, not a guess', async () => {
  const r = await tool('render');
  assert.equal(r.isError, true);
  assert.match(r.text, /No OTIS window has a project open/);
});

test('create, render, change and delete a design', async () => {
  let r = await tool('create_project', {
    name: 'Monitor', cols: 40, rows: 10, show: false,
    objects: [
      { type: 'box', x: 0, y: 0, w: 40, h: 10, border: 'rounded', title: 'top', color: 'red' },
      { type: 'line', points: [[20, 0], [20, 9]], end: 'none' },
      { type: 'table', x: 2, y: 2, cells: [['PID', 'CPU'], ['1', '0.1%']], aligns: ['right', 'right'] },
    ],
  });
  assert.equal(r.isError, false);
  assert.match(r.text, /Ignored "color" on box \(did you mean "fg"\?\)/);
  assert.match(r.text, /╭─ top ─+┬─+╮/);          // the divider joins the border
  assert.match(r.text, /│ PID │  CPU │/);           // widths fit the content, right-aligned
  const id = r.text.match(/\(id (\w+)\)/)[1];

  // the server has it, and the MCP saved through the API
  const saved = await (await fetch(`${base}/api/projects/${id}`)).json();
  assert.equal(saved.layers[0].objects.length, 3);
  const [box, line, table] = saved.layers[0].objects;

  // tools default to the project the browser reports as open
  await fetch(`${base}/api/current`, { method: 'PUT', body: JSON.stringify({ id, selection: [table.id] }) });
  r = await tool('render');
  assert.match(r.text, new RegExp(`table · ${table.id} · x=2 y=2 .*← selected in OTIS`));
  assert.match(r.text, /^ *0 {9}10 {8}20 {8}30$/m);   // column ruler

  r = await tool('update_objects', { changes: [{ id: table.id, move: [1, 1] }, { id: box.id, title: 'Processes' }] });
  assert.equal(r.isError, false);
  assert.match(r.text, /╭─ Processes ─/);
  r = await tool('add_objects', { objects: [{ type: 'text', x: 23, y: 2, text: 'Memory', bold: true, fg: 'accent' }] });
  assert.match(r.text, /^2││ +│  Memory/m);

  r = await tool('delete_objects', { ids: [line.id, 'missing'] });
  assert.match(r.text, /Deleted 1 object/);
  assert.match(r.text, /No object "missing"/);
  const after = await (await fetch(`${base}/api/projects/${id}`)).json();
  assert.equal(after.layers[0].objects.length, 3);
  assert.equal(after.layers[0].objects.find((o) => o.id === table.id).x, 3);
});

test('bad input comes back as a tool error the AI can fix', async () => {
  const p = await tool('create_project', { name: 'Errors', show: false });
  const id = p.text.match(/\(id (\w+)\)/)[1];
  let r = await tool('add_objects', { project: id, objects: [{ type: 'circle', x: 1, y: 1 }] });
  assert.equal(r.isError, true);
  assert.match(r.text, /Unknown object type "circle"/);
  r = await tool('add_objects', { project: 'Errors', objects: [{ type: 'line', points: [[1, 1]] }] });
  assert.match(r.text, /needs "points"/);
  r = await tool('render', { project: 'nope' });
  assert.match(r.text, /There's no project "nope"/);
});

test('snippets, layers and themes', async () => {
  const p = await tool('create_project', { name: 'Kit', cols: 60, rows: 12, show: false, theme: 'tokyo-night' });
  const id = p.text.match(/\(id (\w+)\)/)[1];
  let r = await tool('insert_snippet', { project: id, snippet: 'Sparkline', x: 2, y: 2 });
  assert.match(r.text, /Inserted "Sparkline"/);
  r = await tool('edit_layer', { project: id, action: 'add', name: 'Popup' });
  assert.match(r.text, /Layer 2 "Popup"/);
  r = await tool('get_palette', { project: id });
  assert.match(r.text, /Tokyo Night/);
  assert.match(r.text, /accent +#[0-9a-f]{6}/);
  r = await tool('update_project', { project: id, theme: 'nord', cols: 80 });
  const saved = await (await fetch(`${base}/api/projects/${id}`)).json();
  assert.equal(saved.palette.id, 'nord');
  assert.equal(saved.cols, 80);
});
