import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client, InMemoryTransport as ClientTransport } from '@modelcontextprotocol/client';
import { InMemoryTransport as ServerTransport } from '@modelcontextprotocol/server';
import { createServer } from '../dist/server.js';
import { VERSION } from '../src/version.ts';
import { FixtureAdapter } from '../dist/adapter/fixture.js';
import { ProtectiveScreenError } from '../dist/adapter/types.js';
import { openStorage } from '../dist/storage/index.js';
import { FixtureSofiaDataAdapter } from '../dist/adapter/sofia-data.js';
import { parseSearchResults } from '../dist/parsers/search.js';

async function withClient(server, fn) {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = ClientTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try { await fn(client); }
  finally { await client.close(); await server.close(); }
}

// Model a category request that lands on an unrestricted results page.
function unrestrictedFixtureAdapter(fixture) {
  const adapter = new FixtureAdapter([[/obiavi\/prodazhbi/, fixture]]);
  const fetchPage = adapter.fetchPage.bind(adapter);
  adapter.fetchPage = async url => ({ ...await fetchPage(url), url: 'https://www.imot.bg/obiavi/prodazhbi/grad-sofiya' });
  return adapter;
}

test('search MCP schema uses validated environment collection defaults', async () => {
  const previousResults = process.env.IMOTI_SEARCH_MAX_RESULTS;
  const previousPages = process.env.IMOTI_SEARCH_MAX_PAGES;
  const directory = await mkdtemp(join(tmpdir(), 'imoti-search-config-'));
  const storage = openStorage(join(directory, 'test.db'));
  process.env.IMOTI_SEARCH_MAX_RESULTS = '10';
  process.env.IMOTI_SEARCH_MAX_PAGES = '2';
  const server = createServer({ storage, adapter: new FixtureAdapter({}) });
  try {
    await withClient(server, async client => {
      const tool = (await client.listTools()).tools.find(({ name }) => name === 'search_listings');
      assert.equal(tool.inputSchema.properties.limit.default, 10);
      assert.equal(tool.inputSchema.properties.criteria.properties.maxPages.default, 2);
    });
  } finally {
    storage.close();
    await rm(directory, { recursive: true, force: true });
    if (previousResults === undefined) delete process.env.IMOTI_SEARCH_MAX_RESULTS;
    else process.env.IMOTI_SEARCH_MAX_RESULTS = previousResults;
    if (previousPages === undefined) delete process.env.IMOTI_SEARCH_MAX_PAGES;
    else process.env.IMOTI_SEARCH_MAX_PAGES = previousPages;
  }
});

test('server_info reports delivery stage 5', async () => {
  await withClient(createServer(), async client => {
    const result = await client.callTool({ name: 'server_info', arguments: {} });
    assert.equal(result.structuredContent.stage, '5');
  });
});

test('compare_listings flags cross-category shared property keys as suspected reposts without merging listing ids', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-suspected-reposts-'));
  const storage = openStorage(join(directory, 'test.db'));
  storage.upsertListing({ id: 'sale-fixture-a', propertyKey: 'fabricated-property-1', dealType: 'sale', title: 'Imaginary flat' });
  storage.upsertListing({ id: 'rent-fixture-b', propertyKey: 'fabricated-property-1', dealType: 'rent', title: 'Imaginary flat' });
  try {
    await withClient(createServer({ storage }), async client => {
      const result = await client.callTool({ name: 'compare_listings', arguments: { listingIds: ['sale-fixture-a', 'rent-fixture-b'] } });
      assert.deepEqual(result.structuredContent.listings.map(item => item.id), ['sale-fixture-a', 'rent-fixture-b']);
      assert.equal(result.structuredContent.duplicateEvidence.length, 1);
      assert.equal(result.structuredContent.duplicateEvidence[0].confidence, 'suspected');
      assert.equal(result.structuredContent.duplicateEvidence[0].kind, 'possible_repost');
      assert.equal(result.structuredContent.duplicateEvidence[0].propertyMatch, 'suspected');
    });
  } finally { try { storage.close(); } catch {} await rm(directory, { recursive: true, force: true }); }
});

test('compare_listings reports ongoing rent and the promotion terms separately', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-promo-rent-'));
  const storage = openStorage(join(directory, 'test.db'));
  storage.upsertListing({ id: 'promo-rent-a', dealType: 'rent', price: { amount: 699, currency: 'EUR' }, promotionalRent: { amount: 549, currency: 'EUR', durationMonths: 1, regularAmount: 699, source: 'Synthetic promotional rent sentence.' } });
  storage.upsertListing({ id: 'promo-rent-b', dealType: 'rent', price: { amount: 800, currency: 'EUR' } });
  try {
    await withClient(createServer({ storage }), async client => {
      const result = await client.callTool({ name: 'compare_listings', arguments: { listingIds: ['promo-rent-a', 'promo-rent-b'] } });
      assert.deepEqual(result.structuredContent.listings[0].price, { amount: 699, currency: 'EUR' });
      assert.equal(result.structuredContent.listings[0].promotionalRent.amount, 549);
      assert.equal(result.structuredContent.listings[0].promotionalRent.durationMonths, 1);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('MCP disconnect awaits local adapter and storage cleanup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-disconnect-cleanup-'));
  const storage = openStorage(join(directory, 'test.db'));
  const adapter = new FixtureAdapter({});
  let closeCount = 0;
  adapter.close = async () => { await new Promise(resolve => setTimeout(resolve, 5)); closeCount++; };
  const server = createServer({ storage, adapter, cleanupOnDisconnect: true });
  const client = new Client({ name: 'disconnect-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = ClientTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  await client.close();
  await serverTransport.close();
  await new Promise(resolve => setTimeout(resolve, 10));
  try {
    assert.equal(closeCount, 1);
    assert.throws(() => storage.getListing('after-disconnect'), /closed|database/i);
  } finally { try { await server.close(); } catch {} try { storage.close(); } catch {} await rm(directory, { recursive: true, force: true }); }
});

test('search MCP schema documents deal and EUR monthly rent price inputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-search-descriptions-'));
  const storage = openStorage(join(directory, 'test.db'));
  try {
    await withClient(createServer({ storage, adapter: new FixtureAdapter({}) }), async client => {
      const tool = (await client.listTools()).tools.find(({ name }) => name === 'search_listings');
      const criteria = tool.inputSchema.properties.criteria.properties;
      assert.match(criteria.deal.description, /sale|buy/i);
      assert.match(criteria.priceMin.description, /EUR/i);
      assert.match(criteria.priceMax.description, /EUR/i);
      assert.match(criteria.priceMin.description, /month/i);
      assert.match(criteria.priceMax.description, /month/i);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('district catalog is discoverable and mixed search districts retain valid entries with per-entry errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-district-catalog-'));
  const storage = openStorage(join(directory, 'test.db'));
  const adapter = new FixtureAdapter([[/obiavi\/prodazhbi\/grad-sofiya\/iztok/, new URL('./fixtures/search-normal.html', import.meta.url)]]);
  try {
    await withClient(createServer({ storage, adapter }), async client => {
      const tools = await client.listTools();
      assert.ok(tools.tools.some(tool => tool.name === 'get_search_districts'));
      const catalog = await client.callTool({ name: 'get_search_districts', arguments: {} });
      assert.ok(catalog.structuredContent.districts.some(item => item.slug === 'gr-bankya'));
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { districts: ['Iztok', 'Madeup One', 'Madeup Two'] }, limit: 10 } });
      assert.equal(result.isError, undefined, result.content?.[0]?.text);
      assert.equal(result.structuredContent.query.criteria.districts.length, 1);
      assert.equal(result.structuredContent.query.urls.length, 3);
      const invalid = result.structuredContent.verification.mismatches.filter(item => item.filter === 'district' && typeof item.expected === 'string');
      assert.equal(invalid.length, 2);
      assert.ok(invalid.some(item => item.expected === 'Madeup One'));
      assert.ok(invalid.some(item => item.expected === 'Madeup Two'));
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('area_context distinguishes unresolved coordinates from no stops within the requested radius', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-area-reasons-'));
  const storage = openStorage(join(directory, 'test.db'));
  const provenance = { name: 'Synthetic transit', sourceUrl: 'https://fixture.test/transit', datasetDate: 'synthetic', checkedAt: '2026-01-02', reuseTerms: 'Synthetic fixture' };
  storage.upsertListing({ id: 'unknown-location', location: { city: 'Sofia', precision: 'unknown' } });
  storage.upsertListing({ id: 'located-property', location: { city: 'Sofia', coordinates: { latitude: 42.7, longitude: 23.3 }, precision: 'exact', propertySpecificEvidence: true, source: 'synthetic-property-geocode' } });
  const sofiaData = new FixtureSofiaDataAdapter({ stops: [{ id: 'distant-fixture-stop', name: 'Imaginary Distant Stop', latitude: 42.8, longitude: 23.3, provenance }] });
  try {
    await withClient(createServer({ storage, sofiaData }), async client => {
      const unresolved = await client.callTool({ name: 'area_context', arguments: { listingId: 'unknown-location', radiusMeters: 100 } });
      assert.equal(unresolved.structuredContent.nearbyStops.status, 'unavailable');
      assert.match(unresolved.structuredContent.nearbyStops.reason, /listing location.*no coordinates/i);
      assert.doesNotMatch(unresolved.structuredContent.nearbyStops.reason, /within the radius/i);

      const outsideRadius = await client.callTool({ name: 'area_context', arguments: { listingId: 'located-property', radiusMeters: 100 } });
      assert.equal(outsideRadius.structuredContent.nearbyStops.status, 'unavailable');
      assert.match(outsideRadius.structuredContent.nearbyStops.reason, /within the radius/i);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('area_context text names nearest metro and destination with straight-line distances', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-area-summary-'));
  const storage = openStorage(join(directory, 'test.db'));
  const provenance = { name: 'Synthetic transit', sourceUrl: 'https://fixture.test/transit', datasetDate: 'synthetic', checkedAt: '2026-01-02', reuseTerms: 'Synthetic fixture' };
  storage.upsertListing({ id: 'metro-summary-property', location: { city: 'Sofia', coordinates: { latitude: 42.7, longitude: 23.3 }, precision: 'exact', propertySpecificEvidence: true, source: 'synthetic-property-geocode' } });
  const sofiaData = new FixtureSofiaDataAdapter({ stops: [{ id: 'synthetic-metro-stop', name: 'Imaginary Central Station', mode: 'metro', latitude: 42.701, longitude: 23.3, provenance }] });
  try {
    await withClient(createServer({ storage, sofiaData }), async client => {
      const result = await client.callTool({ name: 'area_context', arguments: { listingId: 'metro-summary-property', destination: { name: 'Imaginary Library', latitude: 42.702, longitude: 23.3 } } });
      assert.match(result.content[0].text, /Imaginary Central Station/);
      assert.match(result.content[0].text, /straight-line distance \d+ m/i);
      assert.match(result.content[0].text, /Imaginary Library/);
      assert.match(result.content[0].text, /Imaginary Library[^.]*\d+ m/i);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

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
      assert.equal(result.structuredContent.listings.length, 1, 'the promoted Iztok card matches the requested filters');
      assert.equal(result.structuredContent.excludedPromoted.length, 6, 'the two off-filter promoted cards are excluded from each of three fetched pages');
      assert.ok(result.structuredContent.excludedPromoted.every(item => item.pageUrl && item.listing.promotedTier));
      assert.equal(result.structuredContent.verification.ok, false);
      assert.ok(Array.isArray(result.structuredContent.verification.mismatches));
      assert.ok(result.structuredContent.verification.mismatches.length > 0);
      assert.ok(result.structuredContent.verification.mismatches.filter(item => item.listingId).every(item => item.sourcePageUrl), 'listing-level mismatches retain their source page');
      assert.ok(result.structuredContent.excludedPromoted.some(item => item.pageUrl && item.listing.promotedTier), 'off-filter promoted cards are reported separately');
      assert.equal(result.structuredContent.query.criteria.priceMin, 100000);
      assert.ok(result.structuredContent.query.urls.length <= 3);
      assert.ok(result.structuredContent.observedAt);
      assert.equal(storage.listObservations('1c100000000000001').length, 1, 'matching promoted cards are persisted as returned search observations');
      assert.match(result.content[0].text, /Found 1 listing/);
      const filtered = await client.callTool({ name: 'search_listings', arguments: { criteria: { priceMin: 130000, districts: ['iztok'] }, limit: 10 } });
      assert.deepEqual(filtered.structuredContent.listings, []);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('listing filter mismatches retain listing id and source page URL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-mismatch-trace-'));
  const storage = openStorage(join(directory, 'test.db'));
  const fixture = new URL('./fixtures/search-filter-mismatch.html', import.meta.url);
  const adapter = new FixtureAdapter([[/.*/, fixture]]);
  try {
    await withClient(createServer({ storage, adapter }), async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { deal: 'sale', maxPages: 1 }, limit: 10 } });
      const mismatches = result.structuredContent.verification.mismatches.filter(item => item.listingId);
      assert.ok(mismatches.length > 0);
      assert.ok(mismatches.every(item => typeof item.listingId === 'string' && typeof item.sourcePageUrl === 'string'));
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('page verification does not emit untraceable listing-derived mismatches', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-page-mismatch-trace-'));
  const storage = openStorage(join(directory, 'test.db'));
  const fixture = new URL('./fixtures/search-normal.html', import.meta.url);
  const adapter = new FixtureAdapter([[/.*/, fixture]]);
  try {
    await withClient(createServer({ storage, adapter }), async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { priceMin: 999999, maxPages: 1 }, limit: 10 } });
      const mismatches = result.structuredContent.verification.mismatches;
      assert.ok(mismatches.length > 0);
      assert.ok(mismatches.filter(item => item.verificationScope === 'page').every(item => typeof item.sourcePageUrl === 'string' && item.listingId === undefined));
      assert.ok(mismatches.filter(item => item.listingId).every(item => typeof item.sourcePageUrl === 'string'));
      assert.ok(mismatches.every(item => item.verificationScope === 'page' || typeof item.listingId === 'string' || item.filter === 'coverage'), 'each mismatch is traceable to a page, listing, or aggregate coverage result');
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('multi-query search reports terminated pagination and returned versus known total', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-search-coverage-'));
  const storage = openStorage(join(directory, 'test.db'));
  const fixture = new URL('./fixtures/search-last-page.html', import.meta.url);
  const adapter = new FixtureAdapter([[/.*/, fixture]]);
  try {
    await withClient(createServer({ storage, adapter }), async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { districts: ['iztok', 'lozenets'], propertyTypes: ['dvustaen', 'ednostaen'], maxPages: 2 }, limit: 10 } });
      assert.equal(adapter.requests.length, 4, 'must not request page 2 when page 1 has no next link');
      assert.match(result.content[0].text, /returned.*total|out of/i);
      assert.deepEqual(result.structuredContent.districtCounts.iztok, 0);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('search reports truncation when promoted cards consume the configured page cap', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-promoted-cap-'));
  const storage = openStorage(join(directory, 'test.db'));
  const fixture = new URL('./fixtures/search-promoted-cap.html', import.meta.url);
  const adapter = new FixtureAdapter([[/.*/, fixture]]);
  try {
    await withClient(createServer({ storage, adapter }), async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { districts: ['iztok'], priceMax: 100000, maxPages: 1 }, limit: 10 } });
      assert.ok(result.structuredContent.excludedPromoted.length > 0);
      assert.equal(result.structuredContent.truncated, true);
      assert.match(result.content[0].text, /truncated/i);
      assert.match(result.content[0].text, /promoted cards consumed page coverage/i);
      assert.equal(result.structuredContent.pages[0].totalCount, 14);
      assert.deepEqual(result.structuredContent.districtCoverage.iztok, { returned: 1, total: 14 });
      assert.match(result.content[0].text, /returned out of 14 known total/i);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('search reports each district returned count alongside its known site total', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-district-totals-'));
  const storage = openStorage(join(directory, 'test.db'));
  const adapter = new FixtureAdapter([
    [/iztok/, new URL('./fixtures/search-district-iztok-total.html', import.meta.url)],
    [/lozenets/, new URL('./fixtures/search-district-lozenets-total.html', import.meta.url)],
  ]);
  try {
    await withClient(createServer({ storage, adapter }), async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { districts: ['iztok', 'lozenets'], maxPages: 1 }, limit: 10 } });
      assert.deepEqual(result.structuredContent.districtCoverage, { iztok: { returned: 1, total: 14 }, lozenets: { returned: 1, total: 27 } });
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('search merges duplicate listing ids across requested query combinations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-search-duplicates-'));
  const storage = openStorage(join(directory, 'test.db'));
  const fixture = new URL('./fixtures/search-duplicate-card.html', import.meta.url);
  const adapter = new FixtureAdapter([[/.*/, fixture]]);
  try {
    await withClient(createServer({ storage, adapter }), async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { districts: ['iztok', 'lozenets'], maxPages: 1 }, limit: 10 } });
      const ids = result.structuredContent.listings.map(listing => listing.id);
      assert.equal(ids.filter(id => id === '1c100000000000071').length, 1);
      assert.equal(new Set(ids).size, ids.length);
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
      assert.equal(result.structuredContent.listings.length, 4, 'matching promoted fixture cards are returned alongside the ordinary card');
      assert.equal(result.structuredContent.excludedPromoted.length, 0, 'unfiltered promoted fixture cards are not excluded');
      const invalid = await client.callTool({ name: 'search_listings', arguments: { criteria: {}, limit: 9 } });
      assert.equal(invalid.isError, true);
      assert.match(invalid.content[0].text, /limit/i);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('broad searches retain matching promoted cards and count promoted type-filter omissions separately', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-broad-promoted-'));
  const storage = openStorage(join(directory, 'test.db'));
  const adapter = unrestrictedFixtureAdapter(new URL('./fixtures/search-broad-promoted.html', import.meta.url));
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { deal: 'sale', city: 'Sofia', propertyTypes: ['tristaen'], priceMax: 160000, maxPages: 1 }, limit: 10 } });
      assert.deepEqual(result.structuredContent.listings.map(item => item.id), ['1c100000000000081'], JSON.stringify({ mismatches: result.structuredContent.verification.mismatches, excluded: result.structuredContent.excludedPromoted }));
      assert.equal(result.structuredContent.excludedPromoted.length, 0, 'type-only promoted mismatches are counted as type omissions');
      assert.equal(result.structuredContent.omittedByTypeFilter, 1);
      assert.match(result.content[0].text, /Found 1 listing; filters verified/);
      assert.doesNotMatch(result.content[0].text, /Found 0 listings; filters verified/);
    });
  } finally { try { storage.close(); } catch {} await rm(directory, { recursive: true, force: true }); }
});

test('zero search results report type-filter omissions without claiming verified filters', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-type-omission-zero-'));
  const storage = openStorage(join(directory, 'test.db'));
  const fixture = new URL('./fixtures/search-type-omission.html', import.meta.url);
  const adapter = unrestrictedFixtureAdapter(fixture);
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { deal: 'sale', city: 'Sofia', propertyTypes: ['ednostaen'], maxPages: 1 }, limit: 10 } });
      assert.equal(result.structuredContent.listings.length, 0);
      assert.equal(result.structuredContent.omittedByTypeFilter, 1);
      assert.match(result.content[0].text, /1 cards were omitted/);
      assert.doesNotMatch(result.content[0].text, /filters verified/);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('search_listings returns industrial and business subtype fixtures under their URL categories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-category-authority-'));
  const storage = openStorage(join(directory, 'test.db'));
  const adapter = new FixtureAdapter([
    [/\/promishleno-pomeshtenie$/, new URL('./fixtures/search-promishleno-pomeshtenie.html', import.meta.url)],
    [/\/biznes-imot$/, new URL('./fixtures/search-biznes-imot.html', import.meta.url)],
  ]);
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      for (const [slug, label] of [['promishleno-pomeshtenie', 'ПРОМ. ПОМЕЩЕНИЕ'], ['biznes-imot', 'БАНКОВ ОФИС']]) {
        const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { propertyTypes: [slug], maxPages: 1 }, limit: 10 } });
        assert.equal(result.structuredContent.listings.length, 1);
        assert.deepEqual(result.structuredContent.listings[0].propertyType, { slug, label, rooms: null });
        assert.equal(result.structuredContent.omittedByTypeFilter, 0);
      }
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('search_listings matches every catalog category and counts cards omitted by type', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-type-catalog-'));
  const storage = openStorage(join(directory, 'test.db'));
  const types = [
    ['ednostaen', '1-СТАЕН'], ['dvustaen', '2-СТАЕН'], ['tristaen', '3-СТАЕН'], ['chetiristaen', '4-СТАЕН'],
    ['mnogostaen', 'МНОГОСТАЕН'], ['mezonet', 'МЕЗОНЕТ'], ['atelie-tavan', 'АТЕЛИЕ, ТАВАН'],
    ['etazh-ot-kashta', 'ЕТАЖ ОТ КЪЩА'], ['kashta', 'КЪЩА'], ['vila', 'ВИЛА'],
    ['garazh-parkomyasto', 'ГАРАЖ'], ['ofis', 'ОФИС'], ['magazin', 'МАГАЗИН'], ['zavedenie', 'ЗАВЕДЕНИЕ'],
    ['sklad', 'СКЛАД'], ['promishleno-pomeshtenie', 'ПРОМИШЛЕНО ПОМЕЩЕНИЕ'], ['hotel', 'ХОТЕЛ'],
    ['biznes-imot', 'БИЗНЕС ИМОТ'], ['partsel', 'ПАРЦЕЛ'], ['staya', 'СТАЯ'],
  ];
  const cards = types.map(([slug, label], index) => `<div class="item${slug === 'kashta' ? ' TOP' : ''}" id="ida1c100000000000${String(index + 1).padStart(3, '0')}"><div class="text"><div class="zagлавие"><a class="title" href="/obiava-1c100000000000${String(index + 1).padStart(3, '0')}-synthetic">Продава ${label} <location>град София, Изток</location></a></div><div class="price">100 000 €</div></div><div class="info">50 кв.м</div></div>`).join('');
  const fixture = join(directory, 'catalog.html');
  await (await import('node:fs/promises')).writeFile(fixture, `<html><body>${cards}</body></html>`);
  try {
    for (const [slug] of types) {
      const adapter = unrestrictedFixtureAdapter(fixture);
      await withClient(createServer({ adapter, storage }), async client => {
        const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { deal: 'sale', city: 'Sofia', propertyTypes: [slug], maxPages: 1 }, limit: 20 } });
        assert.equal(result.isError, undefined, result.content?.[0]?.text);
        assert.equal(result.structuredContent.listings.length, 1, `should return catalog type ${slug}`);
        if (slug === 'kashta') assert.match(result.structuredContent.listings[0].propertyType.label, /КЪЩА/i);
        assert.equal(result.structuredContent.omittedByTypeFilter, types.length - 1);
        assert.equal(result.structuredContent.excludedPromoted.length, 0);
      });
    }
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
  storage.recordObservation({ listingId: '1c100000000000001', observedAt: new Date().toISOString(), sourceUrl: 'https://www.imot.bg/obiavi/prodazhbi/grad-sofiya', raw: {}, normalized: { id: '1c100000000000001', priceLowered: true, seller: { kind: 'agency', name: 'Картична Агенция' }, location: { city: 'Друг Град', district: 'Другаде', street: null, precision: 'neighbourhood' } } });
  try {
    const server = createServer({ adapter, storage });
    await withClient(server, async client => {
      const first = await client.callTool({ name: 'get_listing', arguments: { url } });
      assert.equal(first.structuredContent.status, undefined);
      const searchType = parseSearchResults(await readFile(new URL('./fixtures/search-normal.html', import.meta.url), 'utf8')).listings[0].propertyType;
      assert.deepEqual(first.structuredContent.listing.propertyType, searchType);
      assert.deepEqual(searchType, { slug: 'tristaen', label: '3-СТАЕН', rooms: 3 });
      assert.equal(first.structuredContent.listing.seller.name, 'Картична Агенция');
      assert.equal(first.structuredContent.listing.seller.authority, 'detail');
      assert.equal(first.structuredContent.listing.seller.conflict, false);
      assert.equal(first.structuredContent.evidenceReconciliation.authority, 'detail');
      assert.ok(first.structuredContent.evidenceReconciliation.discrepancies.some(item => item.field === 'priceLowered'));
      assert.ok(first.structuredContent.evidenceReconciliation.discrepancies.some(item => item.field === 'seller'));
      assert.ok(first.structuredContent.evidenceReconciliation.discrepancies.some(item => item.field === 'location'));
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

for (const scenario of [
  { label: 'agency card and owner description', kind: 'agency', cardName: 'Агенция Измислен Пример', sellerType: 'Агенция', description: 'Измисленият имот се продава директно от собственик.' },
  { label: 'private card and agency description', kind: 'private', cardName: 'Частно лице', sellerType: 'Частно лице', description: 'Измисленият имот се продава чрез агенция.' },
]) {
  test(`get_listing flags seller conflict for ${scenario.label} on fresh, cached and refreshed reads`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'imoti-seller-conflict-'));
    const storage = openStorage(join(directory, 'test.db'));
    const id = '1c100000000000091';
    const url = `https://www.imot.bg/obiava-${id}-synthetic`;
    const searchFixture = join(directory, 'search.html');
    const detailFixture = join(directory, 'detail.html');
    try {
      await writeFile(searchFixture, `<div class="item" id="ida${id}"><a class="title" href="${url}">Продава 2-СТАЕН<location>град София, Изток</location></a><div class="seller"><div class="sInfo"><div class="name">${scenario.cardName}</div></div></div></div>`);
      await writeFile(detailFixture, `<div class="advHeader"><div class="title">Продава 2-СТАЕН</div></div><div class="adPrice"><div class="price"><div class="cena">100 000 €</div></div></div><div class="dealer2023"><div class="sellerType">${scenario.sellerType}</div><div class="name">${scenario.cardName}</div></div><div class="moreInfo"><div class="text">${scenario.description}</div></div>`);
      const adapter = new FixtureAdapter([
        [/obiavi\/prodazhbi/, searchFixture],
        [/obiava-/, detailFixture],
      ]);
      await withClient(createServer({ adapter, storage }), async client => {
        const search = await client.callTool({ name: 'search_listings', arguments: { criteria: { maxPages: 1 }, limit: 10 } });
        assert.equal(search.isError, undefined, search.content?.[0]?.text);
        assert.deepEqual(search.structuredContent.listings[0].seller, { kind: scenario.kind, name: scenario.cardName });
        const expectedSeller = { kind: scenario.kind, name: scenario.kind === 'agency' ? scenario.cardName : null, authority: 'detail', conflict: true, ...(scenario.kind === 'agency' ? { evidence: { description: scenario.description, structured: 'Агенция' } } : {}) };
        for (const [arguments_, cached] of [[{ url }, false], [{ id }, true], [{ id, refresh: true }, false]]) {
          const result = await client.callTool({ name: 'get_listing', arguments: arguments_ });
          assert.equal(result.isError, undefined, result.content?.[0]?.text);
          assert.equal(result.structuredContent.cached, cached);
          assert.equal(result.structuredContent.listing.description, scenario.description);
          assert.deepEqual(result.structuredContent.listing.seller, expectedSeller);
          assert.equal(result.structuredContent.evidenceReconciliation.authority, 'detail');
        }
        assert.equal(adapter.requests.filter(request => request.includes('/obiava-')).length, 2, 'cached reads reuse detail evidence; refresh fetches it again');
      });
    } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
  });
}

test('get_listing reconciles structured price and district against synthetic description claims', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-description-conflicts-'));
  const storage = openStorage(join(directory, 'test.db'));
  const id = '1c100000000000092';
  const url = `https://www.imot.bg/obiava-${id}-synthetic`;
  const searchFixture = join(directory, 'search.html');
  const detailFixture = join(directory, 'detail.html');
  try {
    await writeFile(searchFixture, `<div class="item" id="ida${id}"><a class="title" href="${url}">Продава 2-СТАЕН<location>град София, Младост 3</location></a><div class="price">620 €</div></div>`);
    await writeFile(detailFixture, '<div class="advHeader"><div class="title">Продава 2-СТАЕН</div><div class="location">София, Младост 3</div></div><div class="adPrice"><div class="price"><div class="cena">620 €</div></div></div><div class="moreInfo"><div class="text">Измислено жилище в кв. Младост 4 за 700 EUR.</div></div>');
    const adapter = new FixtureAdapter([[/obiavi\/prodazhbi/, searchFixture], [/obiava-/, detailFixture]]);
    await withClient(createServer({ adapter, storage }), async client => {
      const result = await client.callTool({ name: 'get_listing', arguments: { url } });
      const discrepancies = result.structuredContent.evidenceReconciliation.discrepancies;
      const price = discrepancies.find(item => item.field === 'price');
      assert.deepEqual(price, { field: 'price', card: { description: 700 }, detail: { amount: 620, currency: 'EUR' } });
      const location = discrepancies.find(item => item.field === 'location');
      assert.deepEqual(location, { field: 'location', card: { descriptionDistrict: 'Младост 4' }, detail: { district: 'Младост 3' } });
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('get_listing_photos returns ordered bounded metadata and does not persist image bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-photos-'));
  const databasePath = join(directory, 'test.db');
  const storage = openStorage(databasePath);
  const listingId = 'fake-photo-listing';
  const references = ['https://images.fake.test/second.jpg', 'https://images.fake.test/first.png'];
  storage.upsertListing({ id: listingId, photos: references });
  const adapter = new FixtureAdapter({}, { photos: { [references[1]]: new Error('Generated fixture image unavailable.') } });
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      const result = await client.callTool({ name: 'get_listing_photos', arguments: { listingId } });
      assert.equal(result.isError, undefined, result.content?.[0]?.text);
      assert.equal(result.structuredContent.listingId, listingId);
      assert.deepEqual(result.structuredContent.photos.map(photo => photo.reference), references);
      assert.equal(Object.hasOwn(result.structuredContent.photos[0], 'bytes'), false);
      assert.equal(result.structuredContent.photos[1].unavailableReason, 'Generated fixture image unavailable.');
      assert.ok(result.structuredContent.photos.every(photo => photo.mediaType.startsWith('image/')));
      assert.ok(result.structuredContent.uncertainty.includes(`Photo ${references[1]}: Generated fixture image unavailable.`));
      assert.ok(result.structuredContent.uncertainty.some(item => item.includes('coverage is incomplete')));
    });
    assert.deepEqual(storage.getListing(listingId).photos, references, 'stored listing retains only the references');
    assert.equal(Object.hasOwn(storage.getListing(listingId), 'bytes'), false);
  } finally { try { storage.close(); } catch {} await rm(directory, { recursive: true, force: true }); }
});

test('photo responses assess only the bounded page, expose assessment host blocks, and continue by offset', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-photo-pages-'));
  const storage = openStorage(join(directory, 'test.db'));
  const refs = Array.from({ length: 6 }, (_, i) => `https://fake.test/${i}.jpg`);
  storage.upsertListing({ id: 'six-photos', photos: refs });
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 2, 128, 1, 64, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0]);
  const adapter = new FixtureAdapter({}, { photos: Object.fromEntries(refs.map(ref => [ref, bytes])) });
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      const result = await client.callTool({ name: 'get_listing_photos', arguments: { listingId: 'six-photos' } });
      assert.equal(result.structuredContent.assessment.images.length, 3);
      assert.ok(result.structuredContent.assessment.images.every(image => image.width === 320 && image.height === 640));
      assert.equal(result.structuredContent.nextOffset, 3);
      assert.equal(result.content.filter(block => block.type === 'image').length, 3);
      assert.ok(result.content.filter(block => block.type === 'image').every(block => block.data === Buffer.from(bytes).toString('base64')));
      assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 64 * 1024);
      assert.doesNotMatch(JSON.stringify(result), /"bytes"\s*:\s*\[/);
      const next = await client.callTool({ name: 'get_listing_photos', arguments: { listingId: 'six-photos', offset: 3 } });
      assert.equal(next.content.filter(block => block.type === 'image').length, 3);
      assert.equal(next.structuredContent.nextOffset, null);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('photo pagination retrieves only a bounded subset per call and walks the complete synthetic inventory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-photo-bounds-'));
  const storage = openStorage(join(directory, 'test.db'));
  const refs = Array.from({ length: 11 }, (_, i) => `https://images.fake.test/synthetic-${i}.jpg`);
  storage.upsertListing({ id: 'synthetic-inventory', photos: refs });
  const adapter = new FixtureAdapter({}, { photos: Object.fromEntries(refs.map(ref => [ref, new Uint8Array(128)])) });
  const requested = [];
  const original = adapter.getListingPhotos.bind(adapter);
  adapter.getListingPhotos = async (id, references) => { requested.push(...references); return original(id, references); };
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      let offset = 0;
      const observed = [];
      do {
        const result = await client.callTool({ name: 'get_listing_photos', arguments: { listingId: 'synthetic-inventory', offset } });
        observed.push(...result.structuredContent.photos.map(photo => photo.reference));
        assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 64 * 1024);
        offset = result.structuredContent.nextOffset;
      } while (offset !== null);
      assert.deepEqual(observed, refs);
      assert.equal(requested.length, refs.length);
      assert.equal(new Set(requested).size, refs.length);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('photo retrieval retains three images at the individual and per-call boundaries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-photo-byte-budget-'));
  const storage = openStorage(join(directory, 'test.db'));
  const refs = ['https://images.fake.test/small.jpg', 'https://images.fake.test/medium.jpg', 'https://images.fake.test/large.jpg', 'https://images.fake.test/oversized.jpg'];
  storage.upsertListing({ id: 'byte-budget-inventory', photos: refs });
  const adapter = new FixtureAdapter({}, { photos: {
    [refs[0]]: new Uint8Array(200_000),
    [refs[1]]: new Uint8Array(200_000),
    [refs[2]]: new Uint8Array(200_000),
    [refs[3]]: new Uint8Array(200_001),
  } });
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      const first = await client.callTool({ name: 'get_listing_photos', arguments: { listingId: 'byte-budget-inventory' } });
      assert.equal(first.content.filter(block => block.type === 'image').length, 3);
      assert.ok(first.content.filter(block => block.type === 'image').every(block => Buffer.from(block.data, 'base64').byteLength <= 200_000));
      assert.equal(first.structuredContent.photos[0].unavailableReason, undefined);
      assert.equal(first.structuredContent.photos[2].unavailableReason, undefined);
      assert.equal(first.structuredContent.nextOffset, 3);
      assert.ok(Buffer.byteLength(JSON.stringify(first), 'utf8') < 1_000_000);
      const next = await client.callTool({ name: 'get_listing_photos', arguments: { listingId: 'byte-budget-inventory', offset: 3 } });
      assert.match(next.structuredContent.photos[0].unavailableReason, /per-image limit/i);
      assert.equal(next.structuredContent.nextOffset, null);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('photo retrieval deadline aborts a stalled adapter and allows pagination to continue', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-photo-deadline-'));
  const storage = openStorage(join(directory, 'test.db'));
  const refs = Array.from({ length: 4 }, (_, i) => `https://images.fake.test/deadline-${i}.jpg`);
  storage.upsertListing({ id: 'deadline-inventory', photos: refs });
  const adapter = new FixtureAdapter({});
  const requestedOffsets = [];
  let aborted = false;
  adapter.getListingPhotos = async (_id, references, { signal } = {}) => {
    requestedOffsets.push(references[0]);
    if (references[0] === refs[0]) return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true });
    });
    return references.map(reference => ({ listingId: 'deadline-inventory', reference, mediaType: 'image/jpeg' }));
  };
  try {
    await withClient(createServer({ adapter, storage, photoRetrievalTimeoutMs: 20 }), async client => {
      const started = Date.now();
      const slow = await client.callTool({ name: 'get_listing_photos', arguments: { listingId: 'deadline-inventory' } });
      assert.ok(Date.now() - started < 500, 'stalled retrieval is bounded by its configured deadline');
      assert.equal(slow.isError, true);
      assert.match(slow.content[0].text, /deadline/i);
      assert.equal(aborted, true);
      const continued = await client.callTool({ name: 'get_listing_photos', arguments: { listingId: 'deadline-inventory', offset: 3 } });
      assert.deepEqual(continued.structuredContent.photos.map(photo => photo.reference), [refs[3]]);
      assert.equal(continued.structuredContent.nextOffset, null);
      assert.deepEqual(requestedOffsets, [refs[0], refs[3]]);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('photo assessment host blocks retain the assessed original image bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-photo-variants-'));
  const storage = openStorage(join(directory, 'test.db'));
  const reference = 'https://imotstatic1.focus.bg/photosimotbg/a/b/big1/photo.jpg';
  const preview = 'https://imotstatic1.focus.bg/photosimotbg/a/b/big/photo.jpg';
  storage.upsertListing({ id: 'variant-photo', photos: [reference] });
  const originalBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 2, 128, 1, 64, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0]);
  const previewBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 1, 194, 3, 32, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0]);
  const adapter = new FixtureAdapter({}, { photos: { [reference]: originalBytes, [preview]: previewBytes } });
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      const result = await client.callTool({ name: 'get_listing_photos', arguments: { listingId: 'variant-photo' } });
      assert.equal(result.content.filter(block => block.type === 'image').length, 1);
      assert.equal(result.content.find(block => block.type === 'image').data, Buffer.from(originalBytes).toString('base64'));
      assert.equal(result.structuredContent.assessment.images[0].width, 320);
      assert.equal(result.structuredContent.assessment.images[0].height, 640);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('photo assessment does not claim attached images when no host block is eligible', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-photo-empty-host-'));
  const storage = openStorage(join(directory, 'test.db'));
  const reference = 'https://images.fake.test/oversized.png';
  storage.upsertListing({ id: 'no-host-images', photos: [reference] });
  const adapter = new FixtureAdapter({}, { photos: { [reference]: new Uint8Array(200_001) } });
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      const result = await client.callTool({ name: 'get_listing_photos', arguments: { listingId: 'no-host-images' } });
      assert.equal(result.content.filter(block => block.type === 'image').length, 0);
      assert.match(result.content[0].text, /No image content was attached/);
      assert.doesNotMatch(result.content[0].text, /Assess the attached image content/);
      assert.ok(result.structuredContent.uncertainty.some(text => text.includes(reference) && /200,?000-byte per-image limit/i.test(text)));
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('get_listing_photos reports unavailable listing as an explicit tool error', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-photos-missing-'));
  const storage = openStorage(join(directory, 'test.db'));
  try {
    await withClient(createServer({ adapter: new FixtureAdapter({}), storage }), async client => {
      const result = await client.callTool({ name: 'get_listing_photos', arguments: { listingId: 'missing' } });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /not found/i);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('compare_listings returns stored evidence and bounded asking-price sample metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-compare-'));
  const storage = openStorage(join(directory, 'test.db'));
  storage.upsertListing({ id: 'compare-a', price: { amount: 200000, currency: 'EUR' }, area: 100, photos: ['fake-photo'], photoAssessment: { findings: ['bright room'], uncertainty: ['limited view'] }, location: { city: 'Fake City', district: 'North', precision: 'neighbourhood' } }, '2026-02-01T00:00:00.000Z');
  storage.upsertListing({ id: 'compare-b', price: { amount: 300000, currency: 'EUR' }, area: 120, location: { district: 'South', precision: 'street', street: 'Fake Street' } }, '2026-02-10T00:00:00.000Z');
  storage.upsertListing({ id: 'compare-c', price: { amount: 900000, currency: 'USD' }, area: 90 }, '2026-03-01T00:00:00.000Z');
  try {
    await withClient(createServer({ storage }), async client => {
      const result = await client.callTool({ name: 'compare_listings', arguments: { listingIds: ['compare-a', 'compare-b'] } });
      assert.equal(result.isError, undefined, result.content?.[0]?.text);
      const { listings, askingPricePositioning } = result.structuredContent;
      assert.equal(listings.length, 2);
      assert.deepEqual(listings[0].price, { amount: 200000, currency: 'EUR' });
      assert.deepEqual(listings[0].pricePerSquareMeter, { amount: 2000, currency: 'EUR' });
      assert.deepEqual(listings[0].photoAssessment, { findings: ['bright room'], uncertainty: ['limited view'] });
      assert.equal(listings[0].location.precision, 'neighbourhood');
      assert.ok(listings[0].uncertainty.length);
      assert.equal(listings[1].photoAssessment, null);
      assert.ok(listings[1].explanations.photoAssessment);
      assert.deepEqual(askingPricePositioning, { basis: 'observed asking prices only; not completed sales or a market-wide valuation; period covers supplied observations with available timestamps', sampleSize: 2, currency: 'EUR', period: { from: '2026-02-01T00:00:00.000Z', to: '2026-02-10T00:00:00.000Z' }, minimum: 200000, median: 250000, maximum: 300000 });
      assert.match(askingPricePositioning.basis, /not completed sales/);
      assert.equal(JSON.stringify(result).toLowerCase().includes('hidden defect'), false);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('comparison labels rent monthly, preserves deal and VAT, and warns for partial-area €/m²', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-compare-terms-'));
  const storage = openStorage(join(directory, 'test.db'));
  storage.upsertListing({ id: 'sale-x', dealType: 'sale', price: { amount: 200000, currency: 'EUR' }, areaM2: 80, areaScope: 'part', vatNote: 'Цената е с включено ДДС' });
  storage.upsertListing({ id: 'rent-x', dealType: 'rent', price: { amount: 1200, currency: 'EUR' }, areaM2: 60 });
  try {
    await withClient(createServer({ storage }), async client => {
      const result = await client.callTool({ name: 'compare_listings', arguments: { listingIds: ['sale-x', 'rent-x'] } });
      const [sale, rent] = result.structuredContent.listings;
      assert.equal(sale.dealType, 'sale');
      assert.equal(sale.vatTerms, 'Цената е с включено ДДС');
      assert.match(sale.uncertainty.join(' '), /partial|part of the property/i);
      assert.equal(rent.dealType, 'rent');
      assert.equal(rent.pricePeriod, 'per month');
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('comparison excludes auction amounts from asking-price pooling and puts property context beside €/m²', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-compare-auction-'));
  const storage = openStorage(join(directory, 'test.db'));
  storage.upsertListing({ id: 'ordinary-a', dealType: 'sale', price: { amount: 200000, currency: 'EUR' }, areaM2: 100, floor: -1, construction: 'Тухла', constructionPeriod: '2020 г.', vatNote: 'Без ДДС' });
  storage.upsertListing({ id: 'auction-b', dealType: 'sale', price: { amount: 100000, currency: 'EUR' }, areaM2: 80, facts: { auction: { value: true, source: 'На търг.' } } });
  try {
    await withClient(createServer({ storage }), async client => {
      const result = await client.callTool({ name: 'compare_listings', arguments: { listingIds: ['ordinary-a', 'auction-b'] } });
      const [ordinary, auction] = result.structuredContent.listings;
      assert.equal(auction.pricePeriod, 'auction/public-sale price');
      assert.equal(result.structuredContent.askingPricePositioning.sampleSize, 1);
      assert.equal(ordinary.comparisonContext.basement, true);
      assert.equal(ordinary.comparisonContext.construction, 'Тухла');
      assert.equal(ordinary.comparisonContext.vat, 'Без ДДС');
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('comparison flags top floor beside €/m² only when the total floor count is known and matches', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-compare-top-floor-'));
  const storage = openStorage(join(directory, 'test.db'));
  try {
    for (const listing of [
      { id: 'top-floor', floor: 6, floorsTotal: 6 },
      { id: 'middle-floor', floor: 3, floorsTotal: 6 },
      { id: 'unknown-total', floor: 6 },
    ]) {
      storage.upsertListing({ ...listing, dealType: 'sale', price: { amount: 180000, currency: 'EUR' }, areaM2: 90 });
    }
    await withClient(createServer({ storage }), async client => {
      const result = await client.callTool({ name: 'compare_listings', arguments: { listingIds: ['top-floor', 'middle-floor', 'unknown-total'] } });
      assert.equal(result.isError, undefined, result.content?.[0]?.text);
      const [top, middle, unknown] = result.structuredContent.listings;
      assert.deepEqual(top.pricePerSquareMeter, { amount: 2000, currency: 'EUR' });
      assert.equal(top.comparisonContext.topFloor, true);
      assert.equal(top.comparisonContext.basement, false);
      assert.equal(top.comparisonContext.floor, 6);
      assert.equal(top.comparisonContext.floorsTotal, 6);
      assert.equal(middle.comparisonContext.topFloor, false);
      assert.equal(unknown.comparisonContext.topFloor, false);
      assert.equal(unknown.comparisonContext.floorsTotal, null);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('compare_listings rejects fewer than two, more than ten, and duplicate IDs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-compare-invalid-'));
  const storage = openStorage(join(directory, 'test.db'));
  try {
    await withClient(createServer({ storage }), async client => {
      for (const listingIds of [['a'], Array.from({ length: 11 }, (_, i) => String(i)), ['a', 'a']]) {
        const result = await client.callTool({ name: 'compare_listings', arguments: { listingIds } });
        assert.equal(result.isError, true);
      }
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('compare_listings explains absent evidence and does not mix currencies in positioning', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-compare-missing-'));
  const storage = openStorage(join(directory, 'test.db'));
  storage.upsertListing({ id: 'usd-listing', price: { amount: 120000, currency: 'USD' } }, '2026-04-01T00:00:00.000Z');
  storage.upsertListing({ id: 'eur-listing', price: { amount: 100000, currency: 'EUR' } }, '2026-04-02T00:00:00.000Z');
  try {
    await withClient(createServer({ storage }), async client => {
      const result = await client.callTool({ name: 'compare_listings', arguments: { listingIds: ['usd-listing', 'eur-listing', 'not-stored'] } });
      const [usd, eur, missing] = result.structuredContent.listings;
      assert.equal(usd.areaM2, null);
      assert.equal(usd.pricePerSquareMeter, null);
      assert.ok(usd.explanations.areaM2);
      assert.deepEqual(usd.price, { amount: 120000, currency: 'USD' });
      assert.deepEqual(eur.price, { amount: 100000, currency: 'EUR' });
      assert.equal(missing.price, null);
      assert.ok(missing.explanations.price);
      assert.equal(result.structuredContent.askingPricePositioning.sampleSize, 2);
      assert.equal(result.structuredContent.askingPricePositioning.currency, null);
      assert.equal(result.structuredContent.askingPricePositioning.period.from, '2026-04-01T00:00:00.000Z');
      assert.equal(result.structuredContent.askingPricePositioning.period.to, '2026-04-02T00:00:00.000Z');
      assert.equal(result.structuredContent.askingPricePositioning.minimum, null);
      assert.match(result.structuredContent.askingPricePositioning.basis, /period covers supplied observations with available timestamps/);
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
      assert.equal(storage.listChanges().filter(event => event.listingId === id && event.kind === 'price_change').length, 0, 'a card must not be compared against an earlier detail-page observation');
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('card observations compare only with prior card observations when detail fields differ', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-source-snapshots-'));
  const storage = openStorage(join(directory, 'test.db'));
  const id = '1c100000000000099';
  storage.recordObservation({ listingId: id, observedAt: '2026-01-01T00:00:00.000Z', sourceUrl: `https://www.imot.bg/obiava-${id}`, raw: {}, normalized: { id, title: 'Invented home', price: { amount: 125000, currency: 'EUR' }, location: { precision: 'neighbourhood', district: 'Изток' }, construction: 'not supplied', seller: { name: 'not supplied' } } });
  const html = `<div class="item" id="ida${id}"><a class="title" href="/obiava-${id}">Продава 3-СТАЕН <location>град София, Изток</location></a><div class="price">125 000 €</div><div class="info">ул. Измислена 7, Тухла</div><div class="seller"><div class="name">Агенция Пример</div></div></div>`;
  const adapter = { async fetchPage(url) { return { url, status: 200, html, fetchedAt: new Date() }; }, async close() {} };
  storage.saveSearch({ id: 'source-test', criteria: {}, createdAt: '2026-01-01T00:00:00.000Z' });
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      await client.callTool({ name: 'refresh_watched', arguments: {} });
      await client.callTool({ name: 'refresh_watched', arguments: {} });
      assert.equal(storage.listChanges().filter(event => event.listingId === id && event.kind === 'edited').length, 0);
      assert.equal(storage.listObservations(id).filter(observation => !observation.sourceUrl.includes('/obiava-')).length, 2);
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
      assert.deepEqual(result.structuredContent.districtCoverage, { iztok: { returned: 9, total: null }, lozenets: { returned: 1, total: null } });
      assert.deepEqual(result.structuredContent.listings.map(listing => listing.id), [
        '1c100000000000011', '1c100000000000099', '1c100000000000012', '1c100000000000013', '1c100000000000014',
        '1c100000000000015', '1c100000000000016', '1c100000000000017', '1c100000000000018', '1c100000000000019',
      ]);
      assert.ok(result.structuredContent.listings.length <= 10);
      assert.equal(adapter.requests.length, result.structuredContent.query.urls.length);
      assert.ok(result.structuredContent.query.urls.some(url => new URL(url).pathname.split('/').includes('iztok')));
      assert.ok(result.structuredContent.query.urls.some(url => new URL(url).pathname.split('/').includes('lozenets')));
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
  const adapter = unrestrictedFixtureAdapter(new URL('./fixtures/search-normal.html', import.meta.url));
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

test('search_listings round-robins requested types before applying the limit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-type-interleave-'));
  const storage = openStorage(join(directory, 'test.db'));
  const page = (type, label, prefix, pageNumber = 1) => `<!doctype html><html><body>${Array.from({ length: 21 }, (_, index) => {
    const id = `1c${prefix}${String(index + 1).padStart(12, '0')}`;
    return `<div class="item" id="ida${id}"><div class="text"><div class="zaglavie"><a class="title" href="/obiava-${id}-invented">Продава ${label} <location>град София, Изток</location></a></div><div class="price">${100 + index} 000 €</div></div><div class="info">${30 + index} кв.м, invented details</div></div>`;
  }).join('')}${pageNumber < 4 ? `<a class="saveSlink next" href="/obiavi/prodazhbi/grad-sofiya/tristaen/p-${pageNumber + 1}">next</a>` : ''}</body></html>`;
  const adapter = { fetchPage: async url => ({ html: page(url.includes('/ednostaen') ? 'ednostaen' : 'dvustaen', url.includes('/ednostaen') ? '1-СТАЕН' : '2-СТАЕН', url.includes('/ednostaen') ? '11' : '22', Number(new URL(url).pathname.match(/p-(\d+)/)?.[1] ?? 1)), url, status: 200, fetchedAt: new Date() }), close: async () => {} };
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { propertyTypes: ['ednostaen', 'dvustaen'], maxPages: 1 }, limit: 20 } });
      const listings = result.structuredContent.listings;
      assert.equal(listings.length, 20);
      assert.ok(listings.some(item => item.propertyType.slug === 'ednostaen'));
      assert.ok(listings.some(item => item.propertyType.slug === 'dvustaen'));
      assert.equal(new Set(listings.map(item => item.id)).size, listings.length);
      assert.deepEqual(listings.slice(0, 4).map(item => item.propertyType.slug), ['ednostaen', 'dvustaen', 'ednostaen', 'dvustaen']);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('search_listings round-robins candidates across pages and reports contributing pages', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-page-spread-'));
  const storage = openStorage(join(directory, 'test.db'));
  const page = pageNumber => `<!doctype html><html><body>${Array.from({ length: 12 }, (_, index) => {
    const id = `1c${pageNumber}${String(index + 1).padStart(14, '0')}`;
    return `<div class="item" id="ida${id}"><div class="text"><div class="zaglavie"><a class="title" href="/obiava-${id}-invented">Продава 3-СТАЕН <location>град София</location></a></div><div class="price">${100 + index} 000 €</div></div><div class="info">${50 + index} кв.м, invented details</div></div>`;
  }).join('')}${pageNumber < 4 ? `<a class="saveSlink next" href="/obiavi/prodazhbi/grad-sofiya/tristaen/p-${pageNumber + 1}">next</a>` : ''}</body></html>`;
  const adapter = { fetchPage: async url => ({ html: page(Number(new URL(url).pathname.match(/p-(\d+)/)?.[1] ?? 1)), url, status: 200, fetchedAt: new Date() }), close: async () => {} };
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { startPage: 2 }, limit: 10 } });
      assert.equal(result.structuredContent.listings.length, 10);
      assert.deepEqual(result.structuredContent.contributingPages, [2, 3, 4]);
      assert.equal(result.structuredContent.pagesFetched, 3);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('search_listings spreads results beyond an overfull first page by default', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-default-page-spread-'));
  const storage = openStorage(join(directory, 'test.db'));
  const page = pageNumber => `<!doctype html><html><body>${Array.from({ length: 12 }, (_, index) => {
    const id = `1c${pageNumber}${String(index + 1).padStart(14, '0')}`;
    return `<div class="item" id="ida${id}"><div class="text"><div class="zaglavie"><a class="title" href="/obiava-${id}-invented">Продава 3-СТАЕН <location>град София</location></a></div><div class="price">${100 + index} 000 €</div></div><div class="info">${50 + index} кв.м, invented details</div></div>`;
  }).join('')}${Number(pageNumber) < 3 ? `<a class="saveSlink next" href="/obiavi/prodazhbi/grad-sofiya/tristaen/p-${Number(pageNumber) + 1}">next</a>` : ''}</body></html>`;
  const adapter = { fetchPage: async url => ({ html: page(Number(new URL(url).pathname.match(/p-(\d+)/)?.[1] ?? 1)), url, status: 200, fetchedAt: new Date() }), close: async () => {} };
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: {}, limit: 10 } });
      const listings = result.structuredContent.listings;
      assert.equal(listings.length, 10);
      assert.ok(listings.some(item => item.id.startsWith('1c2')), 'page 2 contributes distinct candidates');
      assert.ok(listings.some(item => item.id.startsWith('1c3')), 'page 3 contributes distinct candidates');
      assert.deepEqual(result.structuredContent.contributingPages, [1, 2, 3]);
      assert.deepEqual([...new Set(listings.map(item => Number(item.id.slice(2, 3))))], [1, 2, 3]);
      assert.equal(result.structuredContent.pagesFetched, 3);
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

test('search output retains pagination metadata for every fetched page', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-search-pages-'));
  const storage = openStorage(join(directory, 'test.db'));
  const adapter = new FixtureAdapter([[/obiavi\/prodazhbi/, new URL('./fixtures/search-iztok-matching.html', import.meta.url)]]);
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { districts: ['iztok'], maxPages: 1 }, limit: 10 } });
      assert.deepEqual(result.structuredContent.pages.map(({ pageNumber, totalCount, nextPageUrl, pageUrl }) => ({ pageNumber, totalCount, nextPageUrl, pageUrl })), [{ pageNumber: 1, totalCount: 12, nextPageUrl: 'https://www.imot.bg/obiavi/prodazhbi/grad-sofiya/iztok/tristaen/p-2', pageUrl: result.structuredContent.query.urls[0] }]);
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
        assert.ok(result.structuredContent.query.urls.length <= (criteria.maxPages ?? 3) * (criteria.districts?.length ?? 1) * (criteria.propertyTypes?.length || 1));
        for (const listing of result.structuredContent.listings) {
          assert.equal(storage.listObservations(listing.id).length, 1);
        }
      });
    } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
  });
}

test('search returns fixture results for every requested type/district combination', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-tools-'));
  const storage = openStorage(join(directory, 'test.db'));
  const adapter = new FixtureAdapter([
    [/\/iztok\/dvustaen(?:\/|$)/, new URL('./fixtures/search-iztok-dvustaen.html', import.meta.url)],
    [/\/lozenets\/dvustaen(?:\/|$)/, new URL('./fixtures/search-lozenets-dvustaen.html', import.meta.url)],
    [/\/iztok\/ednostaen(?:\/|$)/, new URL('./fixtures/search-iztok-ednostaen.html', import.meta.url)],
    [/\/lozenets\/ednostaen(?:\/|$)/, new URL('./fixtures/search-lozenets-ednostaen.html', import.meta.url)],
  ]);
  try {
    const server = createServer({ adapter, storage });
    await withClient(server, async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { districts: ['iztok', 'lozenets'], propertyTypes: ['dvustaen', 'ednostaen'], maxPages: 1 }, limit: 10 } });
      const urls = result.structuredContent.query.urls;
      assert.equal(urls.length, 4);
      assert.deepEqual(urls.map(url => new URL(url).pathname.split('/').slice(-2)), [['iztok', 'dvustaen'], ['lozenets', 'dvustaen'], ['iztok', 'ednostaen'], ['lozenets', 'ednostaen']]);
      assert.deepEqual(result.structuredContent.coverage.propertyTypes.sort(), ['dvustaen', 'ednostaen']);
      assert.deepEqual(result.structuredContent.coverage.districts.sort(), ['iztok', 'lozenets']);
      assert.deepEqual(result.structuredContent.listings.map(listing => [listing.location.district, listing.propertyType.slug]).sort(), [
        ['Изток', 'dvustaen'], ['Изток', 'ednostaen'], ['Лозенец', 'dvustaen'], ['Лозенец', 'ednostaen'],
      ]);
      assert.equal(result.structuredContent.pagesFetched, 4);
      assert.deepEqual(result.structuredContent.pages.map(page => page.pageNumber), [1, 1, 1, 1]);
      assert.deepEqual(result.structuredContent.districtCounts, { iztok: 2, lozenets: 2 });
      assert.equal(result.structuredContent.verification.ok, true);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('exact room-count searches report their derived property type in coverage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-derived-coverage-'));
  const storage = openStorage(join(directory, 'test.db'));
  const adapter = new FixtureAdapter([[/obiavi\/prodazhbi/, new URL('./fixtures/search-iztok-matching.html', import.meta.url)]]);
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { rooms: { min: 3, max: 3 }, districts: ['iztok'], maxPages: 1 }, limit: 10 } });
      assert.deepEqual(result.structuredContent.coverage.propertyTypes, ['tristaen']);
      assert.equal(result.structuredContent.verification.ok, true);
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('a matching returned listing verifies while an off-filter promoted card is reported separately', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-matching-promotion-'));
  const storage = openStorage(join(directory, 'test.db'));
  const adapter = new FixtureAdapter([[/obiavi\/prodazhbi/, new URL('./fixtures/search-broad-districts.html', import.meta.url)]]);
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { priceMin: 100000, maxPages: 1 }, limit: 10 } });
      assert.equal(result.structuredContent.listings.length, 2);
      assert.equal(result.structuredContent.excludedPromoted.length, 1);
      assert.ok(result.structuredContent.excludedPromoted.every(({ pageUrl }) => pageUrl));
      assert.equal(result.structuredContent.verification.ok, true, JSON.stringify(result.structuredContent.verification.mismatches));
    });
  } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('broad district search returns synthetic results beyond the initial alphabetical districts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-broad-districts-'));
  const storage = openStorage(join(directory, 'test.db'));
  const adapter = new FixtureAdapter([[/obiavi\/prodazhbi/, new URL('./fixtures/search-broad-districts.html', import.meta.url)]]);
  try {
    await withClient(createServer({ adapter, storage }), async client => {
      const result = await client.callTool({ name: 'search_listings', arguments: { criteria: { districts: ['7-mi-11-ti-kilometar', 'zaharna-fabrika'], propertyTypes: ['tristaen'], maxPages: 1 }, limit: 10 } });
      assert.deepEqual(result.structuredContent.listings.map(item => item.location.district).sort(), ['7-ми 11-ти километър', 'Захарна фабрика']);
      assert.deepEqual(result.structuredContent.coverage.districts.sort(), ['7-mi-11-ti-kilometar', 'zaharna-fabrika']);
      assert.equal(result.structuredContent.verification.ok, true);
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
    assert.match(result.content[0].text, /[A-Z][A-Za-z 0-9]+ \([А-Яа-я 0-9]+\)/);
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
      name: 'imoti', version: VERSION, stage: '5', dataDir: '/tmp/imoti-test-data',
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
