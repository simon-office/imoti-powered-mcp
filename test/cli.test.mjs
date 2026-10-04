import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const run = (args, dataDir) => spawnSync(process.execPath, [new URL('../dist/cli.js', import.meta.url).pathname, ...args], {
  encoding: 'utf8', env: { ...process.env, IMOTI_DATA_DIR: dataDir },
});

test('search command prints verification and persists structured results from fixtures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-cli-'));
  try {
    const result = run(['search', '--fixtures', new URL('./fixtures', import.meta.url).pathname, '--district', 'Iztok'], directory);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /verification/i);
    assert.match(result.stdout, /price.*area.*floor.*district/i);
    const saved = JSON.parse(await readFile(join(directory, 'last-search.json'), 'utf8'));
    assert.ok(saved.query && saved.verification && Array.isArray(saved.listings));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('listing command prints a parsed fixture listing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-cli-'));
  try {
    const result = run(['listing', '1c100000000000001', '--fixtures', new URL('./fixtures', import.meta.url).pathname], directory);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /synthetic|\"id\"/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('invalid CLI arguments return usage and status 2 without a stack', () => {
  const result = run(['search', '--unknown'], tmpdir());
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
  assert.doesNotMatch(result.stderr, / at .*\.js:/);
});

test('fixture lookup failures return status 1 with a one-line error', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-cli-'));
  const emptyFixtures = join(directory, 'empty');
  await mkdir(emptyFixtures);
  try {
    const result = run(['search', '--fixtures', emptyFixtures], join(directory, 'data'));
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim().split('\n').length, 1);
    assert.doesNotMatch(result.stderr, / at .*\.js:/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
