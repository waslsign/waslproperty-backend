import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import {
  closeAccountingPeriodSchema,
  createAccountingPeriodSchema,
  reopenAccountingPeriodSchema,
} from './accounting-periods.schemas.js';
import { AccountingPeriodsService } from './accounting-periods.service.js';

const periodsService = new AccountingPeriodsService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function listAccountingPeriods(req: Request, res: Response) {
  const auth = requireAuth(req);
  const items = await periodsService.list(auth.organisationId, req.params.propertyId as string);
  res.json({ items });
}

export async function createAccountingPeriod(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createAccountingPeriodSchema.parse(req.body);
  const period = await periodsService.create(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    input,
  );
  res.status(201).json(period);
}

export async function closeAccountingPeriod(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = closeAccountingPeriodSchema.parse(req.body);
  const period = await periodsService.close(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.periodId as string,
    input,
  );
  res.json(period);
}

export async function reopenAccountingPeriod(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = reopenAccountingPeriodSchema.parse(req.body);
  const period = await periodsService.reopen(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.periodId as string,
    input,
  );
  res.json(period);
}
