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
  assert.equal(typeof manifest.author, 'string');
  assert.ok(manifest.author.length > 0);
});
