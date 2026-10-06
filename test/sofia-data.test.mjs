import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { FixtureSofiaDataAdapter, LocalSofiaDataAdapter, parseGtfsStops, readZipEntries } from '../dist/adapter/sofia-data.js';
import { createLocalServer } from '../dist/local-server.js';

const stopsText = 'stop_id,stop_name,stop_lat,stop_lon\nfake-1,"Imaginary, Square",42.7,23.3\nfake-2,Made-up Station,42.71,23.31';

function descriptorZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name), data = deflateRawSync(Buffer.from(text));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data, Buffer.alloc(16));
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(Buffer.byteLength(text), 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes); offset += 30 + nameBytes.length + data.length + 16;
  }
  const centralBytes = Buffer.concat(centrals), localBytes = Buffer.concat(locals);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(centralBytes.length, 12); eocd.writeUInt32LE(localBytes.length, 16);
  return Buffer.concat([localBytes, centralBytes, eocd]);
}

test('shared ZIP reader uses central directory sizes for bit-3 entries', () => {
  const archive = descriptorZip([['invented.csv', 'synthetic,content']]);
  assert.equal(new TextDecoder().decode(readZipEntries(archive).get('invented.csv')), 'synthetic,content');
});

test('address and GTFS loaders read synthetic bit-3 ZIP entries', async () => {
  const addressZip = descriptorZip([['addresses.csv', 'rn;region;settlement;street;n;e\n1;A;гр. София;ул. Измислена;42.5;23.5']]);
  const gtfsZip = descriptorZip([['stops.txt', 'stop_id,stop_name,stop_lat,stop_lon\nstop-x,Imaginary,42.5,23.5']]);
  const cache = { read: async () => undefined, write: async () => {} };
  const adapter = new LocalSofiaDataAdapter({ cache, fetchStops: async () => gtfsZip, fetchMunicipalData: async () => ({ addressesZip: addressZip, districtsText: JSON.stringify({ features: [] }) }) });
  assert.equal((await adapter.getStops())[0].id, 'stop-x');
  assert.equal((await adapter.getMunicipalLocations()).addresses[0].street, 'ул. Измислена');
});

test('GTFS parser validates columns, identifiers and finite coordinates', () => {
  assert.deepEqual(parseGtfsStops(stopsText), [
    { id: 'fake-1', name: 'Imaginary, Square', latitude: 42.7, longitude: 23.3 },
    { id: 'fake-2', name: 'Made-up Station', latitude: 42.71, longitude: 23.31 }
  ]);
  assert.throws(() => parseGtfsStops('stop_id,stop_name,stop_lat,stop_lon\nx,Bad,NaN,23'), /invalid/i);
});

test('GTFS parser ignores unnamed non-boarding stops and retains only named boarding stops', () => {
  const text = 'stop_id,stop_name,stop_lat,stop_lon,location_type\nplatform,,42,23,3\nnode,,42,23,4\nboarding,Imaginary Stop,42.1,23.1,0\nlegacy,Named Default,42.2,23.2,';
  assert.deepEqual(parseGtfsStops(text), [
    { id: 'boarding', name: 'Imaginary Stop', latitude: 42.1, longitude: 23.1 },
    { id: 'legacy', name: 'Named Default', latitude: 42.2, longitude: 23.2 }
  ]);
  assert.throws(() => parseGtfsStops('stop_id,stop_name,stop_lat,stop_lon,location_type\nx,,42,23,3'), /no usable named boarding stops/i);
});

test('GTFS archive rejects data with no usable named boarding stops', async () => {
  const archive = descriptorZip([['stops.txt', 'stop_id,stop_name,stop_lat,stop_lon,location_type\nplatform,,42,23,3\nnode,,42,23,4']]);
  const adapter = new LocalSofiaDataAdapter({ cache: { read: async () => undefined, write: async () => {} }, fetchStops: async () => archive });
  await assert.rejects(adapter.getStops(), /no usable named boarding stops/i);
});

test('local adapter fetches once, caches stops and attaches source provenance', async () => {
  let cached;
  let fetches = 0;
  const cache = { read: async () => cached, write: async (_key, value) => { cached = value; } };
  const options = { cache, fetchStops: async () => { fetches++; return { stopsText, feedInfoText: 'feed_start_date\n20261005' }; }, now: () => new Date('2026-10-06T12:00:00.000Z') };
  const first = new LocalSofiaDataAdapter(options);
  const result = await first.getStops();
  const second = await new LocalSofiaDataAdapter(options).getStops();
  assert.equal(fetches, 1);
  assert.deepEqual(second, result);
  assert.equal(result[0].provenance.sourceUrl, 'https://gtfs.sofiatraffic.bg/api/v1/static');
  assert.equal(result[0].provenance.datasetDate, '2026-10-05');
  assert.equal(result[0].provenance.checkedAt, '2026-10-06T12:00:00.000Z');
  assert.match(result[0].provenance.reuseTerms, /conflict/i);
});

test('local adapter derives dataset date from synthetic GTFS feed_info and marks absent dates unknown', async () => {
  const cache = { read: async () => undefined, write: async () => {} };
  const withFeedInfo = new LocalSofiaDataAdapter({ cache, fetchStops: async () => ({
    stopsText,
    feedInfoText: 'feed_publisher_name,feed_start_date\nSynthetic Publisher,20270412'
  }) });
  const withoutFeedInfo = new LocalSofiaDataAdapter({ cache, fetchStops: async () => stopsText });

  assert.equal((await withFeedInfo.getStops())[0].provenance.datasetDate, '2027-04-12');
  assert.equal((await withoutFeedInfo.getStops())[0].provenance.datasetDate, 'unknown');
});

test('invalid cached GTFS is refreshed and a failed refresh preserves valid provenance data', async () => {
  let cached = 'bad';
  let fetches = 0;
  const cache = { read: async () => cached, write: async (_key, value) => { cached = value; } };
  const adapter = new LocalSofiaDataAdapter({ cache, fetchStops: async () => { fetches++; return stopsText; } });
  assert.equal((await adapter.getStops()).length, 2);
  assert.equal(fetches, 1);
  cached = 'bad-again';
  const broken = new LocalSofiaDataAdapter({ cache, fetchStops: async () => 'stop_id,stop_name,stop_lat,stop_lon\nx,Bad,nope,23' });
  await assert.rejects(broken.getStops(), /invalid/i);
  assert.equal(cached, 'bad-again');
});

test('cache max age defaults to seven days and expired stop data refreshes with stale fallback', async () => {
  let cached = JSON.stringify([{ id: 'old', name: 'Old Stop', latitude: 42, longitude: 23, provenance: { name: 'old', sourceUrl: 'https://fixture.test', datasetDate: 'unknown', checkedAt: '2026-10-01T00:00:00.000Z', reuseTerms: 'synthetic' } }]);
  let fetches = 0;
  const cache = { read: async () => cached, write: async (_key, value) => { cached = value; } };
  const adapter = new LocalSofiaDataAdapter({ cache, now: () => new Date('2026-10-10T00:00:00.000Z'), fetchStops: async () => { fetches++; throw new Error('offline'); } });
  assert.equal(LocalSofiaDataAdapter.DEFAULT_CACHE_MAX_AGE_MS, 7 * 24 * 60 * 60 * 1000);
  const result = await adapter.getStops();
  assert.equal(fetches, 1);
  assert.equal(result[0].id, 'old');
  assert.equal(result[0].provenance.checkedAt, '2026-10-01T00:00:00.000Z');
  assert.deepEqual(result[0].provenance.stale, { reason: 'over-age', refreshError: 'offline' });
});

test('GTFS feed end date makes cache stale even within cache age', async () => {
  let cached = JSON.stringify([{ id: 'old', name: 'Old Stop', latitude: 42, longitude: 23, provenance: { name: 'old', sourceUrl: 'https://fixture.test', datasetDate: 'unknown', feedEndDate: '2026-10-09', checkedAt: '2026-10-09T00:00:00.000Z', reuseTerms: 'synthetic' } }]);
  let fetches = 0;
  const adapter = new LocalSofiaDataAdapter({ cache: { read: async () => cached, write: async (_key, value) => { cached = value; } }, now: () => new Date('2026-10-10T00:00:00.000Z'), fetchStops: async () => { fetches++; return { stopsText, feedInfoText: 'feed_end_date\n20261009' }; } });
  const result = await adapter.getStops();
  assert.equal(fetches, 1);
  assert.equal(result[0].provenance.checkedAt, '2026-10-10T00:00:00.000Z');
  assert.equal(result[0].provenance.stale, undefined);
});

test('expired GTFS feed falls back with stale feed-end provenance and refresh error', async () => {
  const cached = JSON.stringify([{ id: 'old', name: 'Old Stop', latitude: 42, longitude: 23, provenance: { name: 'Synthetic GTFS', sourceUrl: 'https://fixture.test', datasetDate: 'unknown', feedEndDate: '2026-10-09', checkedAt: '2026-10-09T00:00:00.000Z', reuseTerms: 'synthetic' } }]);
  const adapter = new LocalSofiaDataAdapter({ cache: { read: async () => cached, write: async () => {} }, now: () => new Date('2026-10-10T00:00:00.000Z'), fetchStops: async () => { throw new Error('offline GTFS'); } });
  const [stop] = await adapter.getStops();
  assert.deepEqual(stop.provenance.stale, { reason: 'feed-end-date', refreshError: 'offline GTFS' });
  assert.equal(stop.provenance.checkedAt, '2026-10-09T00:00:00.000Z');
});

test('GTFS cache age still makes a feed stale when its feed end date is in the future', async () => {
  let cached = JSON.stringify([{ id: 'old', name: 'Old Stop', latitude: 42, longitude: 23, provenance: { name: 'old', sourceUrl: 'https://fixture.test', datasetDate: 'unknown', feedEndDate: '2027-10-09', checkedAt: '2026-10-01T00:00:00.000Z', reuseTerms: 'synthetic' } }]);
  let fetches = 0;
  const adapter = new LocalSofiaDataAdapter({ cache: { read: async () => cached, write: async (_key, value) => { cached = value; } }, now: () => new Date('2026-10-10T00:00:00.000Z'), fetchStops: async () => { fetches++; return { stopsText, feedInfoText: 'feed_end_date\n20271009' }; } });

  const result = await adapter.getStops();

  assert.equal(fetches, 1);
  assert.equal(result[0].provenance.checkedAt, '2026-10-10T00:00:00.000Z');
});

test('malformed GTFS feed end date falls back to cache age', async () => {
  let cached = JSON.stringify([{ id: 'old', name: 'Old Stop', latitude: 42, longitude: 23, provenance: { name: 'old', sourceUrl: 'https://fixture.test', datasetDate: 'unknown', feedEndDate: '2026-99-99', checkedAt: '2026-10-01T00:00:00.000Z', reuseTerms: 'synthetic' } }]);
  let fetches = 0;
  const adapter = new LocalSofiaDataAdapter({ cache: { read: async () => cached, write: async (_key, value) => { cached = value; } }, now: () => new Date('2026-10-10T00:00:00.000Z'), fetchStops: async () => { fetches++; return { stopsText, feedInfoText: 'feed_end_date\nnot-a-date' }; } });

  const result = await adapter.getStops();

  assert.equal(fetches, 1);
  assert.equal(result[0].provenance.checkedAt, '2026-10-10T00:00:00.000Z');
});

test('municipal cache refresh failure returns valid prior datasets unchanged', async () => {
  const provenance = { name: 'old', sourceUrl: 'https://fixture.test', datasetDate: 'unknown', checkedAt: '2026-10-01T00:00:00.000Z', reuseTerms: 'synthetic' };
  const addresses = [{ settlement: 'Sofia', street: 'Fictional Road', region: 'A', latitude: 42, longitude: 23, provenance }];
  const districts = [{ name: 'Imaginary District', latitude: 42, longitude: 23, geometry: { type: 'MultiPolygon', coordinates: [] }, provenance }];
  const cacheValues = new Map([['sofia-addresses.json', JSON.stringify(addresses)], ['sofia-districts.json', JSON.stringify(districts)]]);
  const adapter = new LocalSofiaDataAdapter({ cache: { read: async key => cacheValues.get(key), write: async () => {} }, now: () => new Date('2026-10-10T00:00:00.000Z'), fetchMunicipalData: async () => { throw new Error('offline'); } });
  const result = await adapter.getMunicipalLocations();
  assert.deepEqual(result.addresses[0].provenance.stale, { reason: 'over-age', refreshError: 'offline' });
  assert.equal(result.addresses[0].provenance.checkedAt, provenance.checkedAt);
  assert.deepEqual(result.districts[0].provenance.stale, { reason: 'over-age', refreshError: 'offline' });
});

test('over-age complete municipal cache refreshes and persists both updated datasets', async () => {
  const oldProvenance = { name: 'old', sourceUrl: 'https://fixture.test', datasetDate: 'unknown', checkedAt: '2026-10-01T00:00:00.000Z', reuseTerms: 'synthetic' };
  const oldAddresses = [{ settlement: 'Sofia', street: 'Old Fictional Road', region: 'A', latitude: 42, longitude: 23, provenance: oldProvenance }];
  const oldDistricts = [{ name: 'Old Imaginary District', latitude: 42, longitude: 23, geometry: { type: 'MultiPolygon', coordinates: [] }, provenance: oldProvenance }];
  const cacheValues = new Map([['sofia-addresses.json', JSON.stringify(oldAddresses)], ['sofia-districts.json', JSON.stringify(oldDistricts)]]);
  const writes = [];
  let fetches = 0;
  const adapter = new LocalSofiaDataAdapter({
    cache: { read: async key => cacheValues.get(key), write: async (key, value) => { writes.push(key); cacheValues.set(key, value); } },
    now: () => new Date('2026-10-10T00:00:00.000Z'),
    fetchMunicipalData: async () => { fetches++; return { addressesZip: new ArrayBuffer(0), districtsText: JSON.stringify({ features: [{ properties: { kvname: 'КВ. НОВ' }, geometry: { type: 'MultiPolygon', coordinates: [[[[23, 42], [24, 42], [24, 43], [23, 42]]]] } }] }) }; },
    unzipAddresses: async () => 'rn;region;settlement;lareaunit;block;street;streetnum;entrance;n;e\n1;A;гр. София;;;ул. Нова;;;42.5;23.5'
  });

  const result = await adapter.getMunicipalLocations();

  assert.equal(fetches, 1);
  assert.deepEqual(writes.sort(), ['sofia-addresses.json', 'sofia-districts.json']);
  assert.equal(result.addresses[0].street, 'ул. Нова');
  assert.equal(result.districts[0].name, 'КВ. НОВ');
  assert.deepEqual(JSON.parse(cacheValues.get('sofia-addresses.json')), result.addresses);
  assert.deepEqual(JSON.parse(cacheValues.get('sofia-districts.json')), result.districts);
});

test('municipal cache write failure returns complete prior datasets marked stale', async () => {
  const provenance = { name: 'old', sourceUrl: 'https://fixture.test', datasetDate: 'unknown', checkedAt: '2026-10-01T00:00:00.000Z', reuseTerms: 'synthetic' };
  const addresses = [{ settlement: 'Sofia', street: 'Fictional Road', region: 'A', latitude: 42, longitude: 23, provenance }];
  const districts = [{ name: 'Imaginary District', latitude: 42, longitude: 23, geometry: { type: 'MultiPolygon', coordinates: [] }, provenance }];
  const adapter = new LocalSofiaDataAdapter({
    cache: { read: async key => JSON.stringify(key.includes('addresses') ? addresses : districts), write: async () => { throw new Error('disk full'); } },
    now: () => new Date('2026-10-10T00:00:00.000Z'),
    fetchMunicipalData: async () => ({ addressesZip: new ArrayBuffer(0), districtsText: JSON.stringify({ features: [{ properties: { kvname: 'КВ. НОВ' }, geometry: { type: 'MultiPolygon', coordinates: [[[[23, 42], [24, 42], [24, 43], [23, 42]]]] } }] }) }),
    unzipAddresses: async () => 'rn;region;settlement;lareaunit;block;street;streetnum;entrance;n;e\n1;A;гр. София;;;ул. Нова;;;42.5;23.5'
  });

  const result = await adapter.getMunicipalLocations();
  assert.equal(result.addresses[0].provenance.stale.refreshError, 'disk full');
  assert.equal(result.districts[0].provenance.stale.refreshError, 'disk full');
});

test('local adapter loads and caches both municipal location datasets with their distinct reuse terms', async () => {
  const cacheValues = new Map();
  const writes = [];
  const cache = {
    read: async key => cacheValues.get(key),
    write: async (key, value) => { writes.push(key); cacheValues.set(key, value); }
  };
  const adapter = new LocalSofiaDataAdapter({
    cache,
    now: () => new Date('2026-10-06T12:00:00.000Z'),
    fetchMunicipalData: async () => ({
      addressesZip: new ArrayBuffer(0),
      districtsText: JSON.stringify({ type: 'FeatureCollection', features: [
        { type: 'Feature', properties: { kvname: 'КВ. ПРИМЕР' }, geometry: { type: 'MultiPolygon', coordinates: [[[[23, 42], [24, 42], [24, 43], [23, 42]]]] } }
      ] })
    }),
    unzipAddresses: async () => 'rn;region;settlement;lareaunit;block;street;streetnum;entrance;n;e\n1;A;гр. София;;;ул. Примерна;;;42.5;23.5'
  });
  const first = await adapter.getMunicipalLocations();
  const second = await new LocalSofiaDataAdapter({ cache, fetchMunicipalData: async () => { throw new Error('must use cache'); } }).getMunicipalLocations();
  assert.deepEqual(second, first);
  assert.deepEqual(writes.sort(), ['sofia-addresses.json', 'sofia-districts.json']);
  assert.equal(first.addresses[0].latitude, 42.5);
  assert.equal(first.addresses[0].longitude, 23.5);
  assert.ok(Math.abs(first.districts[0].latitude - 42.3333333333) < 0.000001);
  assert.ok(Math.abs(first.districts[0].longitude - 23.6666666667) < 0.000001);
  assert.deepEqual(first.districts[0].geometry, { type: 'MultiPolygon', coordinates: [[[[23, 42], [24, 42], [24, 43], [23, 42]]]] });
  assert.equal(first.addresses[0].provenance.reuseTerms, 'CC-BY');
  assert.match(first.districts[0].provenance.reuseTerms, /Не са зададени лицензни права/);
});

test('local server construction passes the real local adapter to createServer', () => {
  let dependencies;
  const expectedServer = {};
  const result = createLocalServer({
    serverFactory: (deps) => { dependencies = deps; return expectedServer; },
    adapter: {},
    storage: {}
  });

  assert.equal(result, expectedServer);
  assert.ok(dependencies.sofiaData instanceof LocalSofiaDataAdapter);
  assert.equal(typeof FixtureSofiaDataAdapter, 'function');
});

test('fixture Sofia adapter returns normalized records with source provenance', async () => {
  const provenance = { name: 'Invented transit data', sourceUrl: 'https://fixture.test/transit', datasetDate: '2026-01-02', checkedAt: '2026-02-03', reuseTerms: 'Synthetic test data; unrestricted' };
  const adapter = new FixtureSofiaDataAdapter({
    stops: [{ id: 'stop-1', name: 'Imaginary Square', latitude: 42.7, longitude: 23.3, provenance }],
    schedules: [{ routeId: 'route-1', stopId: 'stop-1', departureTime: '08:15', provenance }],
    features: [{ id: 'park-1', name: 'Fictional Park', category: 'park', latitude: 42.71, longitude: 23.31, provenance }],
    walkingRoutes: [{ origin: 'stop-1', destination: 'park-1', distanceMeters: 250, durationSeconds: 180, provenance }]
  });
  assert.deepEqual(await adapter.getStops(), [{ id: 'stop-1', name: 'Imaginary Square', latitude: 42.7, longitude: 23.3, provenance }]);
  assert.equal((await adapter.getSchedules())[0].departureTime, '08:15');
  assert.equal((await adapter.getMunicipalFeatures())[0].category, 'park');
  const [route] = await adapter.getWalkingRoutes();
  assert.equal(route.distanceMeters, 250);
  assert.equal(route.provenance.sourceUrl, 'https://fixture.test/transit');
});

test('fixture adapter normalizes GTFS-shaped stop fields and numeric coordinates', async () => {
  const provenance = { name: 'Invented GTFS fixture', sourceUrl: 'https://fixture.test/gtfs', datasetDate: 'synthetic', checkedAt: '2026-10-05', reuseTerms: 'Synthetic test data' };
  const adapter = new FixtureSofiaDataAdapter({
    stops: [{ stop_id: 'fake-stop-9', stop_name: 'Imaginary Library', stop_lat: '42.701', stop_lon: '23.321', provenance }]
  });

  assert.deepEqual(await adapter.getStops(), [{
    id: 'fake-stop-9', name: 'Imaginary Library', latitude: 42.701, longitude: 23.321, provenance
  }]);
});

test('fixture adapter derives transit mode from GTFS route_type provenance', async () => {
  const provenance = { name: 'Synthetic GTFS', sourceUrl: 'https://fixture.test/gtfs', datasetDate: 'synthetic', checkedAt: '2026-01-01', reuseTerms: 'Synthetic' };
  const adapter = new FixtureSofiaDataAdapter({ stops: [{ stop_id: 'metro-stop', stop_name: 'Imaginary Metro', stop_lat: '42.7', stop_lon: '23.3', route_type: '1', provenance }] });
  const [stop] = await adapter.getStops();
  assert.equal(stop.mode, 'metro');
  assert.deepEqual(stop.routeTypes, [1]);
});

test('source documentation cites the official GTFS feed, validity dates and conflicting reuse evidence', async () => {
  const doc = await readFile(new URL('../docs/data-sources.md', import.meta.url), 'utf8');
  assert.ok(doc.includes('https://gtfs.sofiatraffic.bg/api/v1/static'));
  assert.ok(doc.includes('https://urbandata.sofia.bg/dataset/gtfs-static'));
  assert.ok(doc.includes('https://www.sofia.bg/transport-data'));
  assert.match(doc, /feed_start_date.*20261005/);
  assert.match(doc, /feed_end_date.*20271005/);
  assert.match(doc, /CC BY 4\.0/);
  assert.match(doc, /CC BY-SA/);
  assert.match(doc, /conflict/i);
  assert.match(doc, /not a publication date/i);
});

test('source documentation cites a dated municipal geographic dataset and its checked licence', async () => {
  const doc = await readFile(new URL('../docs/data-sources.md', import.meta.url), 'utf8');
  assert.ok(doc.includes('https://urbandata.sofia.bg/dataset/regions_sofia-zip'));
  assert.match(doc, /2026-08-28/);
  assert.match(doc, /Creative Commons Attribution.*version.*not specified/i);
});

test('source documentation distinguishes pedestrian data dates, software and service permissions', async () => {
  const doc = await readFile(new URL('../docs/data-sources.md', import.meta.url), 'utf8');
  assert.ok(doc.includes('https://download.geofabrik.de/europe/bulgaria.html'));
  assert.match(doc, /2026-10-03T20:20:50Z/);
  assert.match(doc, /OpenStreetMap/i);
  assert.match(doc, /OSRM/i);
  assert.match(doc, /ODbL 1\.0/);
  assert.match(doc, /2-clause BSD/);
  assert.match(doc, /no hosted service permission/i);
  assert.match(doc, /Sourced facts versus inference/);
  assert.match(doc, /never downloads/);
});

test('fixture Sofia adapter returns defensive copies of supplied fixture records', async () => {
  const adapter = new FixtureSofiaDataAdapter({ stops: [{ id: 's', name: 'Made-up', latitude: 42, longitude: 23, provenance: { name: 'X', sourceUrl: 'https://x.test', datasetDate: 'unknown', checkedAt: '2026-02-03', reuseTerms: 'unknown' } }] });
  const stops = await adapter.getStops();
  stops[0].name = 'Changed';
  assert.equal((await adapter.getStops())[0].name, 'Made-up');
});
