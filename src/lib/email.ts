import { env } from '../config/env.js';
import { logger } from './logger.js';
import { selectEmailProvider } from './email/selectEmailProvider.js';
import type { EmailProvider, SendEmailInput, SendEmailResult } from './email/types.js';

export type { SendEmailInput, SendEmailResult } from './email/types.js';

/** True whenever this process must never place a real outbound-mail
 * network call — either the explicit EMAIL_SEND_DISABLED kill switch, or
 * simply running under the test runner (NODE_ENV === 'test'), which is
 * always email-safe by default regardless of that flag. Exported so an
 * automated test can assert against this exact decision without needing
 * to spy on EmailService itself. */
export function isEmailSendSuppressed(): boolean {
  return env.EMAIL_SEND_DISABLED || env.NODE_ENV === 'test';
}

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

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (isEmailSendSuppressed()) {
      // Never calls getProvider() — no SMTP transporter or Resend client
      // is constructed, so no network connection to a real mail server is
      // ever attempted. The recipient and subject are logged (never the
      // body, which may carry sensitive content) so suppression is
      // observable, not silent.
      logger.warn(
        { to: input.to, subject: input.subject },
        'Outbound email suppressed (EMAIL_SEND_DISABLED or NODE_ENV=test) — not sent.',
      );
      return {};
    }
    return this.getProvider().send(input);
  }
}

export const emailService = new EmailService();
