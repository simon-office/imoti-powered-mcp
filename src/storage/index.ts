import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type LocationPrecision = 'exact' | 'street' | 'neighbourhood' | 'unknown';
export interface Listing {
  id: string;
  propertyKey?: string | null;
  location?: { precision: LocationPrecision; [key: string]: unknown };
  firstObservedAt?: string;
  lastObservedAt?: string;
  [key: string]: unknown;
}
export interface Observation {
  listingId: string;
  observedAt: string;
  sourceUrl: string;
  raw: unknown;
  normalized: unknown;
}
export interface SavedSearch { id: string; criteria: unknown; createdAt: string; [key: string]: unknown }
export interface Note { id: string; listingId: string; text: string; createdAt: string; [key: string]: unknown }
export interface Storage {
  upsertListing(listing: Listing, observedAt?: string): void;
  getListing(id: string): Listing | undefined;
  recordObservation(observation: Observation): void;
  listObservations(listingId: string): Observation[];
  saveSearch(search: SavedSearch): void;
  listSearches(): SavedSearch[];
  addNote(note: Note): void;
  listNotes(listingId: string): Note[];
  watch(listingId: string): void;
  unwatch(listingId: string): void;
  listWatched(): string[];
  close(): void;
}

const precisionValues = new Set<LocationPrecision>(['exact', 'street', 'neighbourhood', 'unknown']);

export function openStorage(path?: string): Storage {
  const dataDir = process.env.IMOTI_DATA_DIR || join(homedir(), '.imoti-powered-mcp');
  const dbPath = path ?? join(dataDir, 'imoti.db');
  // DatabaseSync opens synchronously; mkdirSync guarantees its parent exists.
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  const existingVersionTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'").get();
  if (existingVersionTable) {
    const existingVersion = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
    if (existingVersion && existingVersion.version > 1) {
      db.close();
      throw new Error(`Database schema version ${existingVersion.version} is newer than supported version 1`);
    }
  }
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY, property_key TEXT, normalized_json TEXT NOT NULL,
      first_observed_at TEXT NOT NULL, last_observed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id TEXT NOT NULL REFERENCES listings(id),
      observed_at TEXT NOT NULL, source_url TEXT NOT NULL, raw_json TEXT NOT NULL,
      normalized_json TEXT NOT NULL, UNIQUE(listing_id, observed_at, source_url)
    );
    CREATE TABLE IF NOT EXISTS searches (id TEXT PRIMARY KEY, search_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES listings(id), note_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS watchlist (listing_id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id TEXT NOT NULL REFERENCES listings(id),
      kind TEXT NOT NULL CHECK(kind IN ('new_match','price_change','edited','disappeared')),
      occurred_at TEXT NOT NULL, event_json TEXT NOT NULL
    );`);
  if (!db.prepare('SELECT version FROM schema_version LIMIT 1').get()) {
    db.prepare('INSERT INTO schema_version(version) VALUES (1)').run();
  }
  return {
    upsertListing(listing, observedAt = new Date().toISOString()) {
      if (!listing.id) throw new TypeError('listing.id is required');
      if (listing.location && !precisionValues.has(listing.location.precision)) throw new TypeError('Invalid location precision');
      const previous = db.prepare('SELECT first_observed_at FROM listings WHERE id = ?').get(listing.id) as { first_observed_at: string } | undefined;
      const first = previous?.first_observed_at ?? listing.firstObservedAt ?? observedAt;
      const current = { ...listing, firstObservedAt: first, lastObservedAt: observedAt };
      db.prepare(`INSERT INTO listings(id, property_key, normalized_json, first_observed_at, last_observed_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET property_key=excluded.property_key,
        normalized_json=excluded.normalized_json, last_observed_at=excluded.last_observed_at`)
        .run(listing.id, listing.propertyKey ?? null, JSON.stringify(current), first, observedAt);
    },
    getListing(id) {
      const row = db.prepare('SELECT normalized_json FROM listings WHERE id = ?').get(id) as { normalized_json: string } | undefined;
      return row ? JSON.parse(row.normalized_json) as Listing : undefined;
    },
    recordObservation(observation) {
      this.upsertListing({ id: observation.listingId, ...((observation.normalized && typeof observation.normalized === 'object') ? observation.normalized as object : {}) }, observation.observedAt);
      db.prepare(`INSERT OR IGNORE INTO observations(listing_id, observed_at, source_url, raw_json, normalized_json)
        VALUES (?, ?, ?, ?, ?)`)
        .run(observation.listingId, observation.observedAt, observation.sourceUrl, JSON.stringify(observation.raw), JSON.stringify(observation.normalized));
    },
    listObservations(listingId) {
      const rows = db.prepare('SELECT listing_id, observed_at, source_url, raw_json, normalized_json FROM observations WHERE listing_id = ? ORDER BY observed_at, id').all(listingId) as Array<Record<string, string>>;
      return rows.map(row => ({ listingId: row.listing_id, observedAt: row.observed_at, sourceUrl: row.source_url, raw: JSON.parse(row.raw_json), normalized: JSON.parse(row.normalized_json) }));
    },
    saveSearch(search) { db.prepare('INSERT INTO searches(id, search_json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET search_json=excluded.search_json').run(search.id, JSON.stringify(search)); },
    listSearches() { return (db.prepare('SELECT search_json FROM searches ORDER BY rowid').all() as Array<{ search_json: string }>).map(row => JSON.parse(row.search_json) as SavedSearch); },
    addNote(note) { db.prepare('INSERT OR IGNORE INTO notes(id, listing_id, note_json) VALUES (?, ?, ?)').run(note.id, note.listingId, JSON.stringify(note)); },
    listNotes(listingId) { return (db.prepare('SELECT note_json FROM notes WHERE listing_id = ? ORDER BY rowid').all(listingId) as Array<{ note_json: string }>).map(row => JSON.parse(row.note_json) as Note); },
    watch(listingId) { db.prepare('INSERT OR IGNORE INTO watchlist(listing_id) VALUES (?)').run(listingId); },
    unwatch(listingId) { db.prepare('DELETE FROM watchlist WHERE listing_id = ?').run(listingId); },
    listWatched() { return (db.prepare('SELECT listing_id FROM watchlist ORDER BY rowid').all() as Array<{ listing_id: string }>).map(row => row.listing_id); },
    close() { db.close(); },
  };
}
