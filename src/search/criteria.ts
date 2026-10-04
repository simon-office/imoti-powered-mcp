import { z } from 'zod';

const boundsSchema = z.object({ min: z.number().positive().optional(), max: z.number().positive().optional() }).refine(({ min, max }) => min === undefined || max === undefined || min <= max, 'min must not exceed max');

export const searchCriteriaSchema = z.object({
  deal: z.enum(['sale', 'rent']).default('sale'),
  city: z.string().default('sofia'),
  districts: z.array(z.string()).default([]),
  propertyTypes: z.array(z.string()).default([]),
  rooms: boundsSchema.optional(),
  priceMin: z.number().nonnegative().optional(),
  priceMax: z.number().positive().optional(),
  areaMin: z.number().positive().optional(),
  areaMax: z.number().positive().optional(),
  maxPages: z.number().int().min(1).max(3).default(3),
});

export type SearchCriteria = z.infer<typeof searchCriteriaSchema>;
