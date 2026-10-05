import type { MunicipalFeature, TransitSchedule, TransitStop, WalkingRoute } from '../area/types.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export interface SofiaDataAdapter {
  getStops(): Promise<TransitStop[]>;
  getSchedules(): Promise<TransitSchedule[]>;
  getMunicipalFeatures(): Promise<MunicipalFeature[]>;
  getWalkingRoutes(): Promise<WalkingRoute[]>;
}

export interface SofiaDataFixtures {
  stops?: Array<TransitStop | GtfsStopRow>;
  schedules?: TransitSchedule[];
  features?: MunicipalFeature[];
  walkingRoutes?: WalkingRoute[];
}

/** A local, source-shaped GTFS stop row; coordinates may arrive as CSV strings. */
export interface GtfsStopRow {
  stop_id: string;
  stop_name: string;
  stop_lat: string | number;
  stop_lon: string | number;
  provenance: TransitStop['provenance'];
}

export class FixtureSofiaDataAdapter implements SofiaDataAdapter {
  readonly #fixtures: SofiaDataFixtures;

  constructor(fixtures: SofiaDataFixtures) {
    this.#fixtures = structuredClone(fixtures);
  }

  async getStops(): Promise<TransitStop[]> {
    return (this.#fixtures.stops ?? []).map((stop) => {
      if ('stop_id' in stop) {
        return {
          id: stop.stop_id,
          name: stop.stop_name,
          latitude: Number(stop.stop_lat),
          longitude: Number(stop.stop_lon),
          provenance: structuredClone(stop.provenance)
        };
      }
      return structuredClone(stop);
    });
  }

  async getSchedules(): Promise<TransitSchedule[]> {
    return structuredClone(this.#fixtures.schedules ?? []);
  }

  async getMunicipalFeatures(): Promise<MunicipalFeature[]> {
    return structuredClone(this.#fixtures.features ?? []);
  }

  async getWalkingRoutes(): Promise<WalkingRoute[]> {
    return structuredClone(this.#fixtures.walkingRoutes ?? []);
  }
}

export interface SofiaLocalCache {
  read(key: string): Promise<string | undefined>;
  write(key: string, value: string): Promise<void>;
}

export interface LocalSofiaDataAdapterOptions {
  cache?: SofiaLocalCache;
  dataDirectory?: string;
  fetchStops?: () => Promise<string | { stopsText: string; feedInfoText?: string }>;
  now?: () => Date;
}

const GTFS_URL = 'https://gtfs.sofiatraffic.bg/api/v1/static';
const REUSE_TERMS = 'Unresolved conflict: the municipal mobility policy lists CC BY 4.0, while the GTFS catalog labels this dataset CC BY-SA (version unspecified). Confirm with the publisher; no license is inferred.';

export class LocalSofiaDataAdapter implements SofiaDataAdapter {
  readonly #cache: SofiaLocalCache;
  readonly #fetchStops: NonNullable<LocalSofiaDataAdapterOptions['fetchStops']>;
  readonly #now: () => Date;

  constructor(options: LocalSofiaDataAdapterOptions = {}) {
    this.#cache = options.cache ?? fileCache(options.dataDirectory ?? process.env.IMOTI_DATA_DIR ?? join(homedir(), '.imoti-powered-mcp'));
    this.#fetchStops = options.fetchStops ?? fetchOfficialStops;
    this.#now = options.now ?? (() => new Date());
  }

  async getStops(): Promise<TransitStop[]> {
    const cached = await this.#cache.read('sofia-gtfs-stops.json').catch(() => undefined);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as TransitStop[];
        if (Array.isArray(parsed) && parsed.length && parsed.every(validStop)) return parsed;
      } catch { /* refresh invalid cache */ }
    }
    const feed = await this.#fetchStops();
    const stopsText = typeof feed === 'string' ? feed : feed.stopsText;
    const datasetDate = typeof feed === 'string' ? 'unknown' : parseFeedStartDate(feed.feedInfoText);
    const rows = parseGtfsStops(stopsText);
    const checkedAt = this.#now().toISOString();
    const stops: TransitStop[] = rows.map(row => ({ ...row, provenance: {
      name: 'Sofia Urban Mobility Center static GTFS', sourceUrl: GTFS_URL,
      datasetDate, checkedAt, reuseTerms: REUSE_TERMS
    } }));
    await this.#cache.write('sofia-gtfs-stops.json', JSON.stringify(stops));
    return stops;
  }

  async getSchedules(): Promise<TransitSchedule[]> { return []; }
  async getMunicipalFeatures(): Promise<MunicipalFeature[]> { return []; }
  async getWalkingRoutes(): Promise<WalkingRoute[]> { return []; }
}

function validStop(value: unknown): value is TransitStop {
  if (!value || typeof value !== 'object') return false;
  const stop = value as TransitStop;
  return typeof stop.id === 'string' && !!stop.id && typeof stop.name === 'string' && !!stop.name &&
    Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude) && !!stop.provenance &&
    typeof stop.provenance.sourceUrl === 'string' && typeof stop.provenance.datasetDate === 'string' &&
    typeof stop.provenance.checkedAt === 'string' && typeof stop.provenance.reuseTerms === 'string';
}

export function parseGtfsStops(text: string): Array<Pick<TransitStop, 'id' | 'name' | 'latitude' | 'longitude'>> {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('Invalid GTFS stops.txt: no stop rows');
  const header = parseCsvLine(lines[0]);
  const indexes = ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'].map(name => header.indexOf(name));
  if (indexes.some(index => index < 0)) throw new Error('Invalid GTFS stops.txt: required columns are missing');
  const result = lines.slice(1).map(line => {
    const row = parseCsvLine(line);
    const [id, name, latitude, longitude] = indexes.map(index => row[index] ?? '');
    const lat = Number(latitude), lon = Number(longitude);
    if (!id.trim() || !name.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new Error('Invalid GTFS stops.txt: stop identifiers, names and finite coordinates are required');
    }
    return { id, name, latitude: lat, longitude: lon };
  });
  if (!result.length) throw new Error('Invalid GTFS stops.txt: no stop rows');
  return result;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') { field += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { fields.push(field); field = ''; }
    else field += char;
  }
  if (quoted) throw new Error('Invalid GTFS stops.txt: unterminated CSV quote');
  fields.push(field);
  return fields;
}

function fileCache(directory: string): SofiaLocalCache {
  return {
    async read(key) { try { return await readFile(join(directory, key), 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; } },
    async write(key, value) { await mkdir(directory, { recursive: true }); await writeFile(join(directory, key), value); }
  };
}

function parseFeedStartDate(text?: string): string {
  if (!text) return 'unknown';
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return 'unknown';
  const headers = parseCsvLine(lines[0]);
  const dateIndex = headers.indexOf('feed_start_date');
  if (dateIndex < 0) return 'unknown';
  const value = parseCsvLine(lines[1])[dateIndex] ?? '';
  if (!/^\d{8}$/.test(value)) return 'unknown';
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

async function fetchOfficialStops(): Promise<{ stopsText: string; feedInfoText?: string }> {
  const response = await fetch(GTFS_URL);
  if (!response.ok) throw new Error(`Sofia GTFS download failed with HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const files = new Map<string, string>();
  let offset = 0;
  while (offset + 30 < archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const name = archive.toString('utf8', offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    const data = archive.subarray(start, start + compressedSize);
    if (name === 'stops.txt' || name.endsWith('/stops.txt') || name === 'feed_info.txt' || name.endsWith('/feed_info.txt')) {
      let decoded: Uint8Array;
      if (method === 0) decoded = data;
      else if (method === 8) decoded = inflateRawSync(data);
      else throw new Error(`Unsupported GTFS ZIP compression method ${method}`);
      files.set(name.split('/').at(-1)!, new TextDecoder().decode(decoded));
      if (files.has('stops.txt') && files.has('feed_info.txt')) break;
    }
    offset = start + compressedSize;
  }
  const stopsText = files.get('stops.txt');
  if (!stopsText) throw new Error('Sofia GTFS archive does not contain stops.txt');
  return { stopsText, feedInfoText: files.get('feed_info.txt') };
}
