import type { Listing } from '../storage/index.js';

export type ResolvedLocation = {
  city: string | null;
  district: string | null;
  street: string | null;
  coordinates?: { latitude: number; longitude: number };
  precision: 'exact' | 'street' | 'neighbourhood' | 'unknown';
  source: string;
  uncertainty: string[];
  provenance?: { name: string; sourceUrl: string; datasetDate: string; checkedAt: string; reuseTerms: string; stale?: { reason: 'over-age' | 'feed-end-date'; refreshError: string } };
};

export interface MunicipalLocationDatasets {
  addresses: Array<{ settlement: string; street: string; region: string; latitude: number; longitude: number; provenance: NonNullable<ResolvedLocation['provenance']> }>;
  districts: Array<{ name: string; latitude: number; longitude: number; geometry?: { type: 'MultiPolygon'; coordinates: number[][][][] }; provenance: NonNullable<ResolvedLocation['provenance']> }>;
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
    const districtName = base.district;
    const districtMatches = districtName ? datasets.districts.filter(row => normalize(row.name.replace(/^(?:жк\.?|кв\.?|в\.з\.?)\s*/i, '')) === normalize(districtName) && !/^в\.з\.?/i.test(row.name)) : [];
    if (districtMatches.length === 1 && districtMatches[0].geometry) {
      const district = districtMatches[0];
      const inside = matches.filter(point => pointInMultiPolygon(point.longitude, point.latitude, district.geometry!.coordinates));
      if (inside.length) {
        const coordinates = { latitude: mean(inside.map(row => row.latitude)), longitude: mean(inside.map(row => row.longitude)) };
        const farthest = Math.max(...inside.map(row => distanceMeters(coordinates, row)));
        return { ...base, coordinates, precision: 'street', source: inside[0].provenance.name, provenance: inside[0].provenance,
          uncertainty: [`Coordinates are the mean of ${inside.length} same-street municipal address points inside the named district; no exact building or entrance is identified. Farthest selected point is ${Math.round(farthest)} m from the resolved point.`] };
      }
      return { ...base, coordinates: { latitude: district.latitude, longitude: district.longitude }, precision: 'neighbourhood', source: district.provenance.name, provenance: district.provenance,
        uncertainty: ['No matching street address point was inside the named district; no street point was used. Coordinates are the district polygon centroid and do not identify the property building.'] };
    }
    if (matches.length) {
      const regions = new Set(matches.map(row => row.region));
      return { ...base, coordinates: { latitude: mean(matches.map(row => row.latitude)), longitude: mean(matches.map(row => row.longitude)) }, precision: 'street', source: matches[0].provenance.name, provenance: matches[0].provenance,
        uncertainty: ['Coordinates are the mean of municipal address points for the street; no exact building or entrance is identified.', ...(regions.size > 1 ? ['The street spans multiple administrative districts/regions.'] : [])] };
    }
  }
  if (base.district) {
    const wanted = normalize(base.district);
    const matches = datasets.districts.filter(row => normalize(row.name.replace(/^(?:жк\.?|кв\.?|в\.з\.?)\s*/i, '')) === wanted && !/^в\.з\.?/i.test(row.name));
    const parkMatches = datasets.districts.filter(row => /^парк\s+/i.test(row.name) && normalize(row.name.replace(/^парк\s+/i, '')) === wanted);
    const estateMatches = matches.filter(row => /^жк\.?/i.test(row.name));
    const selected = parkMatches.length && estateMatches.length === 1 ? estateMatches : matches;
    if (selected.length === 1 && selected[0].geometry) return { ...base, coordinates: { latitude: selected[0].latitude, longitude: selected[0].longitude }, precision: 'neighbourhood', source: selected[0].provenance.name, provenance: selected[0].provenance,
      uncertainty: [selected[0].geometry ? 'Coordinates are the centroid of the municipal neighbourhood polygon; they do not identify the property building.' : 'Municipal neighbourhood polygon geometry is unavailable; the supplied neighbourhood point is approximate and does not identify the property building.'] };
    if ((!selected.length || (selected.length === 1 && !selected[0].geometry)) && (!matches.length || (matches.length === 1 && !matches[0].geometry))) {
      const points = datasets.addresses.filter(row => normalize(row.region) === wanted);
      if (points.length) return { ...base, coordinates: { latitude: mean(points.map(row => row.latitude)), longitude: mean(points.map(row => row.longitude)) }, precision: 'neighbourhood', source: points[0].provenance.name, provenance: points[0].provenance,
        uncertainty: [`District polygon unavailable; coordinates are the mean of ${points.length} municipal address points (approximate neighbourhood precision), not an exact property location. Source: ${points[0].provenance.name}.`] };
    }
    if (selected.length === 1) return { ...base, coordinates: { latitude: selected[0].latitude, longitude: selected[0].longitude }, precision: 'neighbourhood', source: selected[0].provenance.name, provenance: selected[0].provenance,
      uncertainty: ['Municipal neighbourhood polygon geometry is unavailable; no matching municipal district address points were available, so the supplied neighbourhood point is approximate and does not identify the property building.'] };
  }
  return { ...base, coordinates: undefined, source: 'unresolved', uncertainty: [...base.uncertainty, 'No unambiguous match was found in the municipal address or neighbourhood datasets.'] };
}

function normalize(value: string): string { return value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('bg-BG'); }
function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function pointInMultiPolygon(longitude: number, latitude: number, polygons: number[][][][]): boolean {
  return polygons.some(polygon => polygon.length > 0 && ringContains(longitude, latitude, polygon[0]) && !polygon.slice(1).some(ring => ringContains(longitude, latitude, ring)));
}
function ringContains(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-10 && x >= Math.min(xi, xj) && x <= Math.max(xi, xj) && y >= Math.min(yi, yj) && y <= Math.max(yi, yj)) return true;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radians = Math.PI / 180, dLat = (b.latitude - a.latitude) * radians, dLon = (b.longitude - a.longitude) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

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
