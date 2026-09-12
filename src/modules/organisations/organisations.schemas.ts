import { z } from 'zod';
import { countryCodeSchema } from '../../lib/countries.js';
import { currencyCodeSchema } from '../../lib/currencies.js';

export const updateOrganisationSchema = z
  .object({
    currencyCode: currencyCodeSchema.optional(),
    countryCode: countryCodeSchema.optional(),
  })
  .refine((value) => value.currencyCode !== undefined || value.countryCode !== undefined, {
    message: 'Provide at least one field to update',
  });
export type UpdateOrganisationInput = z.infer<typeof updateOrganisationSchema>;
