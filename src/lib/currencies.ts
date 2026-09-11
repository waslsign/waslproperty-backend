import { z } from 'zod';

/**
 * The set of ISO 4217 currency codes this app accepts anywhere a currency
 * is stored or selected — organisation default, work order, or quote. Kept
 * as an explicit, hand-maintained allowlist (not free text) so a typo or a
 * currency the business doesn't actually operate in can never silently end
 * up in a financial record. Extend this list when the business genuinely
 * starts operating in a new currency, not on request from a single form.
 */
export const SUPPORTED_CURRENCY_CODES = [
  'AUD',
  'USD',
  'EUR',
  'GBP',
  'AED',
  'SAR',
  'QAR',
  'KWD',
  'BHD',
  'OMR',
  'NZD',
  'CAD',
  'SGD',
  'HKD',
  'JPY',
  'CNY',
  'INR',
  'ZAR',
  'CHF',
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCY_CODES)[number];

export const DEFAULT_CURRENCY_CODE: CurrencyCode = 'AUD';

export function isSupportedCurrencyCode(code: string): code is CurrencyCode {
  return (SUPPORTED_CURRENCY_CODES as readonly string[]).includes(code);
}

export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isSupportedCurrencyCode, { message: 'Unsupported currency code' });
