import { z } from 'zod';
import { currencyCodeSchema, DEFAULT_CURRENCY_CODE } from '../../lib/currencies.js';

export const registerSchema = z.object({
  organisationName: z.string().trim().min(2).max(120),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
  /** The registration form always sends this (preselected to AUD, country
   * may suggest a different one) — defaulted here too so the backend is
   * never dependent on the frontend actually sending it. */
  currencyCode: currencyCodeSchema.default(DEFAULT_CURRENCY_CODE),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  /** Only required when the account has more than one organisation
   * relationship (see AuthService.login) — omitted otherwise. */
  organisationId: z.string().trim().min(1).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;
