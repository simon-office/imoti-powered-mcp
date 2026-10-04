import { McpServer } from '@modelcontextprotocol/server';
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
    stage: z.literal('1'),
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
      const info = { name: 'imoti', version: VERSION, stage: '1' as const, dataDir };
      return {
        structuredContent: info,
        content: [{ type: 'text' as const, text: `imoti ${VERSION} (stage ${info.stage}); data directory: ${dataDir}` }],
      };
    },
  );

  if (deps.adapter && deps.storage) {
    const { adapter, storage } = deps;
    const searchOutput = z.object({
      query: z.object({ urls: z.array(z.string()), criteria: z.record(z.string(), z.unknown()) }),
      verification: z.object({ ok: z.boolean(), mismatches: z.array(z.record(z.string(), z.unknown())) }),
      listings: z.array(z.record(z.string(), z.unknown())), observedAt: z.string(), truncated: z.boolean(),
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
          const verification = verifyFilters(criteria, { appliedFilters: {
            deal: criteria.deal,
            city: criteria.city,
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
          if (listings.size >= limit) { truncated = true; break; }
        }
        const results = [...listings.values()].slice(0, limit);
        if (listings.size > limit) truncated = true;
        for (const listing of results) {
          storage.upsertListing(listing, observedAt);
          storage.recordObservation({ listingId: listing.id, observedAt, sourceUrl: sourceUrls.get(listing.id) ?? String(listing.url), raw: listing, normalized: listing });
        }
        const output = { query: { urls, criteria }, verification: { ok: mismatches.length === 0, mismatches }, listings: results, observedAt, truncated };
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
        const latest = observations.at(-1);
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
        storage.recordObservation({ listingId, observedAt, sourceUrl: canonicalUrl, raw: page.html, normalized: listing });
        return { structuredContent: { listing, observedAt, cached: false }, content: [{ type: 'text' as const, text: unavailable ? `Listing ${listingId} is no longer available.` : `${parsed.title ?? `Listing ${listingId}`} refreshed.` }] };
      } catch (error) { return toolError(error); }
    });
  }

  return server;
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
