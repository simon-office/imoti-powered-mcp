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
