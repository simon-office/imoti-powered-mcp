import type { MunicipalFeature, TransitSchedule, TransitStop, WalkingRoute } from '../area/types.js';

export interface SofiaDataAdapter {
  getStops(): Promise<TransitStop[]>;
  getSchedules(): Promise<TransitSchedule[]>;
  getMunicipalFeatures(): Promise<MunicipalFeature[]>;
  getWalkingRoutes(): Promise<WalkingRoute[]>;
}

export interface SofiaDataFixtures {
  stops?: TransitStop[];
  schedules?: TransitSchedule[];
  features?: MunicipalFeature[];
  walkingRoutes?: WalkingRoute[];
}

export class FixtureSofiaDataAdapter implements SofiaDataAdapter {
  readonly #fixtures: SofiaDataFixtures;

  constructor(fixtures: SofiaDataFixtures) {
    this.#fixtures = structuredClone(fixtures);
  }

  async getStops(): Promise<TransitStop[]> {
    return structuredClone(this.#fixtures.stops ?? []);
  }

  async getSchedules(): Promise<TransitSchedule[]> {
    return structuredClone(this.#fixtures.schedules ?? []);
  }

  async getMunicipalFeatures(): Promise<MunicipalFeature[]> {
    return structuredClone(this.#fixtures.features ?? []);
  }

  async getWalkingRoutes(): Promise<WalkingRoute[]> {
    return structuredClone(this.#fixtures.walkingRoutes ?? []);
  }
}
