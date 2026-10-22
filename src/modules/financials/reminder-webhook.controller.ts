import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { ReminderDispatchService } from './reminder-dispatch.service.js';

const dispatchService = new ReminderDispatchService(getPrismaClient());

const webhookPayloadSchema = z.object({
  providerMessageId: z.string().trim().min(1),
  status: z.enum(['delivered', 'bounced', 'complained']),
  occurredAt: z.string().optional(),
});

/**
 * POST /api/v1/integrations/reminder-delivery/webhook — a minimal,
 * provider-agnostic delivery-confirmation receiver, HMAC-verified exactly
 * like the existing WaslSign callback (waslsign.controller.ts) — same
 * signed-raw-body pattern, same "no secret configured -> 503, never
 * silently accept" posture. Mounted with express.raw() ahead of
 * express.json() in app.ts.
 *
 * Deliberately narrow: only moves SENT -> DELIVERED (via
 * ReminderDispatchService.recordDeliveryConfirmation's own
 * compare-and-swap, which is what actually deduplicates a redelivered
 * webhook event — see that method's doc comment). "bounced"/"complained"
 * are accepted and logged but do not change status in this MVP — no
 * bounce-handling workflow exists yet.
 */
export async function handleReminderDeliveryWebhook(req: Request, res: Response) {
  if (!env.REMINDER_DELIVERY_WEBHOOK_SECRET) {
    logger.error('Received a reminder-delivery webhook but REMINDER_DELIVERY_WEBHOOK_SECRET is not configured');
    return res.status(503).json({ error: { code: 'NOT_CONFIGURED', message: 'Webhook receiver not configured' } });
  }

  const rawBody = req.body as Buffer;
  const signatureHeader = req.header('X-Reminder-Signature') ?? '';
  const [, signature] = signatureHeader.split('sha256=');
  if (!signature) {
    return res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Missing signature' } });
  }

  const expected = crypto.createHmac('sha256', env.REMINDER_DELIVERY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  const signatureBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' } });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: { code: 'MALFORMED_PAYLOAD', message: 'Invalid JSON body' } });
  }

  const payload = webhookPayloadSchema.parse(parsedJson);

  if (payload.status !== 'delivered') {
    logger.info({ payload }, 'Reminder delivery webhook: non-delivered status received, no state change');
    return res.status(200).json({ handled: false, reason: 'not_a_delivered_event' });
  }

  const occurredAt = payload.occurredAt ? new Date(payload.occurredAt) : new Date();
  const result = await dispatchService.recordDeliveryConfirmation(payload.providerMessageId, occurredAt);
  return res.status(200).json({ handled: result.applied });
}
