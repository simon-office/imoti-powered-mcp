import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, resolve, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createMcpbManifest } from '../scripts/mcpb-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = async path => JSON.parse(await readFile(join(root, path), 'utf8'));

test('release metadata uses 0.2.0 and includes npm discovery metadata', async () => {
  const pkg = await json('package.json');
  const lock = await json('package-lock.json');
  const plugin = await json('.claude-plugin/plugin.json');
  const marketplace = await json('.claude-plugin/marketplace.json');
  const versionSource = await readFile(join(root, 'src/version.ts'), 'utf8');
  assert.equal(pkg.version, '0.2.0');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(plugin.version, pkg.version);
  assert.equal(marketplace.plugins[0].version, pkg.version);
  assert.ok(marketplace.metadata?.description?.trim());
  assert.match(versionSource, /0\.2\.0/);
  for (const field of ['repository', 'homepage', 'bugs', 'keywords']) assert.ok(pkg[field], `package.json should define ${field}`);
  const manifest = createMcpbManifest(pkg);
  assert.equal(manifest.manifest_version, '0.2');
  assert.equal(manifest.name, pkg.name);
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.description);
  assert.ok(manifest.author.name);
  assert.equal(manifest.server.type, 'node');
  assert.equal(manifest.server.entry_point, 'dist/main.js');
  assert.equal(manifest.server.mcp_config.command, 'node');
  assert.deepEqual(manifest.compatibility, { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=24.0.0' } });
  assert.equal('runtime' in manifest, false);
  assert.deepEqual(manifest.server.mcp_config.args, ['--disable-warning=ExperimentalWarning', '${__dirname}/dist/main.js']);
  const config = manifest.server.mcp_config;
  for (const name of ['IMOTI_VISIBLE', 'IMOTI_BROWSER_EXECUTABLE', 'IMOTI_DATA_DIR']) {
    assert.ok(config.env?.[name], `${name} is passed to the server`);
    assert.ok(manifest.user_config?.[name], `${name} is user-configurable`);
  }
  assert.equal(manifest.user_config.IMOTI_VISIBLE.type, 'boolean');
});

test('README provides concise entry points before extended reference material', async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const firstDocsLinks = [...readme.matchAll(/\]\((docs\/(?:install-for-ai|user-guide)\.md)\)/g)].slice(0, 2).map(match => match[1]);
  assert.deepEqual(firstDocsLinks, ['docs/install-for-ai.md', 'docs/user-guide.md']);
  for (const heading of ['What it is', 'Quick install', 'Quick usage', 'Documentation', 'Limitations']) assert.match(readme, new RegExp(heading, 'i'));
  assert.match(readme, /unofficial/i);
  assert.match(readme, /personal use/i);
});

test('v0.2.0 changelog records stage 4 and stage 5 scope', async () => {
  const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
  const section = changelog.split('## [0.2.0]')[1]?.split('\n## ')[0] ?? '';
  assert.ok(section, 'v0.2.0 section should exist');
  for (const phrase of [/configurable.{0,30}collection limits|collection limits/i, /limitations/i, /English/i, /Bulgarian/i, /Russian/i, /buying and renting/i, /search/i, /evidence/i]) assert.match(section, phrase);
});

test('README and docs local Markdown links resolve and live-check is in maintainers docs', async () => {
  const markdownFiles = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (extname(entry.name) === '.md') markdownFiles.push(path);
    }
  }
  await walk(join(root, 'docs'));
  markdownFiles.push(join(root, 'README.md'));
  assert.ok(await stat(join(root, 'docs/maintainers/live-check.md')));
  await assert.rejects(stat(join(root, 'docs/live-check.md')));
  for (const source of markdownFiles) {
    const text = await readFile(source, 'utf8');
    for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(?:[a-z]+:|#|\/\/)/i.test(target)) continue;
      const pathname = decodeURIComponent(target.split('#')[0].split('?')[0]);
      if (!pathname) continue;
      await stat(resolve(dirname(source), pathname));
    }
  }
});
