import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { FixtureSofiaDataAdapter, LocalSofiaDataAdapter, parseGtfsStops } from '../dist/adapter/sofia-data.js';
import { createLocalServer } from '../dist/local-server.js';

const stopsText = 'stop_id,stop_name,stop_lat,stop_lon\nfake-1,"Imaginary, Square",42.7,23.3\nfake-2,Made-up Station,42.71,23.31';

test('GTFS parser validates columns, identifiers and finite coordinates', () => {
  assert.deepEqual(parseGtfsStops(stopsText), [
    { id: 'fake-1', name: 'Imaginary, Square', latitude: 42.7, longitude: 23.3 },
    { id: 'fake-2', name: 'Made-up Station', latitude: 42.71, longitude: 23.31 }
  ]);
  assert.throws(() => parseGtfsStops('stop_id,stop_name,stop_lat,stop_lon\nx,Bad,NaN,23'), /invalid/i);
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
