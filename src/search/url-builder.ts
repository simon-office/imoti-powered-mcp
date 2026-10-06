import type { SearchCriteria } from './criteria.js';
import { resolveDistrict, resolvePropertyType, roomCountToPropertyType } from './slugs.js';

export type SearchPageForVerification = {
  appliedFilters?: { deal?: string | null; city?: string | null; district?: string | null; type?: string | null };
  listings: Array<{ dealType?: string | null; location?: { city?: string | null; district?: string | null }; propertyType?: { label?: string | null } | null; price?: { amount?: number | null } | null }>;
};
export type FilterMismatch = { filter: string; expected: unknown; observed: unknown };

export function buildSearchUrls(criteria: SearchCriteria): { urls: string[]; clientFilters: { priceMin?: number; areaMin?: number; areaMax?: number } } {
  const roomCount = criteria.rooms?.min !== undefined && criteria.rooms.min === criteria.rooms.max ? criteria.rooms.min : undefined;
  const types = criteria.propertyTypes.length ? criteria.propertyTypes : [roomCount === undefined ? undefined : roomCountToPropertyType(roomCount)];
  const districts = criteria.districts.length ? criteria.districts.map(resolveDistrict) : [null];
  const urls: string[] = [];
  for (const district of districts) {
    const pages = Array.from({ length: criteria.maxPages }, (_, index) => index + 1)
      .flatMap(page => types.map(type => ({ type, page })))
      .slice(0, criteria.maxPages);
    for (const { type, page } of pages) {
      const path = ['https://www.imot.bg/obiavi', criteria.deal === 'sale' ? 'prodazhbi' : 'naemi', 'grad-sofiya', district?.slug, type].filter(Boolean).join('/');
      urls.push(`${path}${page > 1 ? `/p-${page}` : ''}${criteria.priceMax === undefined ? '' : `?price_max=${encodeURIComponent(String(criteria.priceMax))}`}`);
    }
  }
  return { urls, clientFilters: { priceMin: criteria.priceMin, areaMin: criteria.areaMin, areaMax: criteria.areaMax } };
}

export function verifyFilters(criteria: SearchCriteria, page: SearchPageForVerification): { ok: boolean; mismatches: FilterMismatch[] } {
  const mismatches: FilterMismatch[] = [];
  const applied = page.appliedFilters ?? {};
  const roomCount = criteria.rooms?.min !== undefined && criteria.rooms.min === criteria.rooms.max ? criteria.rooms.min : undefined;
  const expectedTypes = criteria.propertyTypes.length
    ? criteria.propertyTypes
    : roomCount === undefined ? [] : [roomCountToPropertyType(roomCount)];
  const check = (filter: string, expected: unknown, observed: unknown) => { if (expected !== undefined && !matches(filter, expected, observed)) mismatches.push({ filter, expected, observed: observed ?? null }); };
  check('deal', criteria.deal, applied.deal);
  check('city', criteria.city, applied.city);
  if (criteria.districts.length) check('district', criteria.districts.map((name) => resolveDistrict(name).slug), applied.district ? resolveDistrict(applied.district).slug : null);
  if (expectedTypes.length) check('type', expectedTypes, applied.type);
  page.listings.forEach((listing) => {
    if (listing.dealType) check('deal', criteria.deal, listing.dealType);
    if (listing.location?.city) check('city', criteria.city, listing.location.city);
    if (criteria.districts.length) check('district', criteria.districts.map((name) => resolveDistrict(name).slug), listing.location?.district ? resolveDistrict(listing.location.district).slug : null);
    if (expectedTypes.length) check('type', expectedTypes, listing.propertyType?.label);
    if (criteria.priceMax !== undefined) check('priceMax', criteria.priceMax, listing.price?.amount);
  });
  return { ok: mismatches.length === 0, mismatches };
}

function matches(filter: string, expected: unknown, observed: unknown): boolean {
  if (filter === 'deal') {
    const actual = String(observed ?? '').toLowerCase();
    return expected === 'sale' ? actual === 'sale' || actual.includes('продав') : actual === 'rent' || actual.includes('наем');
  }
  if (filter === 'city') return /sofia|софия/i.test(String(observed ?? ''));
  if (filter === 'district') return observed != null && (expected as string[]).includes(resolveDistrict(String(observed)).slug);
  if (filter === 'type') {
    try { return (expected as string[]).some(type => resolvePropertyType(String(observed ?? '')).slug === type); }
    catch { return false; }
  }
  if (filter === 'priceMax') return typeof observed === 'number' && observed <= (expected as number);
  return expected === observed;
}
