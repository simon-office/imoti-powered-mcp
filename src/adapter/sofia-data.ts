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
  fetchStops?: () => Promise<string | { stopsText: string; feedInfoText?: string } | ArrayBuffer | Uint8Array>;
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
    const zipFiles = feed instanceof ArrayBuffer || feed instanceof Uint8Array
      ? readZipEntries(feed)
      : undefined;
    const stopsText = zipFiles
      ? [...zipFiles].find(([name]) => name === 'stops.txt' || name.endsWith('/stops.txt'))?.[1] && new TextDecoder().decode([...zipFiles].find(([name]) => name === 'stops.txt' || name.endsWith('/stops.txt'))![1])
      : typeof feed === 'string' ? feed : 'stopsText' in feed ? feed.stopsText : undefined;
    if (!stopsText) throw new Error('Sofia GTFS archive does not contain stops.txt');
    const feedInfoEntry = zipFiles ? [...zipFiles].find(([name]) => name === 'feed_info.txt' || name.endsWith('/feed_info.txt'))?.[1] : undefined;
    const feedInfo = zipFiles ? (feedInfoEntry ? new TextDecoder().decode(feedInfoEntry) : undefined) : typeof feed === 'string' || feed instanceof ArrayBuffer || feed instanceof Uint8Array ? undefined : feed.feedInfoText;
    const datasetDate = parseFeedStartDate(feedInfo);
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

export function readZipEntries(archive: ArrayBuffer | Uint8Array): Map<string, Uint8Array> {
  const bytes = Buffer.from(archive instanceof ArrayBuffer ? archive : archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0 || eocd + 22 > bytes.length) throw new Error('Malformed ZIP archive: end-of-central-directory record is missing');
  if (bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0) throw new Error('Unsupported multi-disk ZIP archive');
  const count = bytes.readUInt16LE(eocd + 10), directorySize = bytes.readUInt32LE(eocd + 12), directoryOffset = bytes.readUInt32LE(eocd + 16);
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw new Error('Unsupported ZIP64 archive');
  if (directoryOffset + directorySize > eocd) throw new Error('Malformed ZIP archive: central directory is out of bounds');
  const result = new Map<string, Uint8Array>(); let cursor = directoryOffset;
  for (let entry = 0; entry < count; entry++) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Malformed ZIP archive: invalid central directory entry');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), compressedSize = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32), localOffset = bytes.readUInt32LE(cursor + 42);
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) throw new Error('Unsupported ZIP64 archive');
    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    if (flags & 1) throw new Error(`Encrypted ZIP entry is unsupported: ${name}`);
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Malformed ZIP archive: local header missing for ${name}`);
    const dataStart = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
    if (dataStart + compressedSize > bytes.length) throw new Error(`Malformed ZIP archive: compressed entry is out of bounds for ${name}`);
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    let content: Uint8Array;
    if (method === 0) content = new Uint8Array(compressed);
    else if (method === 8) content = new Uint8Array(inflateRawSync(compressed));
    else throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
    result.set(name, content);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

function unzipFirstCsv(archive: ArrayBuffer): string {
  const entry = [...readZipEntries(archive)].find(([name]) => name.endsWith('.csv'));
  if (!entry) throw new Error('Municipal address ZIP does not contain a CSV file');
  return new TextDecoder().decode(entry[1]);
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
  const locationTypeIndex = header.indexOf('location_type');
  if (indexes.some(index => index < 0)) throw new Error('Invalid GTFS stops.txt: required columns are missing');
  const result = lines.slice(1).flatMap(line => {
    const row = parseCsvLine(line);
    const [id, name, latitude, longitude] = indexes.map(index => row[index] ?? '');
    const locationType = locationTypeIndex < 0 ? '' : (row[locationTypeIndex] ?? '').trim();
    if (locationType !== '' && locationType !== '0') return [];
    const lat = Number(latitude), lon = Number(longitude);
    if (!id.trim() || !name.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new Error('Invalid GTFS stops.txt: stop identifiers, names and finite coordinates are required');
    }
    return { id, name, latitude: lat, longitude: lon };
  });
  if (!result.length) throw new Error('Invalid GTFS stops.txt: no usable named boarding stops remain');
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
  const files = readZipEntries(await response.arrayBuffer());
  const normalized = new Map([...files].map(([name, value]) => [name.split('/').at(-1)!, new TextDecoder().decode(value)]));
  const stopsText = normalized.get('stops.txt');
  if (!stopsText) throw new Error('Sofia GTFS archive does not contain stops.txt');
  return { stopsText, feedInfoText: normalized.get('feed_info.txt') };
}
