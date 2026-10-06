import { McpServer } from '@modelcontextprotocol/server';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import * as z from 'zod/v4';
import { VERSION } from './version.js';
import type { SiteAdapter } from './adapter/types.js';
import { ProtectiveScreenError } from './adapter/types.js';
import type { Storage, Listing } from './storage/index.js';
import { configuredSearchLimit, DEFAULT_SEARCH_MAX_PAGES, DEFAULT_SEARCH_MAX_RESULTS, MAX_SEARCH_MAX_PAGES, MAX_SEARCH_MAX_RESULTS, MIN_SEARCH_MAX_RESULTS, searchCriteriaSchema } from './search/criteria.js';
import { buildSearchUrls, verifyFilters } from './search/url-builder.js';
import { parseSearchResults } from './parsers/search.js';
import { parseListing } from './parsers/listing.js';
import { districts, districtSuggestions, propertyTypeCatalog, resolveDistrict, resolvePropertyType, roomCountToPropertyType } from './search/slugs.js';
import type { SofiaDataAdapter } from './adapter/sofia-data.js';
import { resolveListingLocation, resolveMunicipalLocation, type MunicipalLocationDatasets } from './area/location.js';
import type { NormalizedStop, NormalizedSchedule, NormalizedMunicipalFeature, NormalizedWalkingRoute } from './area/types.js';
import { assessListingPhotos, configuredPhotoAssessmentOptions, type PhotoAssessmentOptions } from './photos/assessment.js';

declare const process: { env: Record<string, string | undefined> };

export interface ServerDependencies {
  dataDir?: string;
  adapter?: SiteAdapter;
  storage?: Storage;
  photoAssessment?: PhotoAssessmentOptions;
  /** Maximum time spent retrieving one photo page. Defaults to 10 seconds. */
  photoRetrievalTimeoutMs?: number;
  sofiaData?: SofiaDataAdapter;
  cleanupOnDisconnect?: boolean;
}

export function createServer(deps: ServerDependencies = {}): McpServer {
  const dataDir = deps.dataDir ?? process.env.IMOTI_DATA_DIR ?? `${homedir()}/.imoti-powered-mcp`;
  const defaultSearchPages = configuredSearchLimit('IMOTI_SEARCH_MAX_PAGES', DEFAULT_SEARCH_MAX_PAGES);
  const defaultSearchResults = configuredSearchLimit('IMOTI_SEARCH_MAX_RESULTS', DEFAULT_SEARCH_MAX_RESULTS);
  const searchToolCriteriaSchema = searchCriteriaSchema.extend({ maxPages: z.number().int().min(1).max(MAX_SEARCH_MAX_PAGES).default(defaultSearchPages) });
  const server = new McpServer({ name: 'imoti', version: VERSION });
  let cleanupPromise: Promise<void> | undefined;
  let storageClosed = false;
  if (deps.cleanupOnDisconnect) {
    server.server.onclose = () => {
      cleanupPromise ??= (async () => {
        try { await deps.adapter?.close(); }
        finally {
          if (deps.storage && !storageClosed) {
            storageClosed = true;
            deps.storage.close();
          }
        }
      })();
      return cleanupPromise;
    };
  }
  const outputSchema = {
    name: z.string(),
    version: z.string(),
    stage: z.literal('5'),
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
      const info = { name: 'imoti', version: VERSION, stage: '5' as const, dataDir };
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
    server.registerTool('compare_listings', {
      description: 'Compare 2–10 locally stored listings using observed asking prices and evidence. Asking-price positioning is only this supplied sample, not completed sales or market-wide valuation.',
      inputSchema: { listingIds: z.array(z.string().min(1)).min(2).max(10).refine(ids => new Set(ids).size === ids.length, 'listingIds must be unique') },
      outputSchema: z.object({
        listings: z.array(z.object({ id: z.string(), dealType: z.enum(['sale', 'rent', 'unknown']), pricePeriod: z.string().nullable(), vatTerms: z.string().nullable(), areaScope: z.string().nullable(), price: z.unknown().nullable(), areaM2: z.number().nullable(), pricePerSquareMeter: z.unknown().nullable(), photoAssessment: z.unknown().nullable(), location: z.unknown(), uncertainty: z.array(z.string()), observedAt: z.string().nullable(), explanations: z.record(z.string(), z.string()) })),
        duplicateEvidence: z.array(z.object({ listingIds: z.array(z.string()).length(2), kind: z.literal('possible_repost'), confidence: z.literal('suspected'), propertyMatch: z.literal('suspected'), evidence: z.string() })),
        askingPricePositioning: z.unknown(),
      }),
    }, async ({ listingIds }) => {
      try {
        const listings = listingIds.map(id => {
          const stored = storage.getListing(id);
          const explanations: Record<string, string> = {};
          const price = stored?.price && typeof stored.price === 'object' ? stored.price as { amount?: unknown; currency?: unknown } : null;
          const amount = typeof price?.amount === 'number' && Number.isFinite(price.amount) && price.amount >= 0 ? price.amount : null;
          const currency = typeof price?.currency === 'string' && price.currency.trim() ? price.currency : null;
          const area = typeof stored?.areaM2 === 'number' ? stored.areaM2 : typeof stored?.area === 'number' ? stored.area : null;
          const validArea = area !== null && Number.isFinite(area) && area > 0;
          const perM2 = amount !== null && currency && validArea ? { amount: amount / area!, currency } : null;
          const dealType = stored?.dealType === 'sale' || stored?.dealType === 'rent' ? stored.dealType : 'unknown';
          const vatTerms = typeof stored?.vatNote === 'string' ? stored.vatNote : typeof (stored?.facts as any)?.vat?.value === 'string' ? (stored?.facts as any).vat.value : null;
          const areaScope = typeof stored?.areaScope === 'string' ? stored.areaScope : null;
          if (areaScope && !/whole|total|цял/i.test(areaScope)) explanations.pricePerSquareMeter = 'Area may cover only part of the property; €/m² is not a whole-property comparison.';
          if (!stored) for (const field of ['price', 'areaM2', 'pricePerSquareMeter', 'photoAssessment', 'location']) explanations[field] = 'Listing is not present in local storage.';
          else {
            if (amount === null || !currency) explanations.price = 'A valid asking price and currency were not observed.';
            if (!validArea) explanations.areaM2 = 'A valid area in square metres was not observed.';
            if (!perM2) explanations.pricePerSquareMeter = 'Requires a valid asking price, currency, and area in square metres.';
            if (stored.photoAssessment === undefined && stored.photo_assessment === undefined) explanations.photoAssessment = 'No photo assessment is stored.';
            if (!stored.location) explanations.location = 'No location evidence is stored.';
          }
          const location = stored ? resolveListingLocation(stored) : { city: null, district: null, street: null, precision: 'unknown', source: 'unavailable', uncertainty: ['Listing is not present in local storage.'] };
          const photoAssessment = stored?.photoAssessment ?? stored?.photo_assessment ?? null;
          const uncertainty = [...location.uncertainty];
          if (!photoAssessment) uncertainty.push('Photo assessment is unavailable; no photo condition conclusions can be drawn.');
          if (amount === null || !currency) uncertainty.push('Asking price or currency is unavailable.');
          if (!validArea) uncertainty.push('Area in square metres is unavailable.');
          if (areaScope && !/whole|total|цял/i.test(areaScope)) uncertainty.push('Area may cover only part of the property; €/m² is not a whole-property comparison.');
          return { id, dealType, pricePeriod: dealType === 'rent' ? 'per month' : dealType === 'sale' ? 'asking price' : null, vatTerms, areaScope, price: amount === null || !currency ? null : { amount, currency }, areaM2: validArea ? area : null, pricePerSquareMeter: perM2, photoAssessment, location, uncertainty, observedAt: stored?.lastObservedAt ?? null, explanations };
        });
        const knownDeals = new Set(listings.map(item => item.dealType));
        const mixedDeals = knownDeals.has('sale') && knownDeals.has('rent');
        const byProperty = new Map<string, typeof listings>();
        for (const item of listings) {
          const key = storage.getListing(item.id)?.propertyKey;
          if (typeof key === 'string' && key.trim()) byProperty.set(key, [...(byProperty.get(key) ?? []), item]);
        }
        const duplicateEvidence = [...byProperty.entries()].flatMap(([key, matches]) => matches.length > 1 && new Set(matches.map(item => item.dealType)).size > 1
          ? [{ listingIds: matches.map(item => item.id).slice(0, 2) as [string, string], kind: 'possible_repost' as const, confidence: 'suspected' as const, propertyMatch: 'suspected' as const, evidence: `Listings share fabricated/property key ${key} and differ by category; this is a suspected physical-property match, not confirmation.` }]
          : []);
        const amounts = listings.flatMap(item => !mixedDeals && item.price ? [item.price as {amount:number;currency:string}] : []);
        const currency = amounts.length && amounts.every(item => item.currency === amounts[0].currency) ? amounts[0].currency : null;
        const dates = listings.flatMap(item => item.price && item.observedAt ? [item.observedAt] : []).sort();
        let positioning: unknown = { basis: mixedDeals ? 'sale and rent prices are not combined; compare each listing in its labelled deal category' : 'observed asking prices only; not completed sales or a market-wide valuation; period covers supplied observations with available timestamps', sampleSize: amounts.length, currency, period: dates.length ? { from: dates[0], to: dates.at(-1) } : null, minimum: null, median: null, maximum: null };
        if (currency && amounts.length) {
          const sorted = amounts.map(item => item.amount).sort((a,b) => a-b);
          const middle = Math.floor(sorted.length / 2);
          positioning = { basis: 'observed asking prices only; not completed sales or a market-wide valuation; period covers supplied observations with available timestamps', sampleSize: amounts.length, currency, period: dates.length ? { from: dates[0], to: dates.at(-1) } : null, minimum: sorted[0], median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, maximum: sorted.at(-1) };
        }
        return { structuredContent: { listings, duplicateEvidence, askingPricePositioning: positioning }, content: [{ type: 'text' as const, text: `Compared ${listings.length} stored listings. Asking-price positioning covers ${amounts.length} valid supplied price observation(s); aggregate statistics are available only for one currency. The period covers supplied observations with available timestamps; these are not completed sales or market-wide valuation.` }] };
      } catch (error) { return toolError(error); }
    });
  }

  if (deps.storage) {
    const { storage } = deps;
    const areaData = deps.sofiaData;
    server.registerTool('area_context', {
      description: 'Return Sofia transit and municipal context for a stored property listing, with location precision and source provenance.',
      inputSchema: { listingId: z.string().min(1), radiusMeters: z.number().positive().max(50000).default(1000), destination: z.object({ name: z.string().min(1).max(120), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).optional() },
      outputSchema: z.object({ listingId: z.string(), location: z.record(z.string(), z.unknown()), nearbyStops: z.unknown(), schedules: z.unknown(), municipalFeatures: z.unknown(), sourceMetadata: z.record(z.string(), z.array(z.unknown())), uncertainty: z.array(z.string()) }),
    }, async ({ listingId, radiusMeters, destination }) => {
      try {
        const listing = storage.getListing(listingId);
        if (!listing) return { isError: true, content: [{ type: 'text' as const, text: `Listing ${listingId} was not found in local storage.` }] };
        const methods = areaData ? [areaData.getStops(), areaData.getSchedules(), areaData.getMunicipalFeatures(), areaData.getWalkingRoutes(), areaData.getMunicipalLocations()] : [];
        const settled = await Promise.allSettled(methods);
        const values = settled.map(item => item.status === 'fulfilled' ? item.value : undefined);
        const reason = (index: number, fallback: string) => settled[index]?.status === 'rejected' ? errorMessage((settled[index] as PromiseRejectedResult).reason) : fallback;
        const stops = (values[0] ?? []) as NormalizedStop[];
        const schedules = (values[1] ?? []) as NormalizedSchedule[];
        const features = (values[2] ?? []) as NormalizedMunicipalFeature[];
        const routes = (values[3] ?? []) as NormalizedWalkingRoute[];
        const municipalLocations = (values[4] ?? { addresses: [], districts: [] }) as MunicipalLocationDatasets;
        const location = resolveMunicipalLocation(listing, municipalLocations);
        const uncertainty = [...location.uncertainty];
        const staleDatasets = [
          ...uniqueProvenance(stops.map(item => item.provenance)),
          ...uniqueProvenance(municipalLocations.addresses.map(item => item.provenance)),
          ...uniqueProvenance(municipalLocations.districts.map(item => item.provenance))
        ].filter((item): item is typeof item & { stale: NonNullable<typeof item.stale> } => !!item.stale);
        for (const source of staleDatasets) uncertainty.push(`${source.name} dataset is stale: checked ${source.checkedAt}; ${source.stale.reason === 'feed-end-date' ? 'its feed end date has passed' : 'it is over the cache age limit'}; refresh failed: ${source.stale.refreshError}.`);
        for (let index = 0; index < settled.length; index++) if (settled[index]?.status === 'rejected') uncertainty.push(`${['Stops', 'Schedules', 'Municipal features', 'Walking routes', 'Municipal locations'][index]} data is unavailable: ${reason(index, '')}`);
        const findRoute = (destination: string) => routes.find(route => route.origin === listingId && route.destination === destination);
        const routedStops = location.coordinates && settled[3]?.status !== 'rejected' ? stops.flatMap((stop: NormalizedStop) => {
          const route = findRoute(stop.id);
          return route && route.distanceMeters <= radiusMeters ? [{ ...stop, distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds, routingProvenance: route.provenance }] : [];
        }) : [];
        const routedFeatures = location.coordinates && settled[3]?.status !== 'rejected' ? features.flatMap((feature: NormalizedMunicipalFeature) => {
          const route = findRoute(feature.id);
          return route && route.distanceMeters <= radiusMeters ? [{ ...feature, distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds, routingProvenance: route.provenance }] : [];
        }) : [];
        const stopsAvailable = location.coordinates !== undefined && settled[0]?.status !== 'rejected' && settled[3]?.status !== 'rejected' && routes.some(route => route.origin === listingId && stops.some(stop => stop.id === route.destination));
        const featuresAvailable = location.coordinates !== undefined && settled[2]?.status !== 'rejected' && settled[3]?.status !== 'rejected' && routes.some(route => route.origin === listingId && features.some(feature => feature.id === route.destination));
        const straightStops = location.coordinates && !stopsAvailable && settled[0]?.status !== 'rejected' ? stops.flatMap(stop => {
          const distanceMeters = haversineMeters(location.coordinates!, stop.latitude, stop.longitude);
          return distanceMeters <= radiusMeters ? [{ ...stop, distanceMeters, distanceType: 'straight-line' as const }] : [];
        }).sort((a, b) => a.distanceMeters - b.distanceMeters) : [];
        const groupedStops = (stopsAvailable ? routedStops : straightStops).reduce((groups: Map<string, any>, stop: any) => {
          const key = `${stop.name.normalize('NFKC').trim().toLocaleLowerCase()}|${stop.latitude}|${stop.longitude}`;
          const prior = groups.get(key);
          const { provenance: _provenance, routingProvenance: _routingProvenance, ...conciseStop } = stop;
          if (prior) { if (prior.sourceIds.length < 5) prior.sourceIds.push(stop.id); } else groups.set(key, { ...conciseStop, sourceIds: [stop.id] });
          return groups;
        }, new Map());
        const sortedStops = [...groupedStops.values()].sort((a, b) => a.distanceMeters - b.distanceMeters);
        const nearestStraightLineDistanceMeters = sortedStops.reduce((nearest, stop) => Math.min(nearest, haversineMeters(location.coordinates!, stop.latitude, stop.longitude)), Infinity);
        const nearbyStops = settled[0]?.status === 'rejected' ? { status: 'unavailable', reason: reason(0, 'Stops unavailable.'), uncertainty: true, totalWithinRadius: 0, items: [] }
          : sortedStops.length ? { status: 'available', distanceType: stopsAvailable ? 'pedestrian-route' : 'straight-line', totalWithinRadius: sortedStops.length, nearestDistanceMeters: sortedStops[0].distanceMeters, nearestStraightLineDistanceMeters, items: sortedStops.slice(0, 10) }
          : { status: 'unavailable', reason: location.coordinates ? 'No stop coordinates are available within the radius for this location.' : 'The listing location has no coordinates, so nearby stops cannot be determined.', uncertainty: true, totalWithinRadius: 0, items: [] };
        const municipalFeatures = settled[2]?.status === 'rejected' || settled[3]?.status === 'rejected' || !featuresAvailable ? { status: 'unavailable', reason: settled[2]?.status === 'rejected' ? reason(2, '') : settled[3]?.status === 'rejected' ? reason(3, '') : 'No property-specific routed municipal feature distances are available for this location.', uncertainty: true, items: [] } : { status: 'available', items: routedFeatures.slice(0, 10).map(({ provenance: _provenance, routingProvenance: _routingProvenance, ...item }) => item) };
        const stopIds = stopsAvailable ? new Set(routedStops.map(stop => stop.id)) : new Set<string>();
        const relevantSchedules = schedules.filter((schedule: NormalizedSchedule) => stopIds.has(schedule.stopId)).slice(0, 10);
        if (!stopsAvailable && !straightStops.length) uncertainty.push('Nearby stops and schedules are unavailable because location coordinates or stops are not established.');
        else if (!stopsAvailable) uncertainty.push('Nearby stop distances are straight-line estimates and do not represent walking routes.');
        const schedulesAvailable = settled[1]?.status !== 'rejected' && stopsAvailable;
        const datasets = [stops, schedules, features, routes].map((rows, i) => settled[i]?.status === 'rejected' ? [] : uniqueProvenance(rows.map(item => item.provenance)).slice(0, 10));
        const destinationDistances = destination && location.coordinates ? [{ name: destination.name, distanceMeters: haversineMeters(location.coordinates, destination.latitude, destination.longitude), distanceType: 'straight-line' as const, source: 'host-supplied coordinates' }] : [];
        const nearestMetro = location.coordinates ? stops.filter(stop => stop.mode === 'metro').map(stop => ({ id: stop.id, name: stop.name, distanceMeters: haversineMeters(location.coordinates!, stop.latitude, stop.longitude), distanceType: 'straight-line' as const, provenance: stop.provenance })).sort((a, b) => a.distanceMeters - b.distanceMeters)[0] : undefined;
        if (destination && !location.coordinates) uncertainty.push(`Distance to ${destination.name} is unavailable because the listing location has no coordinates.`);
        const result = { listingId, location, nearbyStops, nearestMetro: nearestMetro ? { ...nearestMetro, provenance: { name: nearestMetro.provenance.name, sourceUrl: nearestMetro.provenance.sourceUrl, datasetDate: nearestMetro.provenance.datasetDate, checkedAt: nearestMetro.provenance.checkedAt } } : null, schedules: schedulesAvailable ? { status: 'available', items: relevantSchedules } : { status: 'unavailable', reason: settled[1]?.status === 'rejected' ? reason(1, '') : 'Schedules unavailable because nearby stops cannot be established.', uncertainty: true, items: [] }, municipalFeatures, destinationDistances, sourceMetadata: { stops: datasets[0], schedules: datasets[1], municipalFeatures: datasets[2], routing: datasets[3], municipalLocations: uniqueProvenance([...municipalLocations.addresses.map(item => item.provenance), ...municipalLocations.districts.map(item => item.provenance)]).slice(0, 10) }, uncertainty };
        const staleExplanation = staleDatasets.map(source => `${source.name} dataset checked ${source.checkedAt} is stale (${source.stale.reason === 'feed-end-date' ? 'feed end date passed' : 'over age'}); refresh error: ${source.stale.refreshError}`).join('. ');
        const distanceSummary = [nearestMetro ? `nearest metro station ${nearestMetro.name}, straight-line distance ${Math.round(nearestMetro.distanceMeters)} m` : null, ...destinationDistances.map(item => `${item.name}, straight-line distance ${Math.round(item.distanceMeters)} m`)].filter(Boolean).join('; ');
        return { structuredContent: result, content: [{ type: 'text' as const, text: `Area context for ${listingId}: location precision ${location.precision}; ${nearbyStops.status === 'available' ? `${nearbyStops.totalWithinRadius} nearby stops, nearest ${nearbyStops.distanceType === 'pedestrian-route' ? 'pedestrian-route' : 'straight-line'} distance ${Math.round(nearbyStops.nearestDistanceMeters)} m${nearbyStops.distanceType === 'pedestrian-route' ? `, nearest straight-line distance ${Math.round(nearbyStops.nearestStraightLineDistanceMeters)} m` : ''}` : 'nearby stops unavailable'}${distanceSummary ? `; ${distanceSummary}` : ''}; ${schedulesAvailable ? 'schedules available' : 'schedules unavailable'}; ${municipalFeatures.status === 'available' ? 'municipal features available' : 'municipal features unavailable'}.${staleExplanation ? ` Stale data: ${staleExplanation}.` : ''}` }] };
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
        const pageReferences = references.slice(offset, offset + 3);
        const controller = new AbortController();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const timeoutMs = deps.photoRetrievalTimeoutMs ?? 10_000;
        const retrievedPage = await Promise.race([
          adapter.getListingPhotos(listingId, pageReferences, { signal: controller.signal }),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              const error = new Error(`Photo retrieval exceeded its ${timeoutMs}ms deadline.`);
              controller.abort(error);
              reject(error);
            }, timeoutMs);
          }),
        ]).finally(() => { if (timeout) clearTimeout(timeout); });
        // Keep retained image payloads (including data later encoded for host assessment)
        // bounded independently of the three-reference page-size limit.
        const photoByteBudget = 32 * 1024;
        let acceptedPhotoBytes = 0;
        const page = retrievedPage.map(photo => {
          const size = photo.bytes?.byteLength ?? 0;
          if (size > photoByteBudget - acceptedPhotoBytes) {
            return { listingId: photo.listingId, reference: photo.reference, mediaType: photo.mediaType, unavailableReason: `Photo omitted because the per-call ${photoByteBudget}-byte budget would be exceeded.` };
          }
          acceptedPhotoBytes += size;
          return photo;
        });
        const photos = page.map(({ listingId: photoListingId, reference, mediaType, unavailableReason }) => ({ listingId: photoListingId, reference, mediaType, ...(unavailableReason ? { unavailableReason } : {}) }));
        const uncertainty = photos.flatMap(photo => photo.unavailableReason ? [`Photo ${photo.reference}: ${photo.unavailableReason}`] : []);
        const result = await assessListingPhotos(page, deps.photoAssessment ?? configuredPhotoAssessmentOptions(process.env));
        const assessment = { ...result.deterministic, findings: result.findings, provider: result.provider };
        const nextOffset = offset + pageReferences.length < references.length ? offset + pageReferences.length : null;
        const attachedThumbnails = result.uncertainty.filter(text => text.includes('attached to host assessment as a 280px low-resolution thumbnail'));
        const hostMessage = result.provider === 'host' ? (result.contentBlocks.length ? `Assess the attached image content${attachedThumbnails.length ? `; 280px low-resolution photos: ${attachedThumbnails.map(text => text.slice(6, text.indexOf(' attached to host assessment'))).join(', ')}` : ''}; coverage may be incomplete.` : 'No image content was attached for host assessment; photo coverage is incomplete.') : `Assessment provider: ${result.provider}.`;
        return { structuredContent: { listingId, photos, assessment, nextOffset, uncertainty: [...uncertainty, ...result.uncertainty] }, content: [{ type: 'text' as const, text: `Retrieved photos ${offset + 1}–${offset + page.length} of ${references.length} for listing ${listingId}; ${uncertainty.length} unavailable.${nextOffset === null ? '' : ` Continue with offset ${nextOffset}.`} ${hostMessage}` }, ...result.contentBlocks] };
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
      pagesFetched: z.number(), pages: z.array(z.object({ pageUrl: z.string(), pageNumber: z.number(), totalCount: z.number().nullable(), nextPageUrl: z.string().nullable() })), coverage: z.object({ districts: z.array(z.string()), propertyTypes: z.array(z.string()) }), excludedPromoted: z.array(z.object({ listing: z.record(z.string(), z.unknown()), pageUrl: z.string() })), omittedByTypeFilter: z.number(),
    });
    server.registerTool('get_search_districts', {
      description: 'List supported Sofia search districts with Bulgarian and Latin names and URL slugs.',
      inputSchema: {},
      outputSchema: z.object({ districts: z.array(z.object({ slug: z.string(), bg: z.string(), latin: z.string(), aliases: z.array(z.string()).optional() })) }),
    }, async () => {
      const catalog = districts.map(({ slug, bg, latin, aliases }) => ({ slug, bg, latin, ...(aliases ? { aliases: [...aliases] } : {}) }));
      return { structuredContent: { districts: catalog }, content: [{ type: 'text' as const, text: catalog.map(item => `${item.bg} / ${item.latin} (${item.slug})`).join('\n') }] };
    });
    server.registerTool('search_listings', {
      description: 'Search verified property listings in Sofia. Returns matching listings and filter verification.',
      inputSchema: { criteria: searchToolCriteriaSchema.extend({ districts: z.array(z.string().describe(`Supported district names: ${districts.map(item => `${item.bg} / ${item.latin}`).join('; ')}`)).default([]) }), limit: z.number().int().min(MIN_SEARCH_MAX_RESULTS).max(MAX_SEARCH_MAX_RESULTS).default(defaultSearchResults) },
      outputSchema: searchOutput,
    }, async ({ criteria: requestedCriteria, limit }) => {
      try {
        const invalidDistricts: string[] = [];
        const criteria = { ...requestedCriteria, districts: requestedCriteria.districts.filter(name => {
          try { resolveDistrict(name); return true; } catch { invalidDistricts.push(name); return false; }
        }) };
        if (invalidDistricts.length && criteria.districts.length === 0) return { isError: true, content: [{ type: 'text' as const, text: invalidDistricts.map(name => `${name}: ${districtSuggestions(name).map(item => `${item.latin} (${item.bg})`).join(', ')}`).join('\n') }] };
        const built = buildSearchUrls(criteria);
        const urls: string[] = [];
        const listings = new Map<string, Listing>();
        const excludedPromoted: Array<{ listing: Listing; pageUrl: string }> = [];
        let omittedByTypeFilter = 0;
        const coveredDistricts = new Set<string>();
        const coveredTypes = new Set<string>();
        const sourceUrls = new Map<string, string>();
        const mismatches: Array<Record<string, unknown>> = [];
        for (const district of invalidDistricts) mismatches.push({ filter: 'district', expected: district, observed: 'invalid district; omitted from search', suggestions: districtSuggestions(district).map(item => ({ bg: item.bg, latin: item.latin, slug: item.slug })) });
        let truncated = false;
        let pagesFetched = 0;
        const pages: Array<{ pageUrl: string; pageNumber: number; totalCount: number | null; nextPageUrl: string | null }> = [];
        const observedAt = new Date().toISOString();
        for (const url of built.urls) {
          urls.push(url);
          const page = await adapter.fetchPage(url);
          const parsed = parseSearchResults(page.html, url);
          pagesFetched++;
          pages.push({ pageUrl: url, pageNumber: parsed.pageNumber, totalCount: parsed.totalCount, nextPageUrl: parsed.nextPageUrl });
          // SearchPage exposes listing evidence, so use this page's URL for query-level filters.
          const path = new URL(page.url).pathname.split('/').filter(Boolean);
          const verification = verifyFilters(criteria, { appliedFilters: {
            deal: criteria.deal,
            city: criteria.city,
            district: criteria.districts.length ? path[3] : undefined,
            type: path[criteria.districts.length ? 4 : 3],
          }, listings: parsed.listings.filter(item => !item.promotedTier || verifyFilters(criteria, { listings: [{ dealType: item.dealType, location: { city: item.location.city, district: item.location.district }, propertyType: item.propertyType, price: item.price }] }).ok).map(item => ({
            dealType: item.dealType, location: { city: item.location.city, district: item.location.district }, propertyType: item.propertyType,
            price: item.price,
          })) });
          // The site's page filters are the authority for each scheduled
          // combination; card-level mismatches below are checked only on
          // listings that are actually returned (paid off-filter cards are
          // reported separately).
          mismatches.push(...verification.mismatches.filter(item => item.filter !== 'district' && item.filter !== 'type'));
          const pathParts = new URL(url).pathname.split('/').filter(Boolean);
          if (criteria.districts.length) coveredDistricts.add(pathParts[3]);
          if (criteria.propertyTypes.length || criteria.rooms?.min !== undefined && criteria.rooms.min === criteria.rooms.max) coveredTypes.add(pathParts[criteria.districts.length ? 4 : 3]);
          for (const item of parsed.listings) {
            if (!item.id || !item.url) continue;
            const itemCheck = verifyFilters(criteria, { listings: [{ dealType: item.dealType, location: { city: item.location.city, district: item.location.district }, propertyType: item.propertyType, price: item.price }] });
            const nonTypeCheck = verifyFilters({ ...criteria, propertyTypes: [], rooms: undefined }, { listings: [{ dealType: item.dealType, location: { city: item.location.city, district: item.location.district }, propertyType: item.propertyType, price: item.price }] });
            if (item.promotedTier && !nonTypeCheck.ok) { excludedPromoted.push({ listing: { ...item, id: item.id, location: { ...item.location, precision: item.location.district ? 'neighbourhood' : 'unknown' }, status: 'available' }, pageUrl: url }); continue; }
            if (criteria.districts.length && (!item.location.district || !criteria.districts.some(name => resolveDistrict(name).slug === resolveDistrict(item.location.district!).slug))) continue;
            if (criteria.priceMin !== undefined && (item.price?.amount === undefined || item.price.amount < criteria.priceMin)) continue;
            if (criteria.priceMax !== undefined && (item.price?.amount === undefined || item.price.amount > criteria.priceMax)) continue;
            if (criteria.areaMin !== undefined && (item.areaM2 === null || item.areaM2 < criteria.areaMin)) continue;
            if (criteria.areaMax !== undefined && (item.areaM2 === null || item.areaM2 > criteria.areaMax)) continue;
            if (criteria.rooms && (item.propertyType?.rooms === null || item.propertyType?.rooms === undefined || (criteria.rooms.min !== undefined && item.propertyType.rooms < criteria.rooms.min) || (criteria.rooms.max !== undefined && item.propertyType.rooms > criteria.rooms.max))) continue;
            if (criteria.propertyTypes.length && !criteria.propertyTypes.some(type => catalogTypeMatches(type, item.propertyType?.slug, item.propertyType?.label))) { omittedByTypeFilter++; continue; }
            if (!listings.has(item.id)) {
              listings.set(item.id, { ...item, id: item.id, location: { ...item.location, precision: item.location.district ? 'neighbourhood' : 'unknown' }, status: 'available' });
              sourceUrls.set(item.id, url);
            }
          }
          if (listings.size >= limit) truncated = true;
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
        const coverage = { districts: [...coveredDistricts], propertyTypes: [...coveredTypes] };
        const exactRoomType = criteria.rooms?.min !== undefined && criteria.rooms.min === criteria.rooms.max ? roomCountToPropertyType(criteria.rooms.min) : undefined;
        const expectedTypes = criteria.propertyTypes.length ? criteria.propertyTypes : exactRoomType ? [exactRoomType] : [];
        if (criteria.districts.some(name => !coveredDistricts.has(resolveDistrict(name).slug)) || expectedTypes.some(type => !coveredTypes.has(type))) mismatches.push({ filter: 'coverage', expected: { districts: criteria.districts.map(name => resolveDistrict(name).slug), propertyTypes: expectedTypes }, observed: coverage });
        const output = { query: { urls, criteria }, verification: { ok: mismatches.length === 0, mismatches }, listings: results, observedAt, truncated, districtCounts, pagesFetched, pages, coverage, excludedPromoted, omittedByTypeFilter };
        return { structuredContent: output, content: [{ type: 'text' as const, text: `Found ${results.length} listing${results.length === 1 ? '' : 's'}; filters ${output.verification.ok ? 'verified' : 'need review'}.${invalidDistricts.length ? ` Invalid districts omitted individually: ${invalidDistricts.join(', ')}.` : ''}` }] };
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
        const latestCard = observations.filter(observation => !isDetailObservation(observation.sourceUrl)).at(-1)?.normalized as Listing | undefined;
        if (!refresh && latest && Date.now() - Date.parse(latest.observedAt) < 6 * 60 * 60 * 1000) {
          const cached = latest.normalized as Listing;
          return { structuredContent: { listing: cached, evidenceReconciliation: reconcileCardDetail(latestCard, cached), observedAt: latest.observedAt, cached: true }, content: [{ type: 'text' as const, text: `${cached.title ?? `Listing ${listingId}`} (cached observation).` }] };
        }
        const page = await adapter.fetchPage(canonicalUrl);
        const parsed = parseListing(page.html, canonicalUrl);
        const observedAt = page.fetchedAt.toISOString();
        const unavailable = 'status' in parsed;
        const listing: Listing = unavailable ? { id: listingId, status: 'not_available' } : { ...parsed, id: listingId, status: 'available' };
        storage.upsertListing(listing, observedAt);
        storage.recordObservation({ listingId, observedAt, sourceUrl: canonicalUrl, raw: listing, normalized: listing });
        return { structuredContent: { listing, evidenceReconciliation: unavailable ? { authority: 'detail', discrepancies: [] } : reconcileCardDetail(latestCard, listing), observedAt, cached: false }, content: [{ type: 'text' as const, text: unavailable ? `Listing ${listingId} is no longer available.` : `${parsed.title ?? `Listing ${listingId}`} refreshed.` }] };
      } catch (error) { return toolError(error); }
    });
  }

  return server;
}

function reconcileCardDetail(card: Listing | undefined, detail: Listing): { authority: 'detail'; discrepancies: Array<{ field: string; card: unknown; detail: unknown }> } {
  const fields = ['price', 'priceLowered', 'seller', 'location'] as const;
  const discrepancies = card ? fields.flatMap(field => {
    const cardValue = card[field];
    const detailValue = detail[field];
    if (cardValue === undefined || detailValue === undefined || JSON.stringify(cardValue) === JSON.stringify(detailValue)) return [];
    return [{ field, card: cardValue, detail: detailValue }];
  }) : [];
  return { authority: 'detail', discrepancies };
}

function haversineMeters(origin: { latitude: number; longitude: number }, latitude: number, longitude: number): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(latitude - origin.latitude), dLon = radians(longitude - origin.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(origin.latitude)) * Math.cos(radians(latitude)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function uniqueProvenance(items: Array<{ name: string; sourceUrl: string; datasetDate: string; checkedAt: string; reuseTerms: string; stale?: { reason: 'over-age' | 'feed-end-date'; refreshError: string } }>) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function catalogTypeMatches(requested: string, slug?: string | null, label?: string | null): boolean {
  try {
    const expected = resolvePropertyType(requested).slug;
    return [slug, label].some(value => {
      if (!value) return false;
      try { return resolvePropertyType(value).slug === expected; }
      catch { return propertyTypeCatalog.find(type => type.slug === expected)?.cardLabel.toLocaleLowerCase() === value.toLocaleLowerCase(); }
    });
  } catch { return false; }
}

function toolError(error: unknown) {
  if (error instanceof ProtectiveScreenError) return { isError: true, content: [{ type: 'text' as const, text: error.message }] };
  const message = error instanceof Error ? error.message : 'Unexpected error';
  const districtMatch = message.match(/Unknown district[^\n]*/i);
  return { isError: true, content: [{ type: 'text' as const, text: districtMatch ? `${districtMatch[0]}. Check the district name and retry with a known Sofia district.` : message }] };
}
