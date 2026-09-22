/**
 * The generic outbound-email transport boundary — every EmailProvider
 * implementation (Resend, SMTP, later Amazon SES) satisfies this same
 * shape, and nothing outside src/lib/email/ ever imports a provider
 * directly. Domain code (communications, invites) only ever sees
 * EmailService (src/lib/email.ts), never a provider.
 */
export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  /** The provider's own id for this send, when it returns one — stored on
   * CommunicationDelivery.providerMessageId for traceability. Optional
   * because not every provider (e.g. SMTP) reliably returns one. */
  providerMessageId?: string;
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

export class EmailProviderError extends Error {
  readonly code: 'UNAVAILABLE' | 'TIMEOUT' | 'REQUEST_FAILED';

  constructor(code: EmailProviderError['code'], message: string) {
    super(message);
    this.name = 'EmailProviderError';
    this.code = code;
  }
}
