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
          if (urls.length >= criteria.maxPages * Math.max(1, criteria.districts.length)) { truncated = true; break; }
          urls.push(url);
          const page = await adapter.fetchPage(url);
          const parsed = parseSearchResults(page.html, url);
          const verification = verifyFilters(criteria, { listings: parsed.listings.map(item => ({
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
            if (!listings.has(item.id)) {
              listings.set(item.id, { ...item, id: item.id, location: { ...item.location, precision: item.location.district ? 'neighbourhood' : 'unknown' }, status: 'available' });
              sourceUrls.set(item.id, url);
            }
          }
          if (parsed.nextPageUrl === null && urls.length >= 1) break;
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
        const listingId = id ?? url?.match(/obiava-([^-/]+)/i)?.[1];
        if (!listingId) return { isError: true, content: [{ type: 'text' as const, text: 'Provide a listing id or imot.bg listing URL.' }] };
        const canonicalUrl = url ?? `https://www.imot.bg/obiava-${listingId}`;
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

function toolError(error: unknown) {
  if (error instanceof ProtectiveScreenError) return { isError: true, content: [{ type: 'text' as const, text: error.message }] };
  const message = error instanceof Error ? error.message : 'Unexpected error';
  const districtMatch = message.match(/Unknown district[^\n]*/i);
  return { isError: true, content: [{ type: 'text' as const, text: districtMatch ? `${districtMatch[0]}. Check the district name and retry with a known Sofia district.` : message }] };
}
