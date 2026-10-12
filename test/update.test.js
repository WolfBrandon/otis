// Updating OTIS from Help → About, against a scratch "GitHub" repository and
// a clone of it standing in for ~/.local/share/otis/app.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.js';

const inContainer = existsSync('/.dockerenv') || existsSync('/run/.containerenv');
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=OTIS', '-c', 'user.email=otis@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' }).toString();
const writeVersion = (dir, version) => fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'otis', version }) + '\n');

let tmp, app, plain;
const servers = [];

async function start(opts) {
  const server = createServer({ dataDir: path.join(tmp, 'data'), publicDir: path.join(tmp, 'public'), ...opts });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}/api/update`;
  return {
    info: async () => (await fetch(base)).json(),
    update: (headers = { 'Content-Type': 'application/json' }) => fetch(base, { method: 'POST', headers, body: '{}' }),
  };
}

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'otis-update-'));
  const origin = path.join(tmp, 'origin.git');
  const work = path.join(tmp, 'work');
  app = path.join(tmp, 'app');
  plain = path.join(tmp, 'plain');
  await fs.mkdir(plain);
  git(tmp, 'init', '--quiet', '--bare', '-b', 'main', origin);
  git(tmp, 'clone', '--quiet', origin, work);
  await writeVersion(work, '1.0.0');
  git(work, 'add', '.');
  git(work, 'commit', '--quiet', '-m', 'v1.0.0');
  git(work, 'push', '--quiet', 'origin', 'HEAD:main');
  git(tmp, 'clone', '--quiet', origin, app);
  // a new release appears on "GitHub"
  await writeVersion(work, '1.1.0');
  git(work, 'commit', '--quiet', '-am', 'v1.1.0');
  git(work, 'push', '--quiet', 'origin', 'HEAD:main');
});

after(async () => {
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise((resolve) => s.close(resolve));
  }
  await fs.rm(tmp, { recursive: true, force: true });
});

test('a folder without git can’t update itself', { skip: inContainer }, async () => {
  const otis = await start({ appDir: plain });
  assert.equal((await otis.info()).kind, 'none');
  assert.equal((await otis.update()).status, 409);
});

test('a clone pulls the new version, then restarts', { skip: inContainer }, async () => {
  let restarts = 0;
  const otis = await start({ appDir: app, restart: () => restarts++ });
  assert.deepEqual(await otis.info(), { kind: 'git', version: '1.0.0' });

  // only JSON requests, which other websites can't send
  assert.equal((await otis.update({ 'Content-Type': 'text/plain' })).status, 415);

  // uncommitted changes: leave the folder alone
  await writeVersion(app, '1.0.0-mine');
  assert.equal((await otis.info()).kind, 'changed');
  assert.equal((await otis.update()).status, 409);
  git(app, 'checkout', '--quiet', '--', 'package.json');

  const res = await otis.update();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { updated: true, from: '1.0.0', to: '1.1.0', restarting: true });
  assert.equal(JSON.parse(await fs.readFile(path.join(app, 'package.json'), 'utf8')).version, '1.1.0');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(restarts, 1);
  assert.equal((await otis.update()).status, 409, 'one update at a time');
});

test('nothing new to pull: no restart', { skip: inContainer }, async () => {
  const otis = await start({ appDir: app }); // after the test above, app is at 1.1.0
  const res = await otis.update();
  assert.deepEqual(await res.json(), { updated: false, from: '1.1.0', to: '1.1.0', restarting: false });
});
