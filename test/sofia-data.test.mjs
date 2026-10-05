import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { FixtureSofiaDataAdapter } from '../dist/adapter/sofia-data.js';

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
