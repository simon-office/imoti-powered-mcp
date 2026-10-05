import type { Listing } from '../storage/index.js';

export type ResolvedLocation = {
  city: string | null;
  district: string | null;
  street: string | null;
  coordinates?: { latitude: number; longitude: number };
  precision: 'exact' | 'street' | 'neighbourhood' | 'unknown';
  source: string;
  uncertainty: string[];
  provenance?: { name: string; sourceUrl: string; datasetDate: string; checkedAt: string; reuseTerms: string };
};

export interface MunicipalLocationDatasets {
  addresses: Array<{ settlement: string; street: string; region: string; latitude: number; longitude: number; provenance: NonNullable<ResolvedLocation['provenance']> }>;
  districts: Array<{ name: string; latitude: number; longitude: number; provenance: NonNullable<ResolvedLocation['provenance']> }>;
}

/** Resolve only public property location fields; seller/agency metadata is deliberately ignored. */
export function resolveMunicipalLocation(listing: Listing, datasets: MunicipalLocationDatasets): ResolvedLocation {
  const base = resolveListingLocation(listing);
  if (!datasets.addresses.length && !datasets.districts.length) return base;
  if (base.precision === 'exact' && base.coordinates) return base;
  if (base.city && !/^(sofia|град софия|гр\. софия)$/i.test(base.city)) return base;
  if (base.street && /^(?:ул\.?|бул\.?|пл\.?)(?:\s|$)/i.test(base.street)) {
    const street = normalize(base.street);
    const matches = datasets.addresses.filter(row => normalize(row.settlement) === normalize('гр. София') && normalize(row.street) === street);
    if (matches.length) {
      const regions = new Set(matches.map(row => row.region));
      return { ...base, coordinates: { latitude: mean(matches.map(row => row.latitude)), longitude: mean(matches.map(row => row.longitude)) }, precision: 'street', source: matches[0].provenance.name, provenance: matches[0].provenance,
        uncertainty: ['Coordinates are the mean of municipal address points for the street; no exact building or entrance is identified.', ...(regions.size > 1 ? ['The street spans multiple administrative districts/regions.'] : [])] };
    }
  }
  if (base.district) {
    const wanted = normalize(base.district);
    const matches = datasets.districts.filter(row => normalize(row.name.replace(/^(?:жк\.?|кв\.?|в\.з\.?)\s*/i, '')) === wanted && !/^в\.з\.?/i.test(row.name));
    if (matches.length === 1) return { ...base, coordinates: { latitude: matches[0].latitude, longitude: matches[0].longitude }, precision: 'neighbourhood', source: matches[0].provenance.name, provenance: matches[0].provenance,
      uncertainty: ['Coordinates are the centroid of the municipal neighbourhood polygon; they do not identify the property building.'] };
  }
  return { ...base, coordinates: undefined, source: 'unresolved', uncertainty: [...base.uncertainty, 'No unambiguous match was found in the municipal address or neighbourhood datasets.'] };
}

function normalize(value: string): string { return value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('bg-BG'); }
function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }

export function resolveListingLocation(listing: Listing): ResolvedLocation {
  const location: Record<string, unknown> = listing.location && typeof listing.location === 'object' ? listing.location : {};
  const city = stringValue(location.city);
  const district = stringValue(location.district);
  const street = stringValue(location.street);
  const evidence = location.propertySpecificEvidence === true;
  const hasUnambiguousStreet = street !== null && (district !== null || /^(?:ул\.?|бул\.?|пл\.?|ж\.к\.?|кв\.?)(?:\s|$)/i.test(street));
  const precision = evidence && validCoordinates(location.coordinates)
    ? 'exact'
    : hasUnambiguousStreet ? 'street' : district ? 'neighbourhood' : 'unknown';
  const result: ResolvedLocation = {
    city, district, street,
    precision,
    source: stringValue(location.source) ?? 'listing',
    uncertainty: precision === 'exact'
      ? ['Coordinates are explicitly marked as property-specific; verify against the listing evidence.']
      : precision === 'street'
        ? ['Street-level location does not identify an exact building or entrance.']
        : precision === 'neighbourhood'
          ? ['Location is limited to the named district.']
          : ['The listing does not provide an unambiguous property location.'],
  };
  if (precision === 'exact' && validCoordinates(location.coordinates)) result.coordinates = location.coordinates;
  return result;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validCoordinates(value: unknown): value is { latitude: number; longitude: number } {
  if (!value || typeof value !== 'object') return false;
  const coordinates = value as { latitude?: unknown; longitude?: unknown };
  return typeof coordinates.latitude === 'number' && Number.isFinite(coordinates.latitude)
    && typeof coordinates.longitude === 'number' && Number.isFinite(coordinates.longitude);
}
