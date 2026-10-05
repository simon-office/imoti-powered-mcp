import { McpServer } from '@modelcontextprotocol/server';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import * as z from 'zod/v4';
import { VERSION } from './version.js';
import type { SiteAdapter } from './adapter/types.js';
import { ProtectiveScreenError } from './adapter/types.js';
import type { Storage, Listing } from './storage/index.js';
import { searchCriteriaSchema } from './search/criteria.js';
import { buildSearchUrls, verifyFilters } from './search/url-builder.js';
import { parseSearchResults } from './parsers/search.js';
import { parseListing } from './parsers/listing.js';
import { resolveDistrict } from './search/slugs.js';
import { analyzePhotos } from './photos/analyzer.js';

declare const process: { env: Record<string, string | undefined> };

export interface ServerDependencies {
  dataDir?: string;
  adapter?: SiteAdapter;
  storage?: Storage;
}

export function createServer(deps: ServerDependencies = {}): McpServer {
  const dataDir = deps.dataDir ?? process.env.IMOTI_DATA_DIR ?? `${homedir()}/.imoti-powered-mcp`;
  const server = new McpServer({ name: 'imoti', version: VERSION });
  const outputSchema = {
    name: z.string(),
    version: z.string(),
    stage: z.literal('3'),
    dataDir: z.string(),
  };

  server.registerTool(
    'server_info',
    {
      description: 'Return the local imoti server version and data directory.',
      inputSchema: {},
      outputSchema,
    },
    async () => {
      const info = { name: 'imoti', version: VERSION, stage: '3' as const, dataDir };
      return {
        structuredContent: info,
        content: [{ type: 'text' as const, text: `imoti ${VERSION} (stage ${info.stage}); data directory: ${dataDir}` }],
      };
    },
  );

  if (deps.storage) {
    const { storage } = deps;
    server.registerTool('get_changes', {
      description: 'List persisted listing changes with a concise, neutral digest.',
      inputSchema: { since: z.string().datetime({ offset: true }).optional(), limit: z.number().int().min(0).optional() },
      outputSchema: z.object({ changes: z.array(z.object({ id: z.number(), listingId: z.string(), kind: z.enum(['new_match', 'price_change', 'edited', 'disappeared']), occurredAt: z.string(), data: z.unknown() })), digest: z.string() }),
    }, async ({ since, limit }) => {
      try {
        const changes = storage.listChanges({ since, limit });
        const counts = Object.fromEntries(['new_match', 'price_change', 'edited', 'disappeared'].map(kind => [kind, changes.filter(event => event.kind === kind).length]));
        const details = changes.map(event => {
          const data = event.data as Record<string, unknown>;
          const listing = storage.getListing(event.listingId);
          const property = listing?.propertyType as { label?: unknown } | undefined;
          const location = listing?.location as { district?: unknown } | undefined;
          const fields = [typeof property?.label === 'string' ? property.label : undefined, typeof location?.district === 'string' ? location.district : undefined, askingPrice(listing?.price)];
          if (event.kind === 'price_change') fields.push(`asking price ${formatValue(data.oldAskingPrice ?? data.from)} → ${formatValue(data.newAskingPrice ?? data.to)}`);
          return `${event.listingId}: ${event.kind}${fields.some(Boolean) ? ` (${fields.filter(Boolean).join(', ')})` : ''}`;
        });
        const digest = changes.length ? `${Object.entries(counts).map(([kind, count]) => `${kind}: ${count}`).join(', ')}; ${details.join('; ')}` : 'No listing changes.';
        return { structuredContent: { changes, digest }, content: [{ type: 'text' as const, text: digest }] };
      } catch (error) { return toolError(error); }
    });
    server.registerTool('save_note', {
      description: 'Save a timestamped note about a listing.',
      inputSchema: { listingId: z.string().min(1), kind: z.enum(['favourite', 'rejected', 'viewing', 'note']), text: z.string() },
      outputSchema: z.object({ note: z.object({ id: z.string(), listingId: z.string(), kind: z.enum(['favourite', 'rejected', 'viewing', 'note']), text: z.string(), createdAt: z.string() }) }),
    }, async ({ listingId, kind, text }) => {
      try {
        const note = { id: randomUUID(), listingId, kind, text, createdAt: new Date().toISOString() };
        storage.addNote(note);
        return { structuredContent: { note }, content: [{ type: 'text' as const, text: `Saved ${kind} note for listing ${listingId}.` }] };
      } catch (error) { return toolError(error); }
    });
    server.registerTool('save_search', {
      description: 'Save a named property search and its criteria.',
      inputSchema: { id: z.string().min(1), criteria: z.record(z.string(), z.unknown()) },
      outputSchema: z.object({ search: z.object({ id: z.string(), criteria: z.record(z.string(), z.unknown()), createdAt: z.string() }) }),
    }, async ({ id, criteria }) => {
      try {
        const existing = storage.listSearches().find(search => search.id === id);
        const search = { id, criteria, createdAt: existing?.createdAt ?? new Date().toISOString() };
        storage.saveSearch(search);
        return { structuredContent: { search }, content: [{ type: 'text' as const, text: `Saved search ${id}.` }] };
      } catch (error) { return toolError(error); }
    });
    server.registerTool('watch_listing', {
      description: 'Add or remove a listing from the watchlist.',
      inputSchema: { listingId: z.string().min(1), watch: z.boolean() },
      outputSchema: z.object({ listingId: z.string(), watching: z.boolean() }),
    }, async ({ listingId, watch }) => {
      try {
        if (watch) storage.watch(listingId); else storage.unwatch(listingId);
        const result = { listingId, watching: storage.listWatched().includes(listingId) };
        return { structuredContent: result, content: [{ type: 'text' as const, text: `${watch ? 'Watching' : 'Stopped watching'} listing ${listingId}.` }] };
      } catch (error) { return toolError(error); }
    });
  }

  if (deps.adapter && deps.storage) {
    const { adapter, storage } = deps;
    server.registerTool('get_listing_photos', {
      description: 'Retrieve a listing’s referenced photos without saving image bytes.',
      inputSchema: { listingId: z.string().min(1), offset: z.number().int().min(0).default(0) },
      outputSchema: z.object({
        listingId: z.string(),
        photos: z.array(z.object({ listingId: z.string(), reference: z.string(), mediaType: z.string(), unavailableReason: z.string().optional() })),
        assessment: z.record(z.string(), z.unknown()),
        nextOffset: z.number().nullable(),
        uncertainty: z.array(z.string()),
      }),
    }, async ({ listingId, offset }) => {
      try {
        const listing = storage.getListing(listingId);
        if (!listing) return { isError: true, content: [{ type: 'text' as const, text: `Listing ${listingId} was not found in local storage.` }] };
        const references = Array.isArray(listing.photos) ? listing.photos.filter((reference): reference is string => typeof reference === 'string') : [];
        const retrieved = await adapter.getListingPhotos(listingId, references);
        const page = retrieved.slice(offset, offset + 3);
        const photos = page.map(({ listingId: photoListingId, reference, mediaType, unavailableReason }) => ({ listingId: photoListingId, reference, mediaType, ...(unavailableReason ? { unavailableReason } : {}) }));
        const uncertainty = photos.flatMap(photo => photo.unavailableReason ? [`Photo ${photo.reference}: ${photo.unavailableReason}`] : []);
        const imageBlocks = page.filter(photo => photo.bytes && /^image\/(?:png|jpeg|webp|gif)$/i.test(photo.mediaType) && photo.bytes.byteLength <= 12_000).map(photo => ({ type: 'image' as const, data: btoa(Array.from(photo.bytes!, byte => String.fromCharCode(byte)).join('')), mimeType: photo.mediaType }));
        const assessment = analyzePhotos(retrieved);
        const nextOffset = offset + page.length < retrieved.length ? offset + page.length : null;
        return { structuredContent: { listingId, photos, assessment, nextOffset, uncertainty }, content: [{ type: 'text' as const, text: `Retrieved photos ${offset + 1}–${offset + page.length} of ${retrieved.length} for listing ${listingId}; ${uncertainty.length} unavailable.${nextOffset === null ? '' : ` Continue with offset ${nextOffset}.`}` }, ...imageBlocks] };
      } catch (error) { return toolError(error); }
    });
    server.registerTool('refresh_watched', {
      description: 'Refresh saved searches and record observed listing changes.',
      inputSchema: {},
      outputSchema: z.object({ refreshedSearches: z.number(), refreshedListings: z.number(), changes: z.number() }),
    }, async () => {
      try {
        let refreshedSearches = 0;
        let refreshedListings = 0;
        let changeCount = 0;
        for (const saved of storage.listSearches()) {
          const criteria = searchCriteriaSchema.parse(saved.criteria);
          const built = buildSearchUrls(criteria);
          const current = new Map<string, { listing: Listing; sourceUrl: string }>();
          const prior = new Map<string, Listing>();
          let complete = true;
          for (const observation of storage.listObservations().filter(item => built.urls.includes(item.sourceUrl))) {
            const snapshot = storage.getListing(observation.listingId);
            if (snapshot) prior.set(observation.listingId, snapshot);
          }
          // Each page must finish parsing before an absent listing can be considered no longer observed.
          for (const url of built.urls) {
            const page = await adapter.fetchPage(url);
            const parsedPage = parseSearchResults(page.html, url);
            if (parsedPage.nextPageUrl) complete = false;
            for (const item of parsedPage.listings) {
              if (!item.id || !item.url) continue;
              const listing: Listing = { ...item, id: item.id, location: { ...item.location, precision: item.location.district ? 'neighbourhood' : 'unknown' }, status: 'available' };
              current.set(item.id, { listing, sourceUrl: url });
            }
          }
          const observedAt = new Date().toISOString();
          const latestChanges = new Map<string, string>();
          for (const event of storage.listChanges()) if (!latestChanges.has(event.listingId)) latestChanges.set(event.listingId, event.kind);
          for (const [id, { listing, sourceUrl }] of current) {
            const previous = storage.getListing(id);
            const priorSnapshot = previous ?? prior.get(id);
            const priorCard = storage.listObservations(id)
              .filter(observation => built.urls.includes(observation.sourceUrl))
              .at(-1)?.normalized as Listing | undefined;
            // Search cards omit detail-page fields; merge observed card values without
            // discarding richer fields already learned from a detail observation.
            const normalized: Listing = priorSnapshot ? {
              ...priorSnapshot,
              ...listing,
              ...(priorSnapshot.location || listing.location ? { location: {
                ...priorSnapshot.location,
                ...listing.location,
                precision: listing.location?.precision ?? priorSnapshot.location?.precision ?? 'unknown',
              } } : {}),
            } : listing;
            storage.recordObservation({ listingId: id, observedAt, sourceUrl, raw: listing, normalized: listing });
            if (priorSnapshot) storage.upsertListing(normalized, observedAt);
            let kind: 'new_match' | 'price_change' | 'edited' | undefined;
            if (!priorSnapshot || latestChanges.get(id) === 'disappeared') kind = 'new_match';
            else {
              if (priorCard) {
                const cardChanged = !sameSnapshot(overlappingSnapshot(priorCard, listing), overlappingSnapshot(listing, priorCard));
                if (cardChanged) kind = !sameSnapshot({ id, price: priorCard.price }, { id, price: listing.price }) ? 'price_change' : 'edited';
              }
            }
            if (kind && storage.recordChange({ listingId: id, kind, occurredAt: observedAt, data: kind === 'price_change' ? { from: priorCard?.price ?? null, to: listing.price ?? null, oldAskingPrice: priorCard?.price ?? null, newAskingPrice: listing.price ?? null } : {} })) { changeCount++; latestChanges.set(id, kind); }
          }
          for (const [id] of prior) if (complete && !current.has(id) && latestChanges.get(id) !== 'disappeared' && storage.recordChange({ listingId: id, kind: 'disappeared', occurredAt: observedAt, data: { status: 'no longer observed' } })) { changeCount++; latestChanges.set(id, 'disappeared'); }
          refreshedSearches++;
        }
        for (const listingId of storage.listWatched()) {
          const url = `https://www.imot.bg/obiava-${listingId}`;
          const page = await adapter.fetchPage(url);
          const parsed = parseListing(page.html, url);
          const observedAt = page.fetchedAt.toISOString();
          const listing: Listing = 'status' in parsed ? { id: listingId, status: 'not_available' } : { ...parsed, id: listingId, status: 'available' };
          const previous = storage.getListing(listingId);
          const priorDetail = storage.listObservations(listingId).filter(observation => isDetailObservation(observation.sourceUrl)).at(-1)?.normalized as Listing | undefined;
          storage.upsertListing(listing, observedAt);
          storage.recordObservation({ listingId, observedAt, sourceUrl: url, raw: listing, normalized: listing });
          if (previous && listing.status === 'not_available') {
            if (storage.recordChange({ listingId, kind: 'disappeared', occurredAt: observedAt, data: { status: 'no longer observed' } })) changeCount++;
          } else if (priorDetail && !sameSnapshot(priorDetail, listing)) {
            const previousPrice = (priorDetail.price as { amount?: unknown } | undefined)?.amount;
            const currentPrice = (listing.price as { amount?: unknown } | undefined)?.amount;
            const kind = previousPrice !== currentPrice ? 'price_change' : 'edited';
            if (storage.recordChange({ listingId, kind, occurredAt: observedAt, data: kind === 'price_change' ? { from: previousPrice ?? null, to: currentPrice ?? null, oldAskingPrice: priorDetail.price ?? null, newAskingPrice: listing.price ?? null } : {} })) changeCount++;
          }
          refreshedListings++;
        }
        return { structuredContent: { refreshedSearches, refreshedListings, changes: changeCount }, content: [{ type: 'text' as const, text: `Refreshed ${refreshedSearches} saved search${refreshedSearches === 1 ? '' : 'es'} and ${refreshedListings} watched listing${refreshedListings === 1 ? '' : 's'}; recorded ${changeCount} change${changeCount === 1 ? '' : 's'}.` }] };
      } catch (error) { return toolError(error); }
    });
    const searchOutput = z.object({
      query: z.object({ urls: z.array(z.string()), criteria: z.record(z.string(), z.unknown()) }),
      verification: z.object({ ok: z.boolean(), mismatches: z.array(z.record(z.string(), z.unknown())) }),
      listings: z.array(z.record(z.string(), z.unknown())), observedAt: z.string(), truncated: z.boolean(), districtCounts: z.record(z.string(), z.number()),
    });
    server.registerTool('search_listings', {
      description: 'Search verified property listings in Sofia. Returns matching listings and filter verification.',
      inputSchema: { criteria: searchCriteriaSchema, limit: z.number().int().min(10).max(20).default(15) },
      outputSchema: searchOutput,
    }, async ({ criteria, limit }) => {
      try {
        const built = buildSearchUrls(criteria);
        const urls: string[] = [];
        const listings = new Map<string, Listing>();
        const sourceUrls = new Map<string, string>();
        const mismatches: Array<Record<string, unknown>> = [];
        let truncated = false;
        const observedAt = new Date().toISOString();
        for (const url of built.urls) {
          urls.push(url);
          const page = await adapter.fetchPage(url);
          const parsed = parseSearchResults(page.html, url);
          // SearchPage exposes listing evidence, so use this page's URL for query-level filters.
          const path = new URL(page.url).pathname.split('/').filter(Boolean);
          const verification = verifyFilters(criteria, { appliedFilters: {
            deal: criteria.deal,
            city: criteria.city,
            district: criteria.districts.length ? path[3] : undefined,
            type: path[criteria.districts.length ? 4 : 3],
          }, listings: parsed.listings.map(item => ({
            dealType: item.dealType, location: { city: item.location.city, district: item.location.district }, propertyType: item.propertyType,
            price: item.price,
          })) });
          mismatches.push(...verification.mismatches);
          for (const item of parsed.listings) {
            if (!item.id || !item.url) continue;
            if (criteria.districts.length && (!item.location.district || !criteria.districts.some(name => resolveDistrict(name).slug === resolveDistrict(item.location.district!).slug))) continue;
            if (criteria.priceMin !== undefined && (item.price?.amount === undefined || item.price.amount < criteria.priceMin)) continue;
            if (criteria.priceMax !== undefined && (item.price?.amount === undefined || item.price.amount > criteria.priceMax)) continue;
            if (criteria.areaMin !== undefined && (item.areaM2 === null || item.areaM2 < criteria.areaMin)) continue;
            if (criteria.areaMax !== undefined && (item.areaM2 === null || item.areaM2 > criteria.areaMax)) continue;
            if (criteria.propertyTypes.length && !criteria.propertyTypes.some(type => matchesPropertyType(type, item.propertyType?.label))) continue;
            if (criteria.rooms && (item.propertyType?.rooms === null || item.propertyType?.rooms === undefined || (criteria.rooms.min !== undefined && item.propertyType.rooms < criteria.rooms.min) || (criteria.rooms.max !== undefined && item.propertyType.rooms > criteria.rooms.max))) continue;
            if (!listings.has(item.id)) {
              listings.set(item.id, { ...item, id: item.id, location: { ...item.location, precision: item.location.district ? 'neighbourhood' : 'unknown' }, status: 'available' });
              sourceUrls.set(item.id, url);
            }
          }
          if (listings.size >= limit) { truncated = true; if (!criteria.districts.length) break; }
        }
        const ordered = [...listings.values()];
        const districtOf = (item: Listing) => (item.location as { district?: unknown } | undefined)?.district;
        const districtGroups = criteria.districts.length ? criteria.districts.map(name => ordered.filter(item => typeof districtOf(item) === 'string' && resolveDistrict(districtOf(item) as string).slug === resolveDistrict(name).slug)) : [ordered];
        const interleaved: Listing[] = [];
        for (let index = 0; districtGroups.some(group => index < group.length); index++) for (const group of districtGroups) if (group[index] && !interleaved.some(item => item.id === group[index].id)) interleaved.push(group[index]);
        const results = interleaved.slice(0, limit);
        const districtCounts = Object.fromEntries(criteria.districts.map(name => [resolveDistrict(name).slug, results.filter(item => typeof districtOf(item) === 'string' && resolveDistrict(districtOf(item) as string).slug === resolveDistrict(name).slug).length]));
        if (listings.size > limit) truncated = true;
        for (const listing of results) {
          storage.upsertListing(listing, observedAt);
          storage.recordObservation({ listingId: listing.id, observedAt, sourceUrl: sourceUrls.get(listing.id) ?? String(listing.url), raw: listing, normalized: listing });
        }
        const output = { query: { urls, criteria }, verification: { ok: mismatches.length === 0, mismatches }, listings: results, observedAt, truncated, districtCounts };
        return { structuredContent: output, content: [{ type: 'text' as const, text: `Found ${results.length} listing${results.length === 1 ? '' : 's'}; filters ${output.verification.ok ? 'verified' : 'need review'}.` }] };
      } catch (error) { return toolError(error); }
    });

    server.registerTool('get_listing', {
      description: 'Get a property listing by id or URL. Uses a recent observation unless refresh is requested.',
      inputSchema: { id: z.string().optional(), url: z.string().url().optional(), refresh: z.boolean().default(false) },
      outputSchema: z.object({ listing: z.record(z.string(), z.unknown()), observedAt: z.string(), cached: z.boolean() }),
    }, async ({ id, url, refresh }) => {
      try {
        const urlMatch = url === undefined ? undefined : parseCanonicalListingUrl(url);
        if (url !== undefined && !urlMatch) return { isError: true, content: [{ type: 'text' as const, text: 'Listing URL must be an HTTPS https://www.imot.bg/obiava-<id>-... URL.' }] };
        if (id !== undefined && urlMatch !== undefined && id !== urlMatch.id) return { isError: true, content: [{ type: 'text' as const, text: 'The supplied id must match the listing URL.' }] };
        const listingId = id ?? urlMatch?.id;
        if (!listingId) return { isError: true, content: [{ type: 'text' as const, text: 'Provide a listing id or imot.bg listing URL.' }] };
        const canonicalUrl = urlMatch?.url ?? `https://www.imot.bg/obiava-${listingId}`;
        const observations = storage.listObservations(listingId);
        const latest = observations.filter(observation => isDetailObservation(observation.sourceUrl)).at(-1);
        if (!refresh && latest && Date.now() - Date.parse(latest.observedAt) < 6 * 60 * 60 * 1000) {
          const cached = latest.normalized as Listing;
          return { structuredContent: { listing: cached, observedAt: latest.observedAt, cached: true }, content: [{ type: 'text' as const, text: `${cached.title ?? `Listing ${listingId}`} (cached observation).` }] };
        }
        const page = await adapter.fetchPage(canonicalUrl);
        const parsed = parseListing(page.html, canonicalUrl);
        const observedAt = page.fetchedAt.toISOString();
        const unavailable = 'status' in parsed;
        const listing: Listing = unavailable ? { id: listingId, status: 'not_available' } : { ...parsed, id: listingId, status: 'available' };
        storage.upsertListing(listing, observedAt);
        storage.recordObservation({ listingId, observedAt, sourceUrl: canonicalUrl, raw: listing, normalized: listing });
        return { structuredContent: { listing, observedAt, cached: false }, content: [{ type: 'text' as const, text: unavailable ? `Listing ${listingId} is no longer available.` : `${parsed.title ?? `Listing ${listingId}`} refreshed.` }] };
      } catch (error) { return toolError(error); }
    });
  }

  return server;
}

function isDetailObservation(sourceUrl: string): boolean {
  try { return /^\/obiava-[^/]+$/i.test(new URL(sourceUrl).pathname); }
  catch { return false; }
}

function sameSnapshot(previous: Listing, current: Listing): boolean {
  const strip = (listing: Listing) => Object.fromEntries(Object.entries(listing).filter(([key]) => key !== 'firstObservedAt' && key !== 'lastObservedAt'));
  return JSON.stringify(sortObject(strip(previous))) === JSON.stringify(sortObject(strip(current)));
}

function overlappingSnapshot(previous: Listing, current: Listing): Listing {
  const overlap = (left: unknown, right: unknown): unknown => {
    if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
      const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
      return Object.fromEntries(Object.keys(a).filter(key => key in b).map(key => [key, overlap(a[key], b[key])]));
    }
    return { left, right };
  };
  return overlap(previous, current) as Listing;
}

function askingPrice(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const price = value as { amount?: unknown; currency?: unknown };
  return typeof price.amount === 'number' ? `${price.amount}${typeof price.currency === 'string' ? ` ${price.currency}` : ''}` : undefined;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'unavailable';
  return askingPrice(value) ?? (typeof value === 'string' || typeof value === 'number' ? String(value) : 'available');
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortObject(item)]));
  return value;
}

function parseCanonicalListingUrl(value: string): { id: string; url: string } | undefined {
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(/^\/obiava-([^/]+)$/i);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.imot.bg' || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash || !match) return undefined;
    const id = match[1].match(/^([^-]+)/)?.[1];
    if (!id) return undefined;
    return { id, url: `https://www.imot.bg${parsed.pathname}` };
  } catch { return undefined; }
}

function matchesPropertyType(requested: string, observed?: string | null): boolean {
  if (!observed) return false;
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9а-я]/gi, '');
  const labels: Record<string, string> = { ednostaen: '1стаен', dvustaen: '2стаен', tristaen: '3стаен', chetiristaen: '4стаен', mnogostaen: '5стаен' };
  const actual = normalize(observed);
  return actual.includes(normalize(requested)) || (labels[requested] !== undefined && actual.includes(normalize(labels[requested])));
}

function toolError(error: unknown) {
  if (error instanceof ProtectiveScreenError) return { isError: true, content: [{ type: 'text' as const, text: error.message }] };
  const message = error instanceof Error ? error.message : 'Unexpected error';
  const districtMatch = message.match(/Unknown district[^\n]*/i);
  return { isError: true, content: [{ type: 'text' as const, text: districtMatch ? `${districtMatch[0]}. Check the district name and retry with a known Sofia district.` : message }] };
}
