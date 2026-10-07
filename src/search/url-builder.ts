import type { SearchCriteria } from './criteria.js';
import { resolveDistrict, resolvePropertyType, roomCountToPropertyType } from './slugs.js';

export type SearchPageForVerification = {
  appliedFilters?: { deal?: string | null; city?: string | null; district?: string | null; type?: string | null };
  listings: Array<{ dealType?: string | null; location?: { city?: string | null; district?: string | null }; propertyType?: { label?: string | null } | null; price?: { amount?: number | null } | null }>;
  coverage?: { districts?: string[]; propertyTypes?: string[] };
};
export type FilterMismatch = { filter: string; expected: unknown; observed: unknown };

export function buildSearchUrls(criteria: SearchCriteria): { urls: string[]; clientFilters: { areaMin?: number; areaMax?: number } } {
  const roomCount = criteria.rooms?.min !== undefined && criteria.rooms.min === criteria.rooms.max ? criteria.rooms.min : undefined;
  const types = criteria.propertyTypes.length ? criteria.propertyTypes : [roomCount === undefined ? undefined : roomCountToPropertyType(roomCount)];
  const districts = criteria.districts.length
    ? [...new Map(criteria.districts.map(name => resolveDistrict(name)).map(district => [district.slug, district])).values()]
    : [null];
  const urls: string[] = [];
  // Schedule every requested district/type pair on the starting page before
  // advancing any pair, so the bound cannot silently starve a category.
  const startPage = criteria.startPage ?? 1;
  for (let page = startPage; page < startPage + criteria.maxPages; page++) {
    for (const type of types) for (const district of districts) {
      const path = ['https://www.imot.bg/obiavi', criteria.deal === 'sale' ? 'prodazhbi' : 'naemi', 'grad-sofiya', district?.slug, type].filter(Boolean).join('/');
      const params = new URLSearchParams();
      if (criteria.priceMin !== undefined) params.set('price_min', String(Math.ceil(criteria.priceMin)));
      if (criteria.priceMax !== undefined) params.set('price_max', String(Math.floor(criteria.priceMax)));
      urls.push(`${path}${page > 1 ? `/p-${page}` : ''}${params.size ? `?${params}` : ''}`);
    }
  }
  return { urls, clientFilters: { areaMin: criteria.areaMin, areaMax: criteria.areaMax } };
}

export function verifyFilters(criteria: SearchCriteria, page: SearchPageForVerification): { ok: boolean; mismatches: FilterMismatch[] } {
  const mismatches: FilterMismatch[] = [];
  const applied = page.appliedFilters;
  const roomCount = criteria.rooms?.min !== undefined && criteria.rooms.min === criteria.rooms.max ? criteria.rooms.min : undefined;
  const expectedTypes: string[] = criteria.propertyTypes.length
    ? criteria.propertyTypes
    : roomCount === undefined ? [] : [roomCountToPropertyType(roomCount)].filter((type): type is string => Boolean(type));
  const check = (filter: string, expected: unknown, observed: unknown) => { if (expected !== undefined && !matches(filter, expected, observed)) mismatches.push({ filter, expected, observed: observed ?? null }); };
  const expectedDistricts = criteria.districts.map(name => resolveDistrict(name).slug);
  if (page.coverage && (expectedDistricts.some(slug => !page.coverage?.districts?.includes(slug)) || expectedTypes.some(slug => !page.coverage?.propertyTypes?.includes(slug)))) {
    mismatches.push({ filter: 'coverage', expected: { districts: expectedDistricts, propertyTypes: expectedTypes }, observed: page.coverage });
  }
  if (applied) {
    check('deal', criteria.deal, applied.deal);
    check('city', criteria.city, applied.city);
    if (criteria.districts.length) check('district', criteria.districts.map((name) => resolveDistrict(name).slug), applied.district ? resolveDistrict(applied.district).slug : null);
    if (expectedTypes.length) check('type', expectedTypes, applied.type);
  }
  page.listings.forEach((listing) => {
    if (listing.dealType) check('deal', criteria.deal, listing.dealType);
    if (listing.location?.city) check('city', criteria.city, listing.location.city);
    if (criteria.districts.length) check('district', criteria.districts.map((name) => resolveDistrict(name).slug), listing.location?.district ? resolveDistrict(listing.location.district).slug : null);
    if (expectedTypes.length) check('type', expectedTypes, listing.propertyType?.label);
    if (criteria.priceMax !== undefined) check('priceMax', criteria.priceMax, listing.price?.amount);
    if (criteria.priceMin !== undefined) check('priceMin', criteria.priceMin, listing.price?.amount);
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
  if (filter === 'priceMin') return typeof observed === 'number' && observed >= (expected as number);
  return expected === observed;
}
