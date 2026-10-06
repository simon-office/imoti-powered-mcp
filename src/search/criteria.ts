import { z } from 'zod';
import { resolvePropertyType } from './slugs.js';

/** Site-search page bounds preserve the existing polite three-page cap. */
export const DEFAULT_SEARCH_MAX_PAGES = 3;
export const MAX_SEARCH_MAX_PAGES = 3;
export const DEFAULT_SEARCH_MAX_RESULTS = 15;
export const MIN_SEARCH_MAX_RESULTS = 10;
export const MAX_SEARCH_MAX_RESULTS = 20;

export function configuredSearchLimit(name: 'IMOTI_SEARCH_MAX_PAGES' | 'IMOTI_SEARCH_MAX_RESULTS', fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  const min = name === 'IMOTI_SEARCH_MAX_PAGES' ? 1 : MIN_SEARCH_MAX_RESULTS;
  const max = name === 'IMOTI_SEARCH_MAX_PAGES' ? MAX_SEARCH_MAX_PAGES : MAX_SEARCH_MAX_RESULTS;
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  return value;
}

const boundsSchema = z.object({ min: z.number().positive().optional(), max: z.number().positive().optional() }).refine(({ min, max }) => min === undefined || max === undefined || min <= max, 'min must not exceed max');

export const searchCriteriaSchema = z.object({
  deal: z.enum(['sale', 'rent']).default('sale').describe('Choose sale when buying or rent when renting.'),
  city: z.string().default('sofia'),
  districts: z.array(z.string()).default([]),
  propertyTypes: z.array(z.string().transform(value => resolvePropertyType(value).slug)).default([]),
  rooms: boundsSchema.optional(),
  priceMin: z.number().nonnegative().optional().describe('Minimum asking price in EUR; for rentals, EUR per month.'),
  priceMax: z.number().positive().optional().describe('Maximum asking price in EUR; for rentals, EUR per month.'),
  areaMin: z.number().positive().optional(),
  areaMax: z.number().positive().optional(),
  startPage: z.number().int().min(1).max(26).default(1),
  maxPages: z.number().int().min(1).max(MAX_SEARCH_MAX_PAGES).default(DEFAULT_SEARCH_MAX_PAGES),
});

export type SearchCriteria = z.infer<typeof searchCriteriaSchema>;
