import type { MunicipalFeature, TransitSchedule, TransitStop, WalkingRoute } from '../area/types.js';
import type { MunicipalLocationDatasets } from '../area/location.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export interface SofiaDataAdapter {
  getStops(): Promise<TransitStop[]>;
  getSchedules(): Promise<TransitSchedule[]>;
  getMunicipalFeatures(): Promise<MunicipalFeature[]>;
  getWalkingRoutes(): Promise<WalkingRoute[]>;
  getMunicipalLocations(): Promise<MunicipalLocationDatasets>;
}

export interface SofiaDataFixtures {
  stops?: Array<TransitStop | GtfsStopRow>;
  schedules?: TransitSchedule[];
  features?: MunicipalFeature[];
  walkingRoutes?: WalkingRoute[];
  locations?: MunicipalLocationDatasets;
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
  async getMunicipalLocations(): Promise<MunicipalLocationDatasets> {
    return structuredClone(this.#fixtures.locations ?? { addresses: [], districts: [] });
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
  fetchMunicipalData?: () => Promise<{ addressesZip: ArrayBuffer; districtsText: string }>;
  unzipAddresses?: (archive: ArrayBuffer) => string | Promise<string>;
}

const GTFS_URL = 'https://gtfs.sofiatraffic.bg/api/v1/static';
const ADDRESS_URL = 'https://urbandata.sofia.bg/dataset/5dd1b862-7b4e-4fed-9061-96f1f1288c1e/resource/97dd5d1f-1274-4303-8c68-1e652895a56b/download/address_sofia_csv.zip';
const DISTRICTS_URL = 'https://api.sofiaplan.bg/datasets/297';
const REUSE_TERMS = 'Unresolved conflict: the municipal mobility policy lists CC BY 4.0, while the GTFS catalog labels this dataset CC BY-SA (version unspecified). Confirm with the publisher; no license is inferred.';

export class LocalSofiaDataAdapter implements SofiaDataAdapter {
  readonly #cache: SofiaLocalCache;
  readonly #fetchStops: NonNullable<LocalSofiaDataAdapterOptions['fetchStops']>;
  readonly #now: () => Date;
  readonly #fetchMunicipalData: NonNullable<LocalSofiaDataAdapterOptions['fetchMunicipalData']>;
  readonly #unzipAddresses: NonNullable<LocalSofiaDataAdapterOptions['unzipAddresses']>;

  constructor(options: LocalSofiaDataAdapterOptions = {}) {
    this.#cache = options.cache ?? fileCache(options.dataDirectory ?? process.env.IMOTI_DATA_DIR ?? join(homedir(), '.imoti-powered-mcp'));
    this.#fetchStops = options.fetchStops ?? fetchOfficialStops;
    this.#now = options.now ?? (() => new Date());
    this.#fetchMunicipalData = options.fetchMunicipalData ?? fetchMunicipalData;
    this.#unzipAddresses = options.unzipAddresses ?? unzipFirstCsv;
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

  async getMunicipalLocations(): Promise<MunicipalLocationDatasets> {
    const [addressCache, districtCache] = await Promise.all([
      this.#cache.read('sofia-addresses.json').catch(() => undefined),
      this.#cache.read('sofia-districts.json').catch(() => undefined)
    ]);
    const cached = [parseCachedLocations(addressCache, 'addresses'), parseCachedLocations(districtCache, 'districts')];
    if (cached[0] && cached[1]) return { addresses: cached[0] as MunicipalLocationDatasets['addresses'], districts: cached[1] as MunicipalLocationDatasets['districts'] };
    const fetched = await this.#fetchMunicipalData();
    const checkedAt = this.#now().toISOString();
    const addresses = (cached[0] as MunicipalLocationDatasets['addresses'] | undefined) ?? parseAddressCsv(await this.#unzipAddresses(fetched.addressesZip), {
      name: 'Адреси на територията на Столична община', sourceUrl: ADDRESS_URL, datasetDate: '2026-09-15', checkedAt, reuseTerms: 'CC-BY'
    });
    const districts = (cached[1] as MunicipalLocationDatasets['districts'] | undefined) ?? parseDistrictGeoJson(fetched.districtsText, {
      name: 'Квартали на Столична община', sourceUrl: DISTRICTS_URL, datasetDate: 'unknown', checkedAt, reuseTerms: 'Не са зададени лицензни права'
    });
    if (!cached[0]) await this.#cache.write('sofia-addresses.json', JSON.stringify(addresses));
    if (!cached[1]) await this.#cache.write('sofia-districts.json', JSON.stringify(districts));
    return { addresses, districts };
  }
}

function parseCachedLocations(text: string | undefined, key: 'addresses' | 'districts'): MunicipalLocationDatasets['addresses'] | MunicipalLocationDatasets['districts'] | undefined {
  if (!text) return undefined;
  try {
    const value = JSON.parse(text);
    if (Array.isArray(value) && value.length > 0 && value.every(row => key === 'addresses'
      ? typeof row.settlement === 'string' && typeof row.street === 'string' && typeof row.region === 'string' && Number.isFinite(row.latitude) && Number.isFinite(row.longitude) && validProvenance(row.provenance)
      : typeof row.name === 'string' && Number.isFinite(row.latitude) && Number.isFinite(row.longitude) && validProvenance(row.provenance))) return value;
  } catch { /* refresh malformed cache */ }
  return undefined;
}

function validProvenance(value: unknown): boolean {
  return !!value && typeof value === 'object' && ['name', 'sourceUrl', 'datasetDate', 'checkedAt', 'reuseTerms'].every(key => typeof (value as Record<string, unknown>)[key] === 'string');
}

function parseAddressCsv(text: string, provenance: MunicipalLocationDatasets['addresses'][number]['provenance']): MunicipalLocationDatasets['addresses'] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('Invalid municipal address CSV: no address rows');
  const header = parseDelimitedLine(lines[0], ';');
  const indexes = ['region', 'settlement', 'street', 'n', 'e'].map(key => header.indexOf(key));
  if (indexes.some(index => index < 0)) throw new Error('Invalid municipal address CSV: required columns are missing');
  return lines.slice(1).flatMap(line => {
    const row = parseDelimitedLine(line, ';');
    const [region, settlement, street, latitude, longitude] = indexes.map(index => row[index] ?? '');
    const lat = Number(latitude), lon = Number(longitude);
    if (settlement.trim() !== 'гр. София' || !street.trim() || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) return [];
    return [{ settlement: settlement.trim(), street: street.trim(), region: region.trim(), latitude: lat, longitude: lon, provenance }];
  });
}

function parseDistrictGeoJson(text: string, provenance: MunicipalLocationDatasets['districts'][number]['provenance']): MunicipalLocationDatasets['districts'] {
  const collection = JSON.parse(text) as { features?: Array<{ properties?: { kvname?: unknown }; geometry?: { type?: string; coordinates?: unknown } }> };
  if (!Array.isArray(collection.features)) throw new Error('Invalid SofiaPlan neighbourhood GeoJSON: features are missing');
  return collection.features.flatMap(feature => {
    const name = feature.properties?.kvname;
    const geometry = feature.geometry;
    if (typeof name !== 'string' || geometry?.type !== 'MultiPolygon' || !Array.isArray(geometry.coordinates)) return [];
    const centroid = multiPolygonCentroid(geometry.coordinates as number[][][][]);
    return centroid ? [{ name, latitude: centroid[1], longitude: centroid[0], provenance }] : [];
  });
}

function multiPolygonCentroid(polygons: number[][][][]): [number, number] | undefined {
  let areaSum = 0, xSum = 0, ySum = 0;
  for (const polygon of polygons) {
    const ring = polygon[0];
    if (!ring || ring.length < 4) continue;
    let twiceArea = 0, x = 0, y = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      twiceArea += cross; x += (ring[i][0] + ring[i + 1][0]) * cross; y += (ring[i][1] + ring[i + 1][1]) * cross;
    }
    if (twiceArea) { const signedArea = twiceArea / 2; areaSum += Math.abs(signedArea); xSum += x / 6 * Math.sign(signedArea); ySum += y / 6 * Math.sign(signedArea); }
  }
  return areaSum ? [xSum / areaSum, ySum / areaSum] : undefined;
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const values: string[] = []; let field = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') { field += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { values.push(field); field = ''; }
    else field += char;
  }
  values.push(field); return values;
}

async function fetchMunicipalData(): Promise<{ addressesZip: ArrayBuffer; districtsText: string }> {
  const [addressResponse, districtResponse] = await Promise.all([fetch(ADDRESS_URL), fetch(DISTRICTS_URL)]);
  if (!addressResponse.ok) throw new Error(`Sofia municipal address download failed with HTTP ${addressResponse.status}`);
  if (!districtResponse.ok) throw new Error(`SofiaPlan neighbourhood download failed with HTTP ${districtResponse.status}`);
  return { addressesZip: await addressResponse.arrayBuffer(), districtsText: await districtResponse.text() };
}

function unzipFirstCsv(archive: ArrayBuffer): string {
  const bytes = Buffer.from(archive); let offset = 0;
  while (offset + 30 < bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8), size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.toString('utf8', offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength, data = bytes.subarray(start, start + size);
    if (name.endsWith('.csv')) {
      if (method === 0) return new TextDecoder().decode(data);
      if (method === 8) return new TextDecoder().decode(inflateRawSync(data));
      throw new Error(`Unsupported municipal address ZIP compression method ${method}`);
    }
    offset = start + size;
  }
  throw new Error('Municipal address ZIP does not contain a CSV file');
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
