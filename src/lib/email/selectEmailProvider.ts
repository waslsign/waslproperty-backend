import type { EmailProvider } from './types.js';
import { ResendEmailProvider } from './resendEmailProvider.js';
import { SmtpEmailProvider } from './smtpEmailProvider.js';

export interface SelectEmailProviderConfig {
  resendApiKey?: string;
  emailFrom: string;
}

/**
 * Pure selection logic, kept separate from EmailService so it's testable
 * without mocking the env module — Resend whenever an API key is
 * configured (the only viable choice in staging/production), SMTP
 * otherwise (local development only; see SmtpEmailProvider). Swapping in
 * Amazon SES later means adding one more branch here and one more
 * EmailProvider implementation — nothing else in the app changes.
 */
export function selectEmailProvider(config: SelectEmailProviderConfig): EmailProvider {
  if (config.resendApiKey) {
    return new ResendEmailProvider(config.resendApiKey, config.emailFrom);
  }
  return new SmtpEmailProvider();
}
