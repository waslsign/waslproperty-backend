import { z } from 'zod';

/**
 * The set of ISO 3166-1 alpha-2 country codes an organisation may set as its
 * jurisdiction — an explicit, hand-maintained allowlist (not free text or
 * the full ISO list), matching the existing currency-code precedent
 * (src/lib/currencies.ts). Extend this when the business genuinely starts
 * operating in a new country, not speculatively — jurisdiction-specific
 * features (see organisation-features.ts) are keyed off this same set.
 */
export const SUPPORTED_COUNTRY_CODES = ['AU', 'US', 'GB', 'AE', 'SA', 'NZ', 'CA', 'SG'] as const;

export type CountryCode = (typeof SUPPORTED_COUNTRY_CODES)[number];

export function isSupportedCountryCode(code: string): code is CountryCode {
  return (SUPPORTED_COUNTRY_CODES as readonly string[]).includes(code);
}

export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isSupportedCountryCode, { message: 'Unsupported country code' });
