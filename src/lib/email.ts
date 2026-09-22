import { env } from '../config/env.js';
import { logger } from './logger.js';
import { selectEmailProvider } from './email/selectEmailProvider.js';
import type { EmailProvider, SendEmailInput } from './email/types.js';

export type { SendEmailInput, SendEmailResult } from './email/types.js';

/**
 * The single outbound-mail entry point every domain module calls
 * (invites.service.ts, communications.delivery.ts) — never a provider
 * directly. Picks the real transport once, lazily, via
 * selectEmailProvider(): Resend's HTTPS API when RESEND_API_KEY is set
 * (the only viable choice in staging/production — see
 * ResendEmailProvider's doc comment for why raw SMTP doesn't work on
 * Render), SMTP otherwise (local development only).
 */
export class EmailService {
  private provider: EmailProvider | undefined;

  private getProvider(): EmailProvider {
    if (!this.provider) {
      if (!env.RESEND_API_KEY && env.NODE_ENV === 'production') {
        logger.warn(
          'RESEND_API_KEY is not set in production — falling back to SMTP, which will fail on platforms (e.g. Render Free tier) that block outbound SMTP ports.',
        );
      }
      this.provider = selectEmailProvider({
        resendApiKey: env.RESEND_API_KEY,
        emailFrom: env.EMAIL_FROM,
      });
    }
    return this.provider;
  }

  async send(input: SendEmailInput) {
    return this.getProvider().send(input);
  }
}

export const emailService = new EmailService();
