import { z } from 'zod';
import { currencyCodeSchema } from '../../lib/currencies.js';

export const updateOrganisationCurrencySchema = z.object({
  currencyCode: currencyCodeSchema,
});
export type UpdateOrganisationCurrencyInput = z.infer<typeof updateOrganisationCurrencySchema>;
