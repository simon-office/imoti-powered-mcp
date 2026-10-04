import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client, InMemoryTransport as ClientTransport } from '@modelcontextprotocol/client';
import { InMemoryTransport as ServerTransport } from '@modelcontextprotocol/server';
import { createServer } from '../dist/server.js';
import { FixtureAdapter } from '../dist/adapter/fixture.js';
import { ProtectiveScreenError } from '../dist/adapter/types.js';
import { openStorage } from '../dist/storage/index.js';

async function withClient(server, fn) {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = ClientTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try { await fn(client); }
  finally { await client.close(); await server.close(); }
}

test('search_listings reports filter mismatches, client-filters results, and persists observations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-tools-'));
  const storage = openStorage(join(directory, 'test.db'));
  const adapter = new FixtureAdapter([
    [/obiavi\/prodazhbi/, new URL('./fixtures/search-normal.html', import.meta.url)],
  ]);
  try {
    const server = createServer({ adapter, storage });
    await withClient(server, async client => {
      const tools = await client.listTools();
      assert.ok(tools.tools.some(tool => tool.name === 'search_listings'));
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { priceMin: 100000, districts: ['iztok'] }, limit: 10 } });
      assert.equal(result.isError, undefined, result.content?.[0]?.text);
      assert.equal(result.structuredContent.listings.length, 1);
      assert.equal(result.structuredContent.verification.ok, false);
      assert.ok(Array.isArray(result.structuredContent.verification.mismatches));
      assert.ok(result.structuredContent.verification.mismatches.length > 0);
      assert.ok(result.structuredContent.verification.mismatches.some(mismatch => mismatch.filter === 'district' && mismatch.observed === 'lozenets'));
      assert.equal(result.structuredContent.query.criteria.priceMin, 100000);
      assert.ok(result.structuredContent.query.urls.length <= 3);
      assert.ok(result.structuredContent.observedAt);
      assert.equal(storage.listObservations('1c100000000000001').length, 1);
      assert.match(result.content[0].text, /Found 1 listing/);
      const filtered = await client.callTool({ name: 'search_listings', arguments: { criteria: { priceMin: 130000, districts: ['iztok'] }, limit: 10 } });
      assert.deepEqual(filtered.structuredContent.listings, []);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('search_listings defaults limit to 15 and rejects limits outside 10–20', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-tools-'));
  const storage = openStorage(join(directory, 'test.db'));
  const adapter = new FixtureAdapter([[/obiavi\/prodazhbi/, new URL('./fixtures/search-normal.html', import.meta.url)]]);
  try {
    const server = createServer({ adapter, storage });
    await withClient(server, async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: {} } });
      assert.equal(result.structuredContent.listings.length, 4);
      const invalid = await client.callTool({ name: 'search_listings', arguments: { criteria: {}, limit: 9 } });
      assert.equal(invalid.isError, true);
      assert.match(invalid.content[0].text, /limit/i);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('get_listing reads live data, then uses a fresh observation unless refreshed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-tools-'));
  const storage = openStorage(join(directory, 'test.db'));
  const url = 'https://www.imot.bg/obiava-1c100000000000001-test';
  const unavailableUrl = 'https://www.imot.bg/obiava-1c100000000000002-test';
  const adapter = new FixtureAdapter([
    [url, new URL('./fixtures/listing-street.html', import.meta.url)],
    [unavailableUrl, new URL('./fixtures/listing-removed.html', import.meta.url)],
  ]);
  try {
    const server = createServer({ adapter, storage });
    await withClient(server, async client => {
      const first = await client.callTool({ name: 'get_listing', arguments: { url } });
      assert.equal(first.structuredContent.status, undefined);
      assert.equal(adapter.requests.length, 1);
      await client.callTool({ name: 'get_listing', arguments: { id: '1c100000000000001' } });
      assert.equal(adapter.requests.length, 1);
      await client.callTool({ name: 'get_listing', arguments: { id: '1c100000000000001', refresh: true } });
      assert.equal(adapter.requests.length, 2);
      const unavailable = await client.callTool({ name: 'get_listing', arguments: { url: unavailableUrl } });
      assert.equal(unavailable.structuredContent.listing.status, 'not_available');
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('get_listing fetches after a search-card observation instead of treating it as detail cache', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-tools-'));
  const storage = openStorage(join(directory, 'test.db'));
  const id = '1c100000000000001';
  const url = 'https://www.imot.bg/obiava-1c100000000000001';
  storage.recordObservation({ listingId: id, observedAt: new Date().toISOString(), sourceUrl: 'https://www.imot.bg/obiavi/prodazhbi', raw: { title: 'Card only' }, normalized: { id, title: 'Card only', status: 'available' } });
  const adapter = new FixtureAdapter([[/obiava-1c100000000000001/, new URL('./fixtures/listing-street.html', import.meta.url)]]);
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      const result = await client.callTool({ name: 'get_listing', arguments: { id } });
      assert.equal(result.structuredContent.cached, false);
      assert.equal(adapter.requests.length, 1);
      assert.notEqual(result.structuredContent.listing.title, 'Card only');
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('search visits every requested district even when the first district reaches the result limit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-tools-'));
  const storage = openStorage(join(directory, 'test.db'));
  const adapter = new FixtureAdapter([
    [/iztok/, new URL('./fixtures/search-iztok-matching.html', import.meta.url)],
    [/lozenets/, new URL('./fixtures/search-lozenets-matching.html', import.meta.url)],
  ]);
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { districts: ['iztok', 'lozenets'] }, limit: 10 } });
      assert.equal(result.isError, undefined, result.content?.[0]?.text);
      assert.equal(adapter.requests.length, result.structuredContent.query.urls.length);
      assert.ok(result.structuredContent.query.urls.some(url => url.includes('/iztok/')));
      assert.ok(result.structuredContent.query.urls.some(url => url.includes('/lozenets/')));
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('get_listing stores parsed listing values rather than fetched HTML', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-tools-'));
  const storage = openStorage(join(directory, 'test.db'));
  const url = 'https://www.imot.bg/obiava-1c100000000000001-test';
  try {
    await withClient(createServer({ adapter: new FixtureAdapter([[url, new URL('./fixtures/listing-street.html', import.meta.url)]]), storage }), async client => {
      await client.callTool({ name: 'get_listing', arguments: { url } });
      const raw = JSON.stringify(storage.listObservations('1c100000000000001')[0].raw);
      assert.doesNotMatch(raw, /<html|0888000000|Иван Пример/i);
      assert.match(raw, /title|price|description/i);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('get_listing rejects non-canonical hosts and mismatched ids before fetching', async () => {
  const storage = { listObservations: () => [], upsertListing() {}, recordObservation() {} };
  const requests = [];
  const server = createServer({ adapter: { fetchPage: async url => { requests.push(url); throw new Error('unexpected fetch'); } }, storage });
  await withClient(server, async client => {
    for (const args of [
      { url: 'https://example.com/obiava-1c100000000000001-fake', refresh: true },
      { url: 'http://www.imot.bg/obiava-1c100000000000001-fake', refresh: true },
      { id: '1c100000000000002', url: 'https://www.imot.bg/obiava-1c100000000000001-fake', refresh: true },
    ]) {
      const result = await client.callTool({ name: 'get_listing', arguments: args });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /https:\/\/www\.imot\.bg|match/i);
    }
    assert.deepEqual(requests, []);
  });
});

test('search_listings preserves multiple property types and client-filters types and room ranges', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-tools-'));
  const storage = openStorage(join(directory, 'test.db'));
  const adapter = new FixtureAdapter([[/obiavi\/prodazhbi/, new URL('./fixtures/search-normal.html', import.meta.url)]]);
  try {
    const server = createServer({ adapter, storage });
    await withClient(server, async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { propertyTypes: ['dvustaen', 'kashta'], rooms: { min: 2, max: 4 } }, limit: 10 } });
      assert.ok(result.structuredContent.query.urls.some(url => url.includes('/dvustaen')));
      assert.ok(result.structuredContent.query.urls.some(url => url.includes('/kashta')));
      assert.ok(result.structuredContent.listings.every(listing => ['2-СТАЕН', 'Къща'].includes(listing.propertyType?.label)));
      assert.ok(result.structuredContent.listings.every(listing => listing.propertyType?.rooms >= 2 && listing.propertyType?.rooms <= 4));
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('search_listings verifies matching requested deal and city filters', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-tools-'));
  const storage = openStorage(join(directory, 'test.db'));
  const adapter = new FixtureAdapter([[/obiavi\/prodazhbi/, new URL('./fixtures/search-normal.html', import.meta.url)]]);
  try {
    const server = createServer({ adapter, storage });
    await withClient(server, async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { deal: 'sale', city: 'Sofia' }, limit: 10 } });
      assert.equal(result.structuredContent.verification.ok, true);
      assert.deepEqual(result.structuredContent.verification.mismatches, []);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

for (const [name, criteria, expectedCount] of [
  ['a matching district', { districts: ['Изток'] }, 1],
  ['matching districts and property types', { districts: ['iztok', 'lozenets'], propertyTypes: ['tristaen', 'dvustaen'], maxPages: 2 }, 2],
  ['a matching exact room count', { districts: ['iztok'], rooms: { min: 3, max: 3 } }, 1],
  ['a matching property type without a district', { propertyTypes: ['tristaen'] }, 1],
]) {
  test(`search_listings verifies ${name}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'imoti-tools-'));
    const storage = openStorage(join(directory, 'test.db'));
    const adapter = new FixtureAdapter([
      [/\/lozenets\//, new URL('./fixtures/search-lozenets-matching.html', import.meta.url)],
      [/obiavi\/prodazhbi/, new URL('./fixtures/search-iztok-matching.html', import.meta.url)],
    ]);
    try {
      await withClient(createServer({ adapter, storage }), async client => {
        const result = await client.callTool({ name: 'search_listings', arguments: { criteria, limit: 10 } });
        assert.equal(result.isError, undefined, result.content?.[0]?.text);
        assert.equal(result.structuredContent.listings.length, expectedCount);
        assert.equal(result.structuredContent.verification.ok, true, JSON.stringify(result.structuredContent.verification.mismatches));
        assert.deepEqual(result.structuredContent.verification.mismatches, []);
        assert.match(result.content[0].text, /filters verified/);
        assert.ok(result.structuredContent.query.urls.length <= (criteria.maxPages ?? 3) * (criteria.districts?.length ?? 1));
        for (const listing of result.structuredContent.listings) {
          assert.equal(storage.listObservations(listing.id).length, 1);
        }
      });
    } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
  });
}

test('search URL page budget applies across property types per district', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-tools-'));
  const storage = openStorage(join(directory, 'test.db'));
  const adapter = new FixtureAdapter([[/obiavi\/prodazhbi/, new URL('./fixtures/search-normal.html', import.meta.url)]]);
  try {
    const server = createServer({ adapter, storage });
    await withClient(server, async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { districts: ['iztok'], propertyTypes: ['dvustaen', 'kashta'], maxPages: 2 }, limit: 10 } });
      const urls = result.structuredContent.query.urls;
      assert.equal(urls.length, 2);
      assert.ok(urls.every(url => !url.includes('/p-')));
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('tool errors explain protective screens and unknown districts without stack traces', async () => {
  const storage = { listObservations: () => [], upsertListing() {}, recordObservation() {} };
  const blocked = createServer({ adapter: { fetchPage: async url => { throw new ProtectiveScreenError(url, 403); }, close: async () => {} }, storage });
  await withClient(blocked, async client => {
    const result = await client.callTool({ name: 'get_listing', arguments: { id: '1c100000000000001', refresh: true } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /visible mode/);
    assert.doesNotMatch(result.content[0].text, /at .*\.js:/);
  });
  const unknown = createServer({ adapter: new FixtureAdapter({}), storage });
  await withClient(unknown, async client => {
    const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { districts: ['not-a-district'] } } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Closest known names/);
    assert.doesNotMatch(result.content[0].text, /at .*\.js:/);
  });
});

test('server_info exposes server metadata and selected data directory over memory transport', async () => {
  const previousDataDir = process.env.IMOTI_DATA_DIR;
  process.env.IMOTI_DATA_DIR = '/tmp/imoti-test-data';
  const server = createServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = ClientTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(({ name }) => name), ['server_info']);
    const result = await client.callTool({ name: 'server_info' });
    assert.deepEqual(result.structuredContent, {
      name: 'imoti', version: '0.1.0', stage: '1', dataDir: '/tmp/imoti-test-data',
    });
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, 'text');
    assert.equal(result.content[0].text.split('\n').length, 1);
  } finally {
    await client.close();
    await server.close();
    if (previousDataDir === undefined) delete process.env.IMOTI_DATA_DIR;
    else process.env.IMOTI_DATA_DIR = previousDataDir;
  }
});

test('server_info defaults data directory to the user home', async () => {
  const server = createServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = ClientTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const result = await client.callTool({ name: 'server_info' });
    assert.equal(result.structuredContent.dataDir, `${homedir()}/.imoti-powered-mcp`);
  } finally {
    await client.close();
    await server.close();
  }
});

test('server_info resolves the user home when HOME is unset', async () => {
  const previousHome = process.env.HOME;
  const previousDataDir = process.env.IMOTI_DATA_DIR;
  delete process.env.HOME;
  delete process.env.IMOTI_DATA_DIR;
  const server = createServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = ClientTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const result = await client.callTool({ name: 'server_info' });
    assert.equal(result.structuredContent.dataDir, `${homedir()}/.imoti-powered-mcp`);
  } finally {
    await client.close();
    await server.close();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousDataDir === undefined) delete process.env.IMOTI_DATA_DIR;
    else process.env.IMOTI_DATA_DIR = previousDataDir;
  }
});

test('plugin manifests declare the package and stdio server', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const plugin = JSON.parse(await readFile(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  const mcp = JSON.parse(await readFile(new URL('../.mcp.json', import.meta.url), 'utf8'));
  assert.equal(plugin.name, 'imoti-powered-mcp');
  assert.equal(plugin.version, pkg.version);
  assert.ok(plugin.description);
  assert.equal(plugin.author, 'Simon Office');
  assert.deepEqual(mcp.mcpServers.imoti, {
    command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/dist/main.js'],
  });
});
