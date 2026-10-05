import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { VERSION } from '../src/version.ts';

test('VERSION matches the package version', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const pluginJson = JSON.parse(await readFile(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, packageJson.version);
  assert.equal(pluginJson.version, packageJson.version);
});

test('candidate changelog summarizes current capabilities and limitations', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.ok(changelog.includes(`## [${packageJson.version}] - 2026-10-05`));
  assert.match(changelog, /2026-10-05/);
  for (const capability of [
    /search(?:es|ing)?(?: Bulgarian property)? listings/i,
    /memory|saved searches|watchlists/i,
    /change digest|changes/i,
    /photo/i,
    /location/i,
    /setup/i,
    /configurable.{0,30}limits|limits.{0,30}configurable/i,
    /limitations|uncertainty/i,
  ]) assert.match(changelog, capability);
});
