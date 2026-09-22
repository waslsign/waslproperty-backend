import { logger } from '../logger.js';
import {
  EmailProviderError,
  type EmailProvider,
  type SendEmailInput,
  type SendEmailResult,
} from './types.js';

const RESEND_API_URL = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Sends via Resend's HTTPS API — never raw SMTP. Render's Free Web Service
 * tier blocks outbound SMTP ports (25/465/587) entirely, so any SMTP-based
 * transport is a hard outage there regardless of which mail provider is
 * behind it; a plain HTTPS POST on port 443 has no such restriction.
 *
 * Deliberately implemented with a plain `fetch` call rather than the
 * `resend` SDK — the API surface used here is one POST request, and this
 * mirrors the existing external-HTTP-call convention already used for
 * WaslSign (src/lib/waslSign.ts) rather than adding a new dependency for
 * it.
 */
export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: input.to,
          subject: input.subject,
          html: input.html,
          text: input.text,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new EmailProviderError('TIMEOUT', 'Resend request timed out');
      }
      throw new EmailProviderError('UNAVAILABLE', 'Resend is unreachable');
    } finally {
      clearTimeout(timeout);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }

    if (!response.ok) {
      const message =
        extractErrorMessage(body) ?? `Resend request failed with status ${response.status}`;
      logger.warn({ statusCode: response.status, message }, 'Resend send failed');
      throw new EmailProviderError('REQUEST_FAILED', message);
    }

    return { providerMessageId: extractMessageId(body) };
  }
}

function extractErrorMessage(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return undefined;
}

function extractMessageId(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'id' in body) {
    const id = (body as { id: unknown }).id;
    if (typeof id === 'string') return id;
  }
  return undefined;
}
