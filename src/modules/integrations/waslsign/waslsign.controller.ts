import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import { getPrismaClient } from '../../../lib/prisma.js';
import { QuotesService } from '../../quotes/quotes.service.js';
import { WorkOrderVariationsService } from '../../work-orders/work-order-variations.service.js';

const prisma = getPrismaClient();
const quotesService = new QuotesService(prisma);
const variationsService = new WorkOrderVariationsService(prisma);

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

  // Route by a persisted identifier — sourceEntityId is the domain row's
  // own id, and each of ContractorQuote/WorkOrderVariation is the one
  // place its own startSignatureWorkflow ever set it as a WaslSign
  // sourceEntityId — never inferred from the id's shape or any string
  // parsing. Both use the exact same WaslSignWebhookEvent idempotency
  // ledger (the eventId unique constraint above already guarantees this
  // request is being processed at most once, regardless of which handler
  // ends up running).
  const quote = await prisma.contractorQuote.findFirst({
    where: { id: payload.sourceEntityId },
    select: { id: true },
  });
  if (quote) {
    const result = await quotesService.handleWaslSignCallback(payload);
    return res.status(200).json(result);
  }

  const variation = await prisma.workOrderVariation.findFirst({
    where: { id: payload.sourceEntityId },
    select: { id: true },
  });
  if (variation) {
    const result = await variationsService.handleWaslSignCallback(payload);
    return res.status(200).json(result);
  }

  logger.warn({ payload }, 'WaslSign callback for an unknown resource — ignored');
  return res.status(200).json({ handled: false, reason: 'unknown_resource' });
}
