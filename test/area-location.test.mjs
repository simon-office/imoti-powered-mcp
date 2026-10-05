import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveListingLocation } from '../dist/area/location.js';
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
    assert.equal(context.nearbyStops.provenance[0].routing.datasetDate, 'synthetic-2026-03-04');
    assert.equal(context.sourceMetadata.stops[0].datasetDate, 'synthetic-2026-03-04');
    assert.equal(context.sourceMetadata.routing[0].sourceUrl, 'https://fixture.test/area');
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
