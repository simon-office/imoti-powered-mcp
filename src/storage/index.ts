import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';

export type LocationPrecision = 'exact' | 'street' | 'neighbourhood' | 'unknown';
export type NoteKind = 'favourite' | 'rejected' | 'viewing' | 'note';
export type EventKind = 'new_match' | 'price_change' | 'edited' | 'disappeared';
export interface Event { id: number; listingId: string; kind: EventKind; occurredAt: string; data: unknown }
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
export interface Note { id: string; listingId: string; kind: NoteKind; text: string; createdAt: string; [key: string]: unknown }
export interface Storage {
  upsertListing(listing: Listing, observedAt?: string): void;
  getListing(id: string): Listing | undefined;
  recordObservation(observation: Observation): void;
  listObservations(listingId?: string): Observation[];
  recordChange(event: Omit<Event, 'id'>): boolean;
  listChanges(options?: { since?: string; limit?: number }): Event[];
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
const noteKindValues = new Set<NoteKind>(['favourite', 'rejected', 'viewing', 'note']);
const eventKindValues = new Set<EventKind>(['new_match', 'price_change', 'edited', 'disappeared']);
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function openStorage(path?: string): Storage {
  const dataDir = process.env.IMOTI_DATA_DIR || join(homedir(), '.imoti-powered-mcp');
  const dbPath = path ?? join(dataDir, 'imoti.db');
  // DatabaseSync opens synchronously; mkdirSync guarantees its parent exists.
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  const existingVersionTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'").get();
  let version = 0;
  if (existingVersionTable) {
    const existingVersion = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
    version = existingVersion?.version ?? 0;
    if (version > 2) {
      db.close();
      throw new Error(`Database schema version ${version} is newer than supported version 2`);
    }
  } else {
    db.exec('CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (0);');
  }
  const migrations: Array<{ version: number; sql: string }> = [{ version: 1, sql: `
    CREATE TABLE listings (
      id TEXT PRIMARY KEY, property_key TEXT, normalized_json TEXT NOT NULL,
      first_observed_at TEXT NOT NULL, last_observed_at TEXT NOT NULL
    );
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id TEXT NOT NULL REFERENCES listings(id),
      observed_at TEXT NOT NULL, source_url TEXT NOT NULL, raw_json TEXT NOT NULL,
      normalized_json TEXT NOT NULL, UNIQUE(listing_id, observed_at, source_url)
    );
    CREATE TABLE searches (id TEXT PRIMARY KEY, search_json TEXT NOT NULL);
    CREATE TABLE notes (id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES listings(id), note_json TEXT NOT NULL);
    CREATE TABLE watchlist (listing_id TEXT PRIMARY KEY);
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id TEXT NOT NULL REFERENCES listings(id),
      kind TEXT NOT NULL CHECK(kind IN ('new_match','price_change','edited','disappeared')),
      occurred_at TEXT NOT NULL, event_json TEXT NOT NULL
    );` }, { version: 2, sql: `SELECT 1;` }];
  db.exec('PRAGMA foreign_keys = ON');
  try {
    for (const migration of migrations) {
      if (migration.version <= version) continue;
      db.exec('BEGIN');
      try {
        db.exec(migration.sql);
        db.prepare('UPDATE schema_version SET version = ?').run(migration.version);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  } catch (error) {
    db.close();
    throw error;
  }
  return {
    upsertListing(listing, observedAt = new Date().toISOString()) {
      if (!listing.id) throw new TypeError('listing.id is required');
      if (listing.location && !precisionValues.has(listing.location.precision)) throw new TypeError('Invalid location precision');
      const previous = db.prepare('SELECT first_observed_at, last_observed_at, normalized_json FROM listings WHERE id = ?').get(listing.id) as { first_observed_at: string; last_observed_at: string; normalized_json: string } | undefined;
      if (previous && observedAt < previous.last_observed_at) return;
      const first = previous?.first_observed_at ?? listing.firstObservedAt ?? observedAt;
      const current = { ...listing, firstObservedAt: first, lastObservedAt: observedAt };
      // Compare JSON values with stored timestamps so equivalent upserts are no-ops.
      if (previous && isDeepStrictEqual(
        JSON.parse(previous.normalized_json),
        JSON.parse(JSON.stringify({ ...current, lastObservedAt: previous.last_observed_at })),
      )) return;
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
      db.exec('BEGIN IMMEDIATE');
      try {
        // A first observation creates its listing below, before commit checks the FK.
        db.exec('PRAGMA defer_foreign_keys = ON');
        const inserted = db.prepare(`INSERT INTO observations(listing_id, observed_at, source_url, raw_json, normalized_json)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(listing_id, observed_at, source_url) DO NOTHING RETURNING id`)
          .get(observation.listingId, observation.observedAt, observation.sourceUrl, JSON.stringify(observation.raw), JSON.stringify(observation.normalized));
        if (inserted) {
          const current = this.getListing(observation.listingId);
          const normalized = (observation.normalized && typeof observation.normalized === 'object') ? observation.normalized as Record<string, unknown> : {};
          this.upsertListing({ ...normalized, ...(normalized.propertyKey == null && current?.propertyKey !== undefined ? { propertyKey: current.propertyKey } : {}), id: observation.listingId }, observation.observedAt);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    listObservations(listingId) {
      const rows = (listingId === undefined
        ? db.prepare('SELECT listing_id, observed_at, source_url, raw_json, normalized_json FROM observations ORDER BY observed_at, id').all()
        : db.prepare('SELECT listing_id, observed_at, source_url, raw_json, normalized_json FROM observations WHERE listing_id = ? ORDER BY observed_at, id').all(listingId)) as Array<Record<string, string>>;
      return rows.map(row => ({ listingId: row.listing_id, observedAt: row.observed_at, sourceUrl: row.source_url, raw: JSON.parse(row.raw_json), normalized: JSON.parse(row.normalized_json) }));
    },
    recordChange(event) {
      if (!eventKindValues.has(event.kind)) throw new TypeError('Invalid event kind');
      if (event.kind === 'disappeared' && !isDeepStrictEqual(event.data, { status: 'no longer observed' })) {
        throw new TypeError('Disappeared event data must indicate no longer observed');
      }
      const dataJson = stableJson(event.data);
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = db.prepare('SELECT id FROM events WHERE listing_id = ? AND kind = ? AND occurred_at = ? AND event_json = ?').get(event.listingId, event.kind, event.occurredAt, dataJson);
        if (existing) { db.exec('COMMIT'); return false; }
        db.prepare('INSERT INTO events(listing_id, kind, occurred_at, event_json) VALUES (?, ?, ?, ?)').run(event.listingId, event.kind, event.occurredAt, dataJson);
        db.exec('COMMIT');
        return true;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    listChanges(options = {}) {
      const limit = options.limit === undefined ? -1 : Math.max(0, Math.floor(options.limit));
      const rows = options.since === undefined
        ? db.prepare('SELECT id, listing_id, kind, occurred_at, event_json FROM events ORDER BY occurred_at, id LIMIT ?').all(limit)
        : db.prepare('SELECT id, listing_id, kind, occurred_at, event_json FROM events WHERE occurred_at >= ? ORDER BY occurred_at, id LIMIT ?').all(options.since, limit);
      return (rows as Array<{ id: number; listing_id: string; kind: EventKind; occurred_at: string; event_json: string }>).map(row => ({ id: row.id, listingId: row.listing_id, kind: row.kind, occurredAt: row.occurred_at, data: JSON.parse(row.event_json) }));
    },
    saveSearch(search) { db.prepare('INSERT INTO searches(id, search_json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET search_json=excluded.search_json').run(search.id, JSON.stringify(search)); },
    listSearches() { return (db.prepare('SELECT search_json FROM searches ORDER BY rowid').all() as Array<{ search_json: string }>).map(row => JSON.parse(row.search_json) as SavedSearch); },
    addNote(note) {
      if (!noteKindValues.has(note.kind)) throw new TypeError('Invalid note kind');
      db.prepare('INSERT OR IGNORE INTO notes(id, listing_id, note_json) VALUES (?, ?, ?)').run(note.id, note.listingId, JSON.stringify(note));
    },
    listNotes(listingId) {
      return (db.prepare('SELECT note_json FROM notes WHERE listing_id = ? ORDER BY rowid').all(listingId) as Array<{ note_json: string }>).map(row => {
        const note = JSON.parse(row.note_json) as Note;
        // Version-one notes had no kind; retain them as ordinary free-text notes.
        return { ...note, kind: note.kind ?? 'note' };
      });
    },
    watch(listingId) { db.prepare('INSERT OR IGNORE INTO watchlist(listing_id) VALUES (?)').run(listingId); },
    unwatch(listingId) { db.prepare('DELETE FROM watchlist WHERE listing_id = ?').run(listingId); },
    listWatched() { return (db.prepare('SELECT listing_id FROM watchlist ORDER BY rowid').all() as Array<{ listing_id: string }>).map(row => row.listing_id); },
    close() { db.close(); },
  };
}
