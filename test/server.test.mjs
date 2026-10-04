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

test('memory tools persist notes, independent saved searches, and listing watches', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-tools-'));
  const storage = openStorage(join(directory, 'test.db'));
  storage.upsertListing({ id: 'fake-listing-1' });
  try {
    await withClient(createServer({ storage }), async client => {
      const noteResult = await client.callTool({ name: 'save_note', arguments: { listingId: 'fake-listing-1', kind: 'favourite', text: 'Sunny kitchen' } });
      assert.equal(noteResult.isError, undefined);
      assert.deepEqual(storage.listNotes('fake-listing-1'), [noteResult.structuredContent.note]);
      assert.ok(noteResult.structuredContent.note.id);
      assert.ok(Number.isFinite(Date.parse(noteResult.structuredContent.note.createdAt)));
      assert.equal(noteResult.structuredContent.note.text, 'Sunny kitchen');

      const first = await client.callTool({ name: 'save_search', arguments: { id: 'near-park', criteria: { districts: ['fake-district'] } } });
      const second = await client.callTool({ name: 'save_search', arguments: { id: 'under-budget', criteria: { priceMax: 123456 } } });
      assert.deepEqual(first.structuredContent.search, storage.listSearches()[0]);
      assert.deepEqual(second.structuredContent.search, storage.listSearches()[1]);
      assert.equal(storage.listSearches().length, 2);

      const watched = await client.callTool({ name: 'watch_listing', arguments: { listingId: 'fake-listing-1', watch: true } });
      assert.deepEqual(watched.structuredContent, { listingId: 'fake-listing-1', watching: true });
      assert.deepEqual(storage.listWatched(), ['fake-listing-1']);
      const unwatched = await client.callTool({ name: 'watch_listing', arguments: { listingId: 'fake-listing-1', watch: false } });
      assert.deepEqual(unwatched.structuredContent, { listingId: 'fake-listing-1', watching: false });
      assert.deepEqual(storage.listWatched(), []);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('memory tools reject invalid inputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-tools-'));
  const storage = openStorage(join(directory, 'test.db'));
  try {
    await withClient(createServer({ storage }), async client => {
      for (const [name, args] of [
        ['save_note', { listingId: 'x', kind: 'unknown', text: 'x' }],
        ['save_note', { listingId: 'x', kind: 'note', text: 42 }],
        ['save_search', { id: 'x', criteria: 'not-object' }],
        ['watch_listing', { listingId: 'x', watch: 'yes' }],
      ]) {
        const result = await client.callTool({ name, arguments: args });
        assert.equal(result.isError, true, `${name} should reject ${JSON.stringify(args)}`);
      }
      assert.deepEqual(storage.listSearches(), []);
      assert.deepEqual(storage.listWatched(), []);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('watched refresh persists only real changes and get_changes returns a safe digest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-refresh-'));
  const storage = openStorage(join(directory, 'test.db'));
  const adapter = new FixtureAdapter([[/obiavi\/prodazhbi/, new URL('./fixtures/search-normal.html', import.meta.url)]]);
  try {
    storage.saveSearch({ id: 'refresh-search', criteria: {}, createdAt: '2026-01-01T00:00:00.000Z' });
    await withClient(createServer({ adapter, storage }), async client => {
      const tools = await client.listTools();
      assert.ok(tools.tools.some(tool => tool.name === 'get_changes'));
      const refreshed = await client.callTool({ name: 'refresh_watched', arguments: {} });
      assert.equal(refreshed.isError, undefined, refreshed.content?.[0]?.text);
      const events = storage.listChanges();
      assert.ok(events.every(event => event.kind === 'new_match'));
      assert.equal(events.length, 4);
      const repeated = await client.callTool({ name: 'refresh_watched', arguments: {} });
      assert.equal(repeated.structuredContent.changes, 0);
      assert.equal(storage.listChanges().length, 4, 'identical repeated refreshes must not write duplicate events');
      const changes = await client.callTool({ name: 'get_changes', arguments: { limit: 1 } });
      assert.equal(changes.structuredContent.changes.length, 1);
      assert.match(changes.structuredContent.digest, /^new_match: 1/);
      assert.match(changes.structuredContent.digest, /1c100000000000004.*new_match/);
      assert.match(changes.structuredContent.digest, /2-СТАЕН/);
      assert.match(changes.structuredContent.digest, /Бояна/);
      assert.match(changes.structuredContent.digest, /88000 EUR/);
      assert.doesNotMatch(changes.structuredContent.digest, /undefined/);
      assert.doesNotMatch(changes.structuredContent.digest, /sold|transaction/i);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('first-seen watched listings have no fabricated earlier price history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-first-observation-'));
  const storage = openStorage(join(directory, 'test.db'));
  const adapter = new FixtureAdapter([[/obiavi\/prodazhbi/, new URL('./fixtures/search-normal.html', import.meta.url)]]);
  try {
    storage.saveSearch({ id: 'first-observation-search', criteria: {}, createdAt: '2026-01-01T00:00:00.000Z' });
    assert.deepEqual(storage.listObservations(), []);
    assert.deepEqual(storage.listChanges(), []);
    await withClient(createServer({ adapter, storage }), async client => {
      const refreshed = await client.callTool({ name: 'refresh_watched', arguments: {} });
      assert.equal(refreshed.isError, undefined, refreshed.content?.[0]?.text);
      const events = storage.listChanges();
      assert.equal(events.length, 4);
      for (const event of events) {
        assert.equal(event.kind, 'new_match');
        assert.deepEqual(event.data, {}, `${event.listingId}: first observation must not invent prior prices or history`);
        assert.ok(storage.getListing(event.listingId).price, 'the first observed asking price is retained');
        assert.ok(storage.listObservations(event.listingId).every(observation => observation.observedAt === event.occurredAt), 'history starts at the first observation');
      }
      const result = await client.callTool({ name: 'get_changes', arguments: {} });
      assert.equal(result.isError, undefined, result.content?.[0]?.text);
      assert.deepEqual(result.structuredContent.changes, events, 'get_changes exposes the persisted first-observation events');
      const repeated = await client.callTool({ name: 'refresh_watched', arguments: {} });
      assert.equal(repeated.isError, undefined, repeated.content?.[0]?.text);
      assert.equal(repeated.structuredContent.changes, 0);
      assert.deepEqual(storage.listChanges(), events, 'repeat refresh leaves first-observation history unchanged');
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('refresh records disappearance only after every search page completes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-disappeared-'));
  const storage = openStorage(join(directory, 'test.db'));
  let mode = 'normal';
  const adapter = {
    async fetchPage(url) {
      if (mode === 'failure') throw new Error('fixture fetch failed');
      const fixture = mode === 'empty' || mode === 'incomplete-empty' ? './fixtures/search-empty.html' : './fixtures/search-normal.html';
      let html = await readFile(new URL(fixture, import.meta.url), 'utf8');
      if (mode === 'incomplete-empty') html = html.replace('</body>', '<a class="next" href="/obiavi/prodazhbi/p-2">Next</a></body>');
      return { url, status: 200, html, fetchedAt: new Date() };
    },
    async close() {},
  };
  storage.saveSearch({ id: 'disappearance-search', criteria: {}, createdAt: '2026-01-01T00:00:00.000Z' });
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      await client.callTool({ name: 'refresh_watched', arguments: {} });
      mode = 'failure';
      const failed = await client.callTool({ name: 'refresh_watched', arguments: {} });
      assert.equal(failed.isError, true);
      assert.equal(storage.listChanges().filter(event => event.kind === 'disappeared').length, 0);
      mode = 'incomplete-empty';
      await client.callTool({ name: 'refresh_watched', arguments: {} });
      assert.equal(storage.listChanges().filter(event => event.kind === 'disappeared').length, 0, 'a next-page link means results are incomplete');
      mode = 'empty';
      await client.callTool({ name: 'refresh_watched', arguments: {} });
      const disappeared = storage.listChanges().filter(event => event.kind === 'disappeared');
      assert.equal(disappeared.length, 4);
      assert.ok(disappeared.every(event => event.data.status === 'no longer observed'));
      assert.ok(disappeared.every(event => !/sold/i.test(JSON.stringify(event))));
      await client.callTool({ name: 'refresh_watched', arguments: {} });
      assert.equal(storage.listChanges().filter(event => event.kind === 'disappeared').length, 4, 'repeated absence must not duplicate events');
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('watched detail refresh records disappearance when the detail page reports unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-watched-unavailable-'));
  const storage = openStorage(join(directory, 'test.db'));
  const id = '1c100000000000001';
  storage.upsertListing({ id, status: 'available' });
  storage.watch(id);
  const adapter = new FixtureAdapter([[new RegExp(`obiava-${id}`), new URL('./fixtures/listing-removed.html', import.meta.url)]]);
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      const result = await client.callTool({ name: 'refresh_watched', arguments: {} });
      assert.equal(result.isError, undefined, result.content?.[0]?.text);
      assert.equal(storage.listChanges().filter(event => event.listingId === id && event.kind === 'disappeared').length, 1);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('refresh classifies price and non-price normalized snapshot edits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-edits-'));
  const storage = openStorage(join(directory, 'test.db'));
  let html = await readFile(new URL('./fixtures/search-normal.html', import.meta.url), 'utf8');
  const adapter = { async fetchPage(url) { return { url, status: 200, html, fetchedAt: new Date() }; }, async close() {} };
  storage.saveSearch({ id: 'edit-search', criteria: {}, createdAt: '2026-01-01T00:00:00.000Z' });
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      await client.callTool({ name: 'refresh_watched', arguments: {} });
      const unchanged = await client.callTool({ name: 'refresh_watched', arguments: {} });
      assert.equal(unchanged.structuredContent.changes, 0);
      assert.equal(storage.listChanges().filter(event => event.kind === 'edited').length, 0, 'overlapping unchanged saved-search observations do not create edits');
      html = html.replace('125 000 €', '124 000 €');
      await client.callTool({ name: 'refresh_watched', arguments: {} });
      const priceEvents = storage.listChanges().filter(event => event.kind === 'price_change');
      assert.equal(priceEvents.length, 1);
      assert.deepEqual(priceEvents[0].data.oldAskingPrice, { amount: 125000, currency: 'EUR' });
      assert.deepEqual(priceEvents[0].data.newAskingPrice, { amount: 124000, currency: 'EUR' });
      const digest = await client.callTool({ name: 'get_changes', arguments: {} });
      assert.match(digest.structuredContent.digest, /^new_match: 4, price_change: 1/);
      assert.match(digest.structuredContent.digest, /price_change: 1/);
      assert.match(digest.structuredContent.digest, /125000 EUR.*124000 EUR/);
      assert.doesNotMatch(digest.structuredContent.digest, /undefined/);
      html = html.replace('Продава 3-СТАЕН', 'Продава 3-СТАЕН редактиран');
      await client.callTool({ name: 'refresh_watched', arguments: {} });
      const edited = storage.listChanges().filter(event => event.kind === 'edited');
      assert.equal(edited.length, 1);
      assert.ok(edited.some(event => event.listingId === '1c100000000000001'), 'a changed shared title field creates an edit for that listing');
      const invalid = await client.callTool({ name: 'get_changes', arguments: { since: 'yesterday' } });
      assert.equal(invalid.isError, true);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('watched refresh preserves fetched listing details when search-card data is unchanged', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-detail-refresh-'));
  const storage = openStorage(join(directory, 'test.db'));
  const id = '1c100000000000001';
  const detailUrl = `https://www.imot.bg/obiava-${id}-test`;
  let changedCard = false;
  const adapter = {
    async fetchPage(url) {
      const fixture = url === detailUrl ? './fixtures/listing-street.html' : './fixtures/search-normal.html';
      let html = await readFile(new URL(fixture, import.meta.url), 'utf8');
      if (changedCard && url !== detailUrl) html = html.replace('125 000 €', '124 000 €');
      return { url, status: 200, html, fetchedAt: new Date() };
    },
    async close() {},
  };
  storage.saveSearch({ id: 'detail-refresh-search', criteria: {}, createdAt: '2026-01-01T00:00:00.000Z' });
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      const detail = await client.callTool({ name: 'get_listing', arguments: { url: detailUrl, refresh: true } });
      assert.equal(detail.isError, undefined, detail.content?.[0]?.text);
      const original = storage.getListing(id);
      assert.ok(original);

      changedCard = true;
      const refreshed = await client.callTool({ name: 'refresh_watched', arguments: {} });
      assert.equal(refreshed.isError, undefined, refreshed.content?.[0]?.text);
      const afterRefresh = storage.getListing(id);
      assert.equal(afterRefresh.description, original.description);
      assert.deepEqual(afterRefresh.photos, original.photos);
      assert.equal(afterRefresh.location.street, original.location.street);
      assert.equal(afterRefresh.gas, original.gas);
      assert.equal(storage.listChanges().filter(event => event.listingId === id && event.kind === 'edited').length, 0);
      assert.equal(storage.listChanges().filter(event => event.listingId === id && event.kind === 'price_change').length, 1);
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
    [/iztok/, new URL('./fixtures/search-iztok-limit.html', import.meta.url)],
    [/lozenets/, new URL('./fixtures/search-lozenets-matching.html', import.meta.url)],
  ]);
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { districts: ['iztok', 'lozenets'] }, limit: 10 } });
      assert.equal(result.isError, undefined, result.content?.[0]?.text);
      assert.equal(result.structuredContent.listings.length, 10, 'the first district alone must fill the shared result limit');
      assert.deepEqual(result.structuredContent.districtCounts, { iztok: 9, lozenets: 1 });
      assert.deepEqual(result.structuredContent.listings.map(listing => listing.id), [
        '1c100000000000011', '1c100000000000099', '1c100000000000012', '1c100000000000013', '1c100000000000014',
        '1c100000000000015', '1c100000000000016', '1c100000000000017', '1c100000000000018', '1c100000000000019',
      ]);
      assert.ok(result.structuredContent.listings.length <= 10);
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
      name: 'imoti', version: '0.1.0', stage: '3', dataDir: '/tmp/imoti-test-data',
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
  assert.deepEqual(plugin.author, { name: 'Simon Office' });
  assert.deepEqual(mcp.mcpServers.imoti, {
    command: 'node', args: ['--disable-warning=ExperimentalWarning', '${CLAUDE_PLUGIN_ROOT}/dist/main.js'],
  });
});
