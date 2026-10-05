import type { Listing } from '../storage/index.js';

export type ResolvedLocation = {
  city: string | null;
  district: string | null;
  street: string | null;
  coordinates?: { latitude: number; longitude: number };
  precision: 'exact' | 'street' | 'neighbourhood' | 'unknown';
  source: string;
  uncertainty: string[];
};

export function resolveListingLocation(listing: Listing): ResolvedLocation {
  const location: Record<string, unknown> = listing.location && typeof listing.location === 'object' ? listing.location : {};
  const city = stringValue(location.city);
  const district = stringValue(location.district);
  const street = stringValue(location.street);
  const evidence = location.propertySpecificEvidence === true;
  const precision = evidence && validCoordinates(location.coordinates)
    ? 'exact'
    : street && district ? 'street' : district ? 'neighbourhood' : 'unknown';
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
