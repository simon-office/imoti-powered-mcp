import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openStorage } from '../dist/storage/index.js';

test('storage migrates an empty file and persists listings, observations, searches, notes and watch state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'imoti-storage-'));
  const storage = openStorage(join(dir, 'nested', 'imoti.db'));
  try {
    const listing = { id: 'site-1', propertyKey: null, title: 'Fake flat', price: 123, location: { precision: 'street', name: 'Imaginary Rd' } };
    storage.upsertListing(listing, '2026-01-01T00:00:00.000Z');
    storage.upsertListing({ ...listing, price: 120 }, '2026-01-02T00:00:00.000Z');
    assert.deepEqual(storage.getListing('site-1'), { ...listing, price: 120, firstObservedAt: '2026-01-01T00:00:00.000Z', lastObservedAt: '2026-01-02T00:00:00.000Z' });
    const observation = { listingId: 'site-1', observedAt: '2026-01-02T00:00:00.000Z', sourceUrl: 'https://example.invalid/fake', raw: { amount: '120' }, normalized: { price: 120 } };
    storage.recordObservation(observation);
    storage.recordObservation(observation);
    assert.deepEqual(storage.listObservations('site-1'), [observation]);
    storage.saveSearch({ id: 's1', criteria: { city: 'Sofia' }, createdAt: '2026-01-02T00:00:00.000Z' });
    assert.deepEqual(storage.listSearches(), [{ id: 's1', criteria: { city: 'Sofia' }, createdAt: '2026-01-02T00:00:00.000Z' }]);
    storage.addNote({ id: 'n1', listingId: 'site-1', text: 'Ask about heating', createdAt: '2026-01-02T00:00:00.000Z' });
    assert.deepEqual(storage.listNotes('site-1'), [{ id: 'n1', listingId: 'site-1', text: 'Ask about heating', createdAt: '2026-01-02T00:00:00.000Z' }]);
    storage.watch('site-1');
    storage.watch('site-1');
    assert.deepEqual(storage.listWatched(), ['site-1']);
    storage.unwatch('site-1');
    assert.deepEqual(storage.listWatched(), []);
    storage.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('storage defaults database path beneath IMOTI_DATA_DIR and rejects unsupported location precision', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'imoti-storage-'));
  const previous = process.env.IMOTI_DATA_DIR;
  process.env.IMOTI_DATA_DIR = dir;
  try {
    const storage = openStorage();
    assert.throws(() => storage.upsertListing({ id: 'bad', location: { precision: 'city' } }));
    storage.close();
  } finally {
    if (previous === undefined) delete process.env.IMOTI_DATA_DIR;
    else process.env.IMOTI_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('site listing ids remain distinct when they share a physical property key and event kinds are constrained', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'imoti-storage-'));
  const path = join(dir, 'imoti.db');
  const storage = openStorage(path);
  try {
    storage.upsertListing({ id: 'site-a', propertyKey: 'building-7' });
    storage.upsertListing({ id: 'site-b', propertyKey: 'building-7' });
    assert.equal(storage.getListing('site-a').id, 'site-a');
    assert.equal(storage.getListing('site-b').id, 'site-b');
  } finally {
    storage.close();
  }
  const db = new DatabaseSync(path);
  try {
    assert.throws(() => db.prepare("INSERT INTO events(listing_id, kind, occurred_at, event_json) VALUES ('site-a', 'unknown', 'now', '{}')").run());
    assert.equal(db.prepare('SELECT version FROM schema_version').get().version, 1);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
