import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const run = (args, dataDir) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', new URL('../dist/cli.js', import.meta.url).pathname, ...args], {
  encoding: 'utf8', env: { ...process.env, IMOTI_DATA_DIR: dataDir },
});

const saveWatchedSearch = (dataDir, criteria) => spawnSync(process.execPath, ['--input-type=module', '-e', `import { openStorage } from ${JSON.stringify(new URL('../dist/storage/index.js', import.meta.url).href)}; const storage = openStorage(${JSON.stringify(join(dataDir, 'imoti.db'))}); storage.saveSearch({ id: 'cli-test-search', criteria: ${JSON.stringify(criteria)}, createdAt: new Date().toISOString() }); storage.close();`], { encoding: 'utf8' });
const saveWatchedListing = (dataDir, listingId) => spawnSync(process.execPath, ['--input-type=module', '-e', `import { openStorage } from ${JSON.stringify(new URL('../dist/storage/index.js', import.meta.url).href)}; const storage = openStorage(${JSON.stringify(join(dataDir, 'imoti.db'))}); storage.watch(${JSON.stringify(listingId)}); storage.close();`], { encoding: 'utf8' });

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

test('search supports rooms, max price, limit, and pages and prints seller kind and URL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-cli-'));
  try {
    const result = run(['search', '--fixtures', new URL('./fixtures', import.meta.url).pathname, '--rooms', '2', '--max-price', '250000', '--limit', '10', '--pages', '2'], directory);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /seller kind.*url/i);
    assert.match(result.stdout, /agency|private|unknown/i);
    assert.match(result.stdout, /https?:/i);
    const saved = JSON.parse(await readFile(join(directory, 'last-search.json'), 'utf8'));
    assert.equal(saved.query.criteria.rooms.min, 2);
    assert.equal(saved.query.criteria.priceMax, 250000);
    assert.equal(saved.query.criteria.maxPages, 2);
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
    assert.match(result.stderr, /No fixture configured for/);
    assert.equal(result.stderr.trim().split('\n').length, 1);
    assert.doesNotMatch(result.stderr, / at .*\.js:/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('protective screen returns status 3 with visible-mode guidance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-cli-'));
  const protectiveFixtures = join(directory, 'fixtures');
  await mkdir(protectiveFixtures);
  await import('node:fs/promises').then(({ writeFile }) => writeFile(join(protectiveFixtures, 'search.html'), '<html><title>Just a moment</title><body>Cloudflare CAPTCHA</body></html>'));
  try {
    const result = run(['search', '--fixtures', protectiveFixtures], join(directory, 'data'));
    assert.equal(result.status, 3);
    assert.match(result.stderr, /protective screen/i);
    assert.match(result.stderr, /--visible/);
    assert.doesNotMatch(result.stderr, / at .*\.js:/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('refresh command uses saved searches, reports changes, and is idempotent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-cli-refresh-'));
  const dataDir = join(directory, 'data');
  const fixtures = new URL('./fixtures', import.meta.url).pathname;
  try {
    const setup = run(['search', '--fixtures', fixtures, '--district', 'Iztok'], dataDir);
    assert.equal(setup.status, 0, setup.stderr);
    const saved = JSON.parse(await readFile(join(dataDir, 'last-search.json'), 'utf8'));
    assert.equal(saveWatchedSearch(dataDir, saved.query.criteria).status, 0);
    const first = run(['refresh', '--fixtures', fixtures], dataDir);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Refreshed 1 saved search/);
    const second = run(['refresh', '--fixtures', fixtures], dataDir);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /recorded 0 changes/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('refresh command fails non-zero when fixture lookup fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-cli-refresh-'));
  const emptyFixtures = join(directory, 'fixtures');
  await mkdir(emptyFixtures);
  try {
    assert.equal(saveWatchedSearch(join(directory, 'data'), { deal: 'sale', city: 'Sofia', districts: ['Iztok'], propertyTypes: [], maxPages: 1 }).status, 0);
    const result = run(['refresh', '--fixtures', emptyFixtures], join(directory, 'data'));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No fixture configured for/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('refresh command fetches persisted watched listings without a saved search', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-cli-watched-listing-'));
  const dataDir = join(directory, 'data');
  const listingId = '1c100000000000001';
  try {
    assert.equal(saveWatchedListing(dataDir, listingId).status, 0);
    const result = run(['refresh', '--fixtures', new URL('./fixtures', import.meta.url).pathname], dataDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /and 1 watched listing/i);
    const observations = spawnSync(process.execPath, ['--input-type=module', '-e', `import { openStorage } from ${JSON.stringify(new URL('../dist/storage/index.js', import.meta.url).href)}; const storage = openStorage(${JSON.stringify(join(dataDir, 'imoti.db'))}); console.log(storage.listObservations(${JSON.stringify(listingId)}).filter(item => new URL(item.sourceUrl).pathname.startsWith('/obiava-')).length); storage.close();`], { encoding: 'utf8' });
    assert.equal(observations.stdout.trim(), '1');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
