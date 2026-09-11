import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import { getPrismaClient } from '../../../lib/prisma.js';
import { QuotesService } from '../../quotes/quotes.service.js';

const quotesService = new QuotesService(getPrismaClient());

const callbackPayloadSchema = z.object({
  eventId: z.string().trim().min(1),
  eventType: z.string().trim().min(1),
  sourceSystem: z.string().trim().min(1),
  sourceEntityId: z.string().trim().min(1),
  waslSignAgreementId: z.union([z.string(), z.number()]).transform(String),
  status: z.string().optional(),
  occurredAt: z.string().optional(),
});

/**
 * POST /api/v1/integrations/waslsign/callback — mounted in app.ts with
 * express.raw() ahead of the global express.json(), so req.body here is the
 * exact raw bytes WaslSign signed. Verifying against the parsed-then
 * re-serialized JSON would silently accept a tampered payload whose
 * re-serialization happens to match — never re-stringify before verifying.
 */
export async function handleWaslSignCallback(req: Request, res: Response) {
  if (!env.WASLSIGN_WEBHOOK_SECRET) {
    logger.error('Received a WaslSign webhook but WASLSIGN_WEBHOOK_SECRET is not configured');
    return res
      .status(503)
      .json({ error: { code: 'NOT_CONFIGURED', message: 'Webhook receiver not configured' } });
  }

  const rawBody = req.body as Buffer;
  const signatureHeader = req.header('X-WaslSign-Signature') ?? '';
  const [, signature] = signatureHeader.split('sha256=');
  if (!signature) {
    return res
      .status(401)
      .json({ error: { code: 'INVALID_SIGNATURE', message: 'Missing signature' } });
  }

  const expected = crypto
    .createHmac('sha256', env.WASLSIGN_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  const signatureBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return res
      .status(401)
      .json({ error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' } });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res
      .status(400)
      .json({ error: { code: 'MALFORMED_PAYLOAD', message: 'Invalid JSON body' } });
  }

  const payload = callbackPayloadSchema.parse(parsedJson);

  if (payload.sourceSystem !== 'wasl-property') {
    return res.status(200).json({ handled: false, reason: 'wrong_source_system' });
  }

  const result = await quotesService.handleWaslSignCallback(payload);
  return res.status(200).json(result);
}
