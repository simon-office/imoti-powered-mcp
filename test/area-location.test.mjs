import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveListingLocation } from '../dist/area/location.js';
import { resolveMunicipalLocation } from '../dist/area/location.js';
import { Client, InMemoryTransport as ClientTransport } from '@modelcontextprotocol/client';
import { InMemoryTransport as ServerTransport } from '@modelcontextprotocol/server';
import { createServer } from '../dist/server.js';
import { FixtureSofiaDataAdapter } from '../dist/adapter/sofia-data.js';
import { openStorage } from '../dist/storage/index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('resolves property street and district locations without using seller office location', () => {
  const result = resolveListingLocation({
    id: 'fake-property-1',
    location: { city: 'Sofia', district: 'Iztok', street: 'ул. Примерна 7' },
    seller: { location: 'ул. Агенцийна 99' },
  });
  assert.equal(result.precision, 'street');
  assert.equal(result.street, 'ул. Примерна 7');
  assert.equal(result.source, 'listing');
  assert.equal(result.uncertainty.length > 0, true);
  assert.notEqual(result.street, 'ул. Агенцийна 99');
  assert.equal(result.coordinates, undefined);
});

test('maps district-only to neighbourhood and missing/ambiguous locations to unknown', () => {
  assert.equal(resolveListingLocation({ id: 'district', location: { city: 'Sofia', district: 'Lozenets' } }).precision, 'neighbourhood');
  assert.equal(resolveListingLocation({ id: 'missing' }).precision, 'unknown');
  assert.equal(resolveListingLocation({ id: 'ambiguous', location: { city: 'Sofia', street: 'Main street' } }).precision, 'unknown');
});

test('classifies a property-specific street without a district as street precision', () => {
  const result = resolveListingLocation({ id: 'street-only', location: { city: 'Sofia', street: 'ул. Измислена 12' } });
  assert.equal(result.precision, 'street');
  assert.equal(result.street, 'ул. Измислена 12');
});

test('resolves streets and neighbourhoods from synthetic municipal datasets with provenance and uncertainty', () => {
  const addressProvenance = { name: 'Адреси на територията на Столична община', sourceUrl: 'https://fixture.test/addresses', datasetDate: '2026-09-15', checkedAt: '2026-10-05', reuseTerms: 'CC-BY' };
  const districtProvenance = { name: 'Квартали на Столична община', sourceUrl: 'https://fixture.test/districts', datasetDate: 'unknown', checkedAt: '2026-10-05', reuseTerms: 'Не са зададени лицензни права' };
  const datasets = {
    addresses: [
      { settlement: 'гр. София', street: 'ул. Измислена', region: 'А', latitude: 42.7, longitude: 23.3, provenance: addressProvenance },
      { settlement: 'гр. София', street: 'ул. Измислена', region: 'Б', latitude: 42.71, longitude: 23.31, provenance: addressProvenance },
    ],
    districts: [
      { name: 'КВ. ПРИМЕР', latitude: 42.72, longitude: 23.32, provenance: districtProvenance },
      { name: 'В.З. ПРИМЕР', latitude: 42.9, longitude: 23.5, provenance: districtProvenance },
    ],
  };
  const street = resolveMunicipalLocation({ id: 'street', location: { city: 'Sofia', street: 'ул. Измислена' } }, datasets);
  assert.equal(street.precision, 'street');
  assert.equal(street.coordinates.latitude, 42.705);
  assert.match(street.uncertainty.join(' '), /administrative district|region/i);
  assert.equal(street.source, addressProvenance.name);
  const district = resolveMunicipalLocation({ id: 'district', location: { city: 'Sofia', district: 'Пример' } }, datasets);
  assert.equal(district.precision, 'neighbourhood');
  assert.equal(district.coordinates.latitude, 42.72);
  assert.equal(district.source, districtProvenance.name);
  const unresolved = resolveMunicipalLocation({ id: 'ambiguous', location: { city: 'Sofia', street: 'ул. Непозната' }, seller: { location: 'ул. Измислена' } }, datasets);
  assert.equal(unresolved.coordinates, undefined);
  assert.equal(unresolved.precision, 'street');
  assert.equal(unresolved.source, 'unresolved');
  assert.ok(unresolved.uncertainty.some(item => /Street-level location/.test(item)));
  assert.ok(unresolved.uncertainty.some(item => /municipal address or neighbourhood datasets/.test(item)));
});

test('does not resolve duplicate eligible neighbourhood matches', () => {
  const provenance = { name: 'Synthetic districts', sourceUrl: 'https://fixture.test/districts', datasetDate: 'synthetic', checkedAt: '2026-01-02', reuseTerms: 'Synthetic fixture' };
  const result = resolveMunicipalLocation({ id: 'duplicate-district', location: { city: 'Sofia', district: 'Пример' } }, {
    addresses: [],
    districts: [
      { name: 'КВ. ПРИМЕР', latitude: 42.7, longitude: 23.3, provenance },
      { name: 'ЖК. ПРИМЕР', latitude: 42.71, longitude: 23.31, provenance },
    ],
  });
  assert.equal(result.coordinates, undefined);
  assert.equal(result.precision, 'neighbourhood');
  assert.equal(result.source, 'unresolved');
});

test('averages only same-street address points inside the listing district polygon', () => {
  const provenance = { name: 'Synthetic', sourceUrl: 'https://fixture.test', datasetDate: 'synthetic', checkedAt: '2026-01-02', reuseTerms: 'Synthetic' };
  const result = resolveMunicipalLocation({ id: 'long-street', location: { city: 'Sofia', district: 'Пример', street: 'ул. Дълга' } }, {
    addresses: [
      { settlement: 'гр. София', street: 'ул. Дълга', region: 'A', latitude: 42.1, longitude: 23.1, provenance },
      { settlement: 'гр. София', street: 'ул. Дълга', region: 'A', latitude: 42.2, longitude: 23.2, provenance },
      { settlement: 'гр. София', street: 'ул. Дълга', region: 'B', latitude: 43, longitude: 24, provenance },
      { settlement: 'гр. София', street: 'ул. Друга', region: 'A', latitude: 42.2, longitude: 23.2, provenance },
    ],
    districts: [{ name: 'КВ. ПРИМЕР', latitude: 42.15, longitude: 23.15, geometry: { type: 'MultiPolygon', coordinates: [[[[23, 42], [23.5, 42], [23.5, 42.5], [23, 42.5], [23, 42]]]] }, provenance }],
  });
  assert.deepEqual(result.coordinates, { latitude: (42.1 + 42.2) / 2, longitude: (23.1 + 23.2) / 2 });
  assert.match(result.uncertainty.join(' '), /Farthest selected point is 6922 m from the resolved point\./);
  assert.doesNotMatch(result.uncertainty.join(' '), /multiple administrative/i);
});

test('falls back to known district centroid when no matching street point is inside it', () => {
  const provenance = { name: 'Synthetic', sourceUrl: 'https://fixture.test', datasetDate: 'synthetic', checkedAt: '2026-01-02', reuseTerms: 'Synthetic' };
  const result = resolveMunicipalLocation({ id: 'outside-street', location: { city: 'Sofia', district: 'Пример', street: 'ул. Дълга' } }, {
    addresses: [{ settlement: 'гр. София', street: 'ул. Дълга', region: 'B', latitude: 43, longitude: 24, provenance }],
    districts: [{ name: 'КВ. ПРИМЕР', latitude: 42.15, longitude: 23.15, geometry: { type: 'MultiPolygon', coordinates: [[[[23, 42], [23.5, 42], [23.5, 42.5], [23, 42.5], [23, 42]]]] }, provenance }],
  });
  assert.deepEqual(result.coordinates, { latitude: 42.15, longitude: 23.15 });
  assert.equal(result.precision, 'neighbourhood');
  assert.match(result.uncertainty.join(' '), /no street point.*used/i);
});

test('area_context uses straight-line stop distances when routes are absent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-area-straight-'));
  const storage = openStorage(join(directory, 'test.db'));
  storage.upsertListing({ id: 'straight-property', location: { city: 'Sofia', district: 'Iztok', coordinates: { latitude: 42.7, longitude: 23.3 }, precision: 'exact', propertySpecificEvidence: true } });
  const provenance = { name: 'Synthetic GTFS', sourceUrl: 'https://fixture.test/gtfs', datasetDate: 'synthetic-2026-01-01', checkedAt: '2026-01-02', reuseTerms: 'Synthetic fixture' };
  const adapter = new FixtureSofiaDataAdapter({ stops: [
    { id: 'far', name: 'Imaginary Far', latitude: 42.705, longitude: 23.3, provenance },
    { id: 'near', name: 'Imaginary Near', latitude: 42.701, longitude: 23.3, provenance },
  ] });
  const server = createServer({ storage, sofiaData: adapter });
  const client = new Client({ name: 'area-straight-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = ClientTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const result = await client.callTool({ name: 'area_context', arguments: { listingId: 'straight-property', radiusMeters: 1000 } });
    const stops = result.structuredContent.nearbyStops;
    assert.equal(stops.distanceType, 'straight-line');
    assert.equal(stops.nearestStraightLineDistanceMeters, stops.nearestDistanceMeters);
    assert.match(result.content[0].text, new RegExp(`nearest straight-line distance ${Math.round(stops.nearestStraightLineDistanceMeters)} m`));
    assert.deepEqual(stops.items.map(item => item.id), ['near', 'far']);
    assert.ok(stops.items.every(item => typeof item.distanceMeters === 'number'));
    assert.equal(result.structuredContent.sourceMetadata.stops[0].sourceUrl, provenance.sourceUrl);
  } finally { await client.close(); await server.close(); storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('area_context resolves a stored street from adapter municipal data before measuring nearby stops', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-area-municipal-'));
  const storage = openStorage(join(directory, 'test.db'));
  storage.upsertListing({ id: 'municipal-property', location: { city: 'Sofia', street: 'ул. Измислена', precision: 'street' }, seller: { location: 'ул. Агенцийна 99' } });
  const provenance = { name: 'Synthetic address data', sourceUrl: 'https://fixture.test/addresses', datasetDate: 'synthetic', checkedAt: '2026-01-02', reuseTerms: 'Synthetic fixture' };
  const stopProvenance = { name: 'Synthetic GTFS', sourceUrl: 'https://fixture.test/gtfs', datasetDate: 'synthetic', checkedAt: '2026-01-02', reuseTerms: 'Synthetic fixture' };
  const adapter = new FixtureSofiaDataAdapter({
    locations: { addresses: [{ settlement: 'гр. София', street: 'ул. Измислена', region: 'A', latitude: 42.7, longitude: 23.3, provenance }], districts: [] },
    stops: [{ id: 'municipal-stop', name: 'Imaginary Stop', latitude: 42.701, longitude: 23.3, provenance: stopProvenance }]
  });
  const server = createServer({ storage, sofiaData: adapter });
  const client = new Client({ name: 'area-municipal-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = ClientTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const result = await client.callTool({ name: 'area_context', arguments: { listingId: 'municipal-property', radiusMeters: 1000 } });
    assert.deepEqual(result.structuredContent.location.coordinates, { latitude: 42.7, longitude: 23.3 });
    assert.equal(result.structuredContent.location.provenance.sourceUrl, provenance.sourceUrl);
    assert.equal(result.structuredContent.nearbyStops.items[0].distanceType, 'straight-line');
    assert.equal(result.structuredContent.sourceMetadata.stops[0].sourceUrl, stopProvenance.sourceUrl);
  } finally { await client.close(); await server.close(); storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('exact precision requires property-specific coordinate evidence', () => {
  const coordinates = { latitude: 42.7, longitude: 23.3 };
  assert.equal(resolveListingLocation({ id: 'unsupported', location: { city: 'Sofia', district: 'Iztok', coordinates } }).precision, 'neighbourhood');
  const exact = resolveListingLocation({ id: 'supported', location: { city: 'Sofia', district: 'Iztok', coordinates, propertySpecificEvidence: true, source: 'verified-property-geocode' } });
  assert.equal(exact.precision, 'exact');
  assert.deepEqual(exact.coordinates, coordinates);
  assert.equal(exact.source, 'verified-property-geocode');
});

test('area_context returns dated provenance and explicit unavailable distances for unknown locations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-area-'));
  const storage = openStorage(join(directory, 'test.db'));
  storage.upsertListing({ id: 'fixture-area', location: { city: 'Sofia', precision: 'unknown' } });
  const provenance = { name: 'Invented GTFS', sourceUrl: 'https://fixture.test/gtfs', datasetDate: 'synthetic-2026-01-01', checkedAt: '2026-01-02', reuseTerms: 'Synthetic fixture' };
  const adapter = new FixtureSofiaDataAdapter({ stops: [{ id: 'fake-stop', name: 'Imaginary Stop', latitude: 42.7, longitude: 23.3, provenance }] });
  const server = createServer({ storage, sofiaData: adapter });
  const client = new Client({ name: 'area-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = ClientTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const result = await client.callTool({ name: 'area_context', arguments: { listingId: 'fixture-area' } });
    assert.equal(result.isError, undefined, result.content?.[0]?.text);
    assert.equal(result.structuredContent.location.precision, 'unknown');
    assert.equal(result.structuredContent.nearbyStops.status, 'unavailable');
    assert.equal('nearestStraightLineDistanceMeters' in result.structuredContent.nearbyStops, false);
    assert.doesNotMatch(result.content[0].text, /nearest .*distance/);
    assert.match(result.structuredContent.nearbyStops.reason, /coordinates|location/i);
    assert.equal(result.structuredContent.sourceMetadata.stops[0].datasetDate, 'synthetic-2026-01-01');
  } finally { await client.close(); await server.close(); storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('area_context returns coordinate-backed routed stops, schedules, and features within the radius', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-area-routed-'));
  const storage = openStorage(join(directory, 'test.db'));
  const propertyCoordinates = { latitude: 42.7, longitude: 23.3 };
  storage.upsertListing({ id: 'routed-property', location: { city: 'Sofia', district: 'Iztok', coordinates: propertyCoordinates, precision: 'exact', propertySpecificEvidence: true, source: 'synthetic-property-geocode' } });
  const provenance = { name: 'Synthetic area dataset', sourceUrl: 'https://fixture.test/area', datasetDate: 'synthetic-2026-03-04', checkedAt: '2026-03-05', reuseTerms: 'Synthetic fixture' };
  const adapter = new FixtureSofiaDataAdapter({
    stops: [{ id: 'near-stop', name: 'Imaginary Metro', latitude: 42.701, longitude: 23.301, provenance }, { id: 'far-stop', name: 'Distant Imaginary Stop', latitude: 42.8, longitude: 23.4, provenance }],
    schedules: [{ routeId: 'route-x', stopId: 'near-stop', departureTime: '08:15', provenance }, { routeId: 'route-y', stopId: 'far-stop', departureTime: '09:00', provenance }],
    features: [{ id: 'near-park', name: 'Invented Garden', category: 'park', latitude: 42.702, longitude: 23.302, provenance }, { id: 'far-school', name: 'Imaginary School', category: 'school', latitude: 42.8, longitude: 23.4, provenance }],
    walkingRoutes: [
      { origin: 'routed-property', destination: 'near-stop', distanceMeters: 350, durationSeconds: 260, provenance },
      { origin: 'routed-property', destination: 'far-stop', distanceMeters: 1800, durationSeconds: 1300, provenance },
      { origin: 'routed-property', destination: 'near-park', distanceMeters: 420, durationSeconds: 310, provenance },
      { origin: 'routed-property', destination: 'far-school', distanceMeters: 2200, durationSeconds: 1600, provenance },
    ],
  });
  const server = createServer({ storage, sofiaData: adapter });
  const client = new Client({ name: 'area-routed-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = ClientTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const result = await client.callTool({ name: 'area_context', arguments: { listingId: 'routed-property', radiusMeters: 500 } });
    assert.equal(result.isError, undefined, result.content?.[0]?.text);
    const context = result.structuredContent;
    assert.equal(context.location.precision, 'exact');
    assert.deepEqual(context.nearbyStops.items.map(item => [item.id, item.distanceMeters]), [['near-stop', 350]]);
    assert.deepEqual(context.schedules.items.map(item => item.stopId), ['near-stop']);
    assert.deepEqual(context.municipalFeatures.items.map(item => [item.id, item.distanceMeters]), [['near-park', 420]]);
    assert.match(result.content[0].text, /pedestrian-route distance/);
    assert.ok(Math.abs(context.nearbyStops.nearestStraightLineDistanceMeters - 137.9933) < 0.001);
    assert.match(result.content[0].text, /nearest straight-line distance 138 m/);
    assert.equal(context.sourceMetadata.stops[0].datasetDate, 'synthetic-2026-03-04');
    assert.equal(context.sourceMetadata.routing[0].sourceUrl, 'https://fixture.test/area');
  } finally { await client.close(); await server.close(); storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('area_context measures nearest straight-line distance across routed stops before truncation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-area-routed-straight-'));
  const storage = openStorage(join(directory, 'test.db'));
  storage.upsertListing({ id: 'distance-property', location: { city: 'Sofia', coordinates: { latitude: 42.7, longitude: 23.3 }, precision: 'exact', propertySpecificEvidence: true } });
  const provenance = { name: 'Synthetic routes', sourceUrl: 'https://fixture.test/routes', datasetDate: 'synthetic', checkedAt: '2026-01-02', reuseTerms: 'Synthetic fixture' };
  const stops = Array.from({ length: 12 }, (_, i) => ({ id: `distance-stop-${i}`, name: `Imaginary Distance Stop ${i}`, latitude: 42.7 + (12 - i) / 10000, longitude: 23.3, provenance }));
  const adapter = new FixtureSofiaDataAdapter({ stops, walkingRoutes: stops.map((stop, i) => ({ origin: 'distance-property', destination: stop.id, distanceMeters: 200 + i * 10, durationSeconds: 150 + i * 10, provenance })) });
  const server = createServer({ storage, sofiaData: adapter });
  const client = new Client({ name: 'area-distance-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = ClientTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const result = await client.callTool({ name: 'area_context', arguments: { listingId: 'distance-property', radiusMeters: 500 } });
    const nearby = result.structuredContent.nearbyStops;
    assert.equal(nearby.totalWithinRadius, 12);
    assert.equal(nearby.items.length, 10);
    assert.equal(nearby.distanceType, 'pedestrian-route');
    assert.equal(nearby.nearestDistanceMeters, 200);
    assert.deepEqual(nearby.items.map(item => item.distanceMeters), Array.from({ length: 10 }, (_, i) => 200 + i * 10));
    assert.ok(Math.abs(nearby.nearestStraightLineDistanceMeters - 11.1195) < 0.001, 'nearest coordinate distance belongs to the twelfth routed stop');
    assert.match(result.content[0].text, /12 nearby stops, nearest pedestrian-route distance 200 m, nearest straight-line distance 11 m/);
  } finally { await client.close(); await server.close(); storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('area_context reports unavailable transit and features when no Sofia source data exists', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-area-empty-'));
  const storage = openStorage(join(directory, 'test.db'));
  storage.upsertListing({ id: 'empty-property', location: { city: 'Sofia', district: 'Iztok', precision: 'neighbourhood' } });
  const server = createServer({ storage, sofiaData: new FixtureSofiaDataAdapter({}) });
  const client = new Client({ name: 'area-empty-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = ClientTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const result = await client.callTool({ name: 'area_context', arguments: { listingId: 'empty-property' } });
    assert.equal(result.isError, undefined, result.content?.[0]?.text);
    const context = result.structuredContent;
    assert.equal(context.location.precision, 'neighbourhood');
    assert.equal(context.nearbyStops.status, 'unavailable');
    assert.equal(context.schedules.status, 'unavailable');
    assert.equal(context.municipalFeatures.status, 'unavailable');
    assert.deepEqual(context.sourceMetadata, { stops: [], schedules: [], municipalFeatures: [], routing: [] });
  } finally { await client.close(); await server.close(); storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('area_context isolates source failures, deduplicates stops and bounds structured output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-area-resilient-'));
  const storage = openStorage(join(directory, 'test.db'));
  storage.upsertListing({ id: 'resilient-property', location: { city: 'Sofia', district: 'Iztok', coordinates: { latitude: 42.7, longitude: 23.3 }, precision: 'exact', propertySpecificEvidence: true } });
  const provenance = { name: 'Synthetic GTFS', sourceUrl: 'https://fixture.test/gtfs', datasetDate: 'synthetic', checkedAt: '2026-01-02', reuseTerms: 'Synthetic fixture' };
  const stops = Array.from({ length: 5000 }, (_, i) => ({ id: `stop-${i}`, name: `Imaginary Stop ${Math.floor(i / 2)}`, latitude: 42.70001 + Math.floor(i / 2) / 1e8, longitude: 23.3, provenance }));
  const adapter = {
    async getStops() { return stops; }, async getSchedules() { throw new Error('schedule fixture failure'); },
    async getMunicipalFeatures() { return [{ id: 'park-x', name: 'Imaginary Park', category: 'park', latitude: 42.701, longitude: 23.301, provenance }]; },
    async getWalkingRoutes() { throw new Error('routing fixture failure'); },
    async getMunicipalLocations() { return { addresses: [], districts: [] }; },
  };
  const server = createServer({ storage, sofiaData: adapter });
  const client = new Client({ name: 'area-resilient-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = ClientTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const result = await client.callTool({ name: 'area_context', arguments: { listingId: 'resilient-property', radiusMeters: 1000 } });
    const context = result.structuredContent;
    assert.equal(context.location.coordinates.latitude, 42.7);
    assert.equal(context.nearbyStops.totalWithinRadius, 2500);
    assert.equal(context.nearbyStops.items.length, 10);
    assert.ok(context.nearbyStops.items.every((item, index, all) => index === 0 || all[index - 1].distanceMeters <= item.distanceMeters));
    assert.equal(context.nearbyStops.items[0].sourceIds.length, 2);
    assert.equal(context.schedules.status, 'unavailable');
    assert.match(context.schedules.reason, /schedule fixture failure/);
    assert.equal(context.municipalFeatures.status, 'unavailable');
    assert.match(context.municipalFeatures.reason, /routing fixture failure/);
    assert.equal(context.sourceMetadata.stops.length, 1);
    assert.equal('provenance' in context.nearbyStops.items[0], false);
    assert.ok(Buffer.byteLength(JSON.stringify(context)) < 20000);
    assert.match(result.content[0].text, /2500/);
    assert.match(result.content[0].text, /straight-line/);
  } finally { await client.close(); await server.close(); storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('area_context preserves results when each individual Sofia source rejects', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-area-rejection-'));
  const storage = openStorage(join(directory, 'test.db'));
  storage.upsertListing({ id: 'failure-property', location: { city: 'Sofia', district: 'Iztok', coordinates: { latitude: 42.7, longitude: 23.3 }, precision: 'exact', propertySpecificEvidence: true } });
  const provenance = { name: 'Synthetic fixture', sourceUrl: 'https://fixture.test/data', datasetDate: 'synthetic', checkedAt: '2026-01-02', reuseTerms: 'Synthetic fixture' };
  for (const failedMethod of ['getStops', 'getSchedules', 'getMunicipalFeatures', 'getWalkingRoutes']) {
    const adapter = {
      async getStops() { if (failedMethod === 'getStops') throw Error('failed getStops'); return [{ id: 'source-stop', name: 'Imaginary Stop', latitude: 42.701, longitude: 23.3, provenance }]; },
      async getSchedules() { if (failedMethod === 'getSchedules') throw Error('failed getSchedules'); return []; },
      async getMunicipalFeatures() { if (failedMethod === 'getMunicipalFeatures') throw Error('failed getMunicipalFeatures'); return []; },
      async getWalkingRoutes() { if (failedMethod === 'getWalkingRoutes') throw Error('failed getWalkingRoutes'); return []; },
      async getMunicipalLocations() { return { addresses: [], districts: [] }; },
    };
    const server = createServer({ storage, sofiaData: adapter });
    const client = new Client({ name: 'area-failure-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = ClientTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      const result = await client.callTool({ name: 'area_context', arguments: { listingId: 'failure-property' } });
      assert.equal(result.isError, undefined, result.content?.[0]?.text);
      assert.equal(result.structuredContent.location.coordinates.latitude, 42.7);
      assert.ok(result.structuredContent.uncertainty.length > 0);
      assert.ok(result.content[0].text.includes('unavailable'));
    } finally { await client.close(); await server.close(); }
  }
  storage.close(); await rm(directory, { recursive: true, force: true });
});

test('area_context bounds IDs and provenance for 5000 duplicate stops', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imoti-area-duplicate-limit-'));
  const storage = openStorage(join(directory, 'test.db'));
  storage.upsertListing({ id: 'duplicate-property', location: { city: 'Sofia', coordinates: { latitude: 42.7, longitude: 23.3 }, precision: 'exact', propertySpecificEvidence: true } });
  const stops = Array.from({ length: 5000 }, (_, i) => ({ id: `synthetic-stop-source-${i}-${'x'.repeat(80)}`, name: 'Imaginary Duplicate Stop', latitude: 42.701, longitude: 23.3, provenance: { name: `Synthetic source ${i}`, sourceUrl: `https://fixture.test/source/${i}`, datasetDate: 'synthetic', checkedAt: '2026-01-02', reuseTerms: 'Synthetic fixture' } }));
  const adapter = { async getStops() { return stops; }, async getSchedules() { return []; }, async getMunicipalFeatures() { return []; }, async getWalkingRoutes() { return []; }, async getMunicipalLocations() { return { addresses: [], districts: [] }; } };
  const server = createServer({ storage, sofiaData: adapter });
  const client = new Client({ name: 'area-duplicate-limit-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = ClientTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const result = await client.callTool({ name: 'area_context', arguments: { listingId: 'duplicate-property', radiusMeters: 1000 } });
    const context = result.structuredContent;
    assert.equal(context.nearbyStops.totalWithinRadius, 1);
    assert.ok(context.nearbyStops.items[0].sourceIds.length < 10);
    assert.equal(context.sourceMetadata.stops.length, 10);
    assert.ok(Buffer.byteLength(JSON.stringify(context)) < 20000);
  } finally { await client.close(); await server.close(); storage.close(); await rm(directory, { recursive: true, force: true }); }
});
