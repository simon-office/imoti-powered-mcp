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
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(typeof manifest.description, 'string');
  assert.ok(manifest.description.length > 0);
  assert.deepEqual(manifest.author, { name: 'Simon Office' });
  assert.deepEqual(manifest.compatibility, { platforms: ['darwin', 'linux', 'win32'], runtimes: { node: '>=24.0.0' } });
  assert.deepEqual(manifest.mcpServers, {
    imoti: {
      command: 'node',
      args: ['--disable-warning=ExperimentalWarning', '${CLAUDE_PLUGIN_ROOT}/dist/main.js'],
      cwd: '${CLAUDE_PLUGIN_ROOT}'
    }
  });
});

test('marketplace registers this repository root as the plugin source', async () => {
  const marketplace = JSON.parse(await readFile(new URL('../.claude-plugin/marketplace.json', import.meta.url), 'utf8'));
  assert.equal(marketplace.name, 'imoti-powered-mcp');
  assert.ok(marketplace.owner?.name);
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, 'imoti-powered-mcp');
  assert.equal(marketplace.plugins[0].source, './');
});

test('project does not register a second MCP server at the repository root', async () => {
  await assert.rejects(access(new URL('../.mcp.json', import.meta.url)), { code: 'ENOENT' });
});

test('Node entry points disable ExperimentalWarning without changing their commands', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(packageJson.scripts.test, /node --disable-warning=ExperimentalWarning --test$/);
  assert.match(packageJson.scripts.search, /^node --disable-warning=ExperimentalWarning dist\/cli\.js search$/);
  assert.match(packageJson.scripts.listing, /^node --disable-warning=ExperimentalWarning dist\/cli\.js listing$/);
});
