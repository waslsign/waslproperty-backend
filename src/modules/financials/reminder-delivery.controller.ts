import type { Request, Response } from 'express';
import { z } from 'zod';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { ReminderApprovalService } from './reminder-approval.service.js';
import { ReminderDispatchService } from './reminder-dispatch.service.js';
import { ReminderEligibilityService } from './reminder-eligibility.service.js';
import { ReminderPolicyService } from './reminder-policy.service.js';
import { evaluateRemindersSchema, updateReminderPolicySchema } from './reminder-policy.schemas.js';

const policyService = new ReminderPolicyService(getPrismaClient());
const eligibilityService = new ReminderEligibilityService(getPrismaClient());
const approvalService = new ReminderApprovalService(getPrismaClient());
const dispatchService = new ReminderDispatchService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function getReminderPolicy(req: Request, res: Response) {
  const auth = requireAuth(req);
  const policy = await policyService.get(auth.organisationId, req.params.propertyId as string);
  res.json(policy);
}

export async function updateReminderPolicy(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = updateReminderPolicySchema.parse(req.body);
  const policy = await policyService.update(auth.organisationId, auth.userId, req.params.propertyId as string, input);
  res.json(policy);
}

export async function evaluateReminders(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = evaluateRemindersSchema.parse(req.body ?? {});
  const now = input.asOfDate ? new Date(`${input.asOfDate}T12:00:00.000Z`) : new Date();
  const summary = await eligibilityService.evaluate(auth.organisationId, req.params.propertyId as string, now);
  res.status(201).json(summary);
}

const queueQuerySchema = z.object({
  status: z
    .enum(['DRAFT', 'CANCELLED', 'SENT', 'FAILED', 'READY_FOR_REVIEW', 'APPROVED', 'QUEUED', 'SENDING', 'DELIVERED', 'SUPPRESSED', 'QUARANTINED'])
    .optional(),
  spaceId: z.string().trim().min(1).optional(),
});

export async function listReminderQueue(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = queueQuerySchema.parse(req.query);
  const items = await approvalService.listQueue(auth.organisationId, req.params.propertyId as string, query);
  res.json({ items });
}

export async function getReminderDetail(req: Request, res: Response) {
  const auth = requireAuth(req);
  const detail = await approvalService.getDetail(auth.organisationId, req.params.propertyId as string, req.params.reminderId as string);
  res.json(detail);
}

export async function submitReminderForReview(req: Request, res: Response) {
  const auth = requireAuth(req);
  const submitted = await approvalService.submitForReview(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.reminderId as string,
  );
  res.status(201).json(submitted);
}

export async function approveReminder(req: Request, res: Response) {
  const auth = requireAuth(req);
  const approved = await approvalService.approve(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.reminderId as string,
  );
  res.status(201).json(approved);
}

const batchApproveSchema = z.object({ reminderIds: z.array(z.string().trim().min(1)).min(1).max(200) });

export async function batchApproveReminders(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = batchApproveSchema.parse(req.body);
  const result = await approvalService.batchApprove(auth.organisationId, auth.userId, req.params.propertyId as string, input.reminderIds);
  res.status(201).json(result);
}

const cancelReminderSchema = z.object({ reason: z.string().trim().max(500).optional() });

export async function cancelReminderM168(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = cancelReminderSchema.parse(req.body ?? {});
  const cancelled = await approvalService.cancel(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.reminderId as string,
    input.reason,
  );
  res.status(201).json(cancelled);
}

export async function dispatchReminder(req: Request, res: Response) {
  const auth = requireAuth(req);
  await dispatchService.dispatchNow(auth.organisationId, req.params.propertyId as string, req.params.reminderId as string);
  res.status(202).json({ dispatched: true });
}

export async function retryReminderDispatch(req: Request, res: Response) {
  const auth = requireAuth(req);
  await dispatchService.retry(auth.organisationId, auth.userId, req.params.propertyId as string, req.params.reminderId as string);
  res.status(201).json({ retried: true });
}

const resolveQuarantineSchema = z.object({
  resolution: z.enum(['CONFIRMED_SENT', 'CONFIRMED_NOT_SENT']),
  note: z.string().trim().min(1).max(500),
});

export async function resolveReminderQuarantine(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = resolveQuarantineSchema.parse(req.body);
  await dispatchService.resolveQuarantine(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.reminderId as string,
    input.resolution,
    input.note,
  );
  res.status(201).json({ resolved: true });
}

export async function listReminderDeliveryAttempts(req: Request, res: Response) {
  const auth = requireAuth(req);
  const prisma = getPrismaClient();
  const property = await prisma.property.findFirst({ where: { id: req.params.propertyId as string, organisationId: auth.organisationId } });
  if (!property) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Property not found' } });
    return;
  }
  const attempts = await prisma.paymentReminderDeliveryAttempt.findMany({
    where: { organisationId: auth.organisationId, propertyId: req.params.propertyId as string, paymentReminderId: req.params.reminderId as string },
    orderBy: { attemptNumber: 'asc' },
    select: {
      id: true,
      publicReference: true,
      attemptNumber: true,
      outcome: true,
      startedAt: true,
      completedAt: true,
      providerMessageId: true,
      errorCategory: true,
    },
  });
  res.json({
    items: attempts.map((a) => ({
      ...a,
      startedAt: a.startedAt.toISOString(),
      completedAt: a.completedAt ? a.completedAt.toISOString() : null,
    })),
  });
}
