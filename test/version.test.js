import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compareVersions } from '../public/js/version.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const changelog = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

test('package.json has a MAJOR.MINOR.PATCH version', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});

test('the newest CHANGELOG entry matches package.json', () => {
  // an "## [Unreleased]" section may sit above it
  const top = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m);
  assert.ok(top, 'CHANGELOG.md needs a "## [x.y.z] - date" entry');
  assert.equal(top[1], pkg.version, 'bump package.json and CHANGELOG.md together');
});

test('compareVersions compares numerically', () => {
  assert.equal(compareVersions('0.2.0', '0.2.0'), 0);
  assert.equal(compareVersions('v0.2.0', '0.2.0'), 0);
  assert.equal(compareVersions('0.9.0', '0.10.0'), -1);
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
  assert.equal(compareVersions('0.2.1', '0.2.0'), 1);
  assert.equal(compareVersions('0.2', '0.2.0'), 0);
});

test('the AUR PKGBUILD packages the same version', () => {
  const pkgbuild = fs.readFileSync(new URL('../packaging/aur/PKGBUILD', import.meta.url), 'utf8');
  assert.equal(pkgbuild.match(/^pkgver=(.+)$/m)?.[1], pkg.version, 'set pkgver in packaging/aur/PKGBUILD too');
});
