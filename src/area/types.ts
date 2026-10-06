export interface DataSourceProvenance {
  name: string;
  sourceUrl: string;
  datasetDate: string;
  checkedAt: string;
  reuseTerms: string;
  stale?: { reason: 'over-age' | 'feed-end-date'; refreshError: string };
}

export interface NormalizedStop {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  provenance: DataSourceProvenance;
}

export interface NormalizedSchedule {
  routeId: string;
  stopId: string;
  departureTime: string;
  provenance: DataSourceProvenance;
}

export interface NormalizedMunicipalFeature {
  id: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  provenance: DataSourceProvenance;
}

export interface NormalizedWalkingRoute {
  origin: string;
  destination: string;
  distanceMeters: number;
  durationSeconds: number;
  provenance: DataSourceProvenance;
}

export type TransitStop = NormalizedStop;
export type TransitSchedule = NormalizedSchedule;
export type MunicipalFeature = NormalizedMunicipalFeature;
export type WalkingRoute = NormalizedWalkingRoute;
