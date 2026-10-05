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

test('data source documentation separates verified facts from unknown dataset dates and reuse terms', async () => {
  const doc = await readFile(new URL('../docs/data-sources.md', import.meta.url), 'utf8');
  assert.match(doc, /GTFS/i);
  assert.match(doc, /OpenStreetMap/i);
  assert.match(doc, /OSRM/i);
  assert.match(doc, /2026-10-05/);
  assert.match(doc, /No GTFS-specific licence verified/);
  assert.match(doc, /Sourced facts versus inference/);
  assert.match(doc, /never downloads/);
});

test('fixture Sofia adapter returns defensive copies of supplied fixture records', async () => {
  const adapter = new FixtureSofiaDataAdapter({ stops: [{ id: 's', name: 'Made-up', latitude: 42, longitude: 23, provenance: { name: 'X', sourceUrl: 'https://x.test', datasetDate: 'unknown', checkedAt: '2026-02-03', reuseTerms: 'unknown' } }] });
  const stops = await adapter.getStops();
  stops[0].name = 'Changed';
  assert.equal((await adapter.getStops())[0].name, 'Made-up');
});
