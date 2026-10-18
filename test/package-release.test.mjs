import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const projectPath = new URL('../', import.meta.url).pathname;

async function zipEntries(path) {
  const result = spawnSync('python3', ['-c', 'import json,sys,zipfile; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function zipText(path, entry) {
  const result = spawnSync('python3', ['-c', 'import sys,zipfile; sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode())', path, entry], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('release packaging creates versioned MCPB and root-level skill ZIP with runtime-only files', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const output = await mkdtemp(join(tmpdir(), 'imoti-release-test-'));
  try {
    const result = spawnSync('node', ['scripts/package-release.mjs', '--output-dir', output], { cwd: projectPath, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const mcpb = join(output, `imoti-powered-mcp-${packageJson.version}.mcpb`);
    const skillZip = join(output, `property-search-skill-${packageJson.version}.zip`);
    const entries = await zipEntries(mcpb);
    assert.ok(entries.includes('manifest.json'));
    assert.ok(entries.includes('dist/main.js'));
    assert.ok(entries.includes('dist/local-server.js'));
    assert.ok(entries.includes('node_modules/@modelcontextprotocol/server/package.json'));
    assert.ok(entries.every(entry => !entry.startsWith('node_modules/typescript/')));
    assert.ok(entries.every(entry => !entry.includes('.sqlite') && !entry.includes('.env')));
    for (const asset of [`imoti-powered-mcp-${packageJson.version}.mcpb`, `property-search-skill-${packageJson.version}.zip`]) {
      const ignored = spawnSync('git', ['check-ignore', '-q', `release/${asset}`], { cwd: projectPath });
      assert.equal(ignored.status, 0, `${asset} is ignored by git`);
    }
    const manifest = JSON.parse(await zipText(mcpb, 'manifest.json'));
    assert.equal(manifest.manifest_version, '0.2');
    assert.equal(manifest.server.entry_point, 'dist/main.js');
    assert.deepEqual(manifest.compatibility.platforms, ['darwin', 'win32', 'linux']);
    assert.deepEqual(manifest.compatibility.runtimes, { node: '>=24.0.0' });
    assert.equal('runtime' in manifest, false);
    assert.deepEqual(manifest.server.mcp_config.args, ['--disable-warning=ExperimentalWarning', '${__dirname}/dist/main.js']);
    for (const name of ['IMOTI_VISIBLE', 'IMOTI_BROWSER_EXECUTABLE', 'IMOTI_DATA_DIR']) {
      assert.ok(manifest.user_config[name]);
      assert.equal(manifest.server.mcp_config.env[name], `\${user_config.${name}}`);
    }
    assert.ok(!JSON.stringify(manifest).includes('CLAUDE_PLUGIN_ROOT'));
    assert.deepEqual(await zipEntries(skillZip), ['SKILL.md']);
    assert.equal(await zipText(skillZip, 'SKILL.md'), await readFile(new URL('../skills/property-search/SKILL.md', import.meta.url), 'utf8'));
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
