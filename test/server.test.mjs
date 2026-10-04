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
