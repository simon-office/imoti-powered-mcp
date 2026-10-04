import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

test('property-search skill exists with required frontmatter fields', async () => {
  const path = new URL('../skills/property-search/SKILL.md', import.meta.url);
  await access(path);
  const skill = await readFile(path, 'utf8');
  const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(frontmatter, 'skill has YAML frontmatter');
  assert.match(frontmatter[1], /^name:\s*\S+/m);
  assert.match(frontmatter[1], /^description:\s*\S+/m);
});

test('plugin manifest retains the task 2 required fields', async () => {
  const manifest = JSON.parse(await readFile(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  assert.match(manifest.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(typeof manifest.description, 'string');
  assert.ok(manifest.description.length > 0);
  assert.deepEqual(manifest.author, { name: 'Simon Office' });
});

test('Node entry points disable ExperimentalWarning without changing their commands', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(packageJson.scripts.test, /node --disable-warning=ExperimentalWarning --test$/);
  assert.match(packageJson.scripts.search, /^node --disable-warning=ExperimentalWarning dist\/cli\.js search$/);
  assert.match(packageJson.scripts.listing, /^node --disable-warning=ExperimentalWarning dist\/cli\.js listing$/);
  const mcp = JSON.parse(await readFile(new URL('../.mcp.json', import.meta.url), 'utf8'));
  assert.deepEqual(mcp.mcpServers.imoti.args, ['--disable-warning=ExperimentalWarning', '${CLAUDE_PLUGIN_ROOT}/dist/main.js']);
});
