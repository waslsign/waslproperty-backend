import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { BankReconciliationService } from './bank-reconciliation.service.js';
import { createReconciliationDraftSchema, reopenReconciliationSchema } from './bank-reconciliation.schemas.js';

const bankReconciliationService = new BankReconciliationService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function createReconciliationDraft(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createReconciliationDraftSchema.parse(req.body);
  const reconciliation = await bankReconciliationService.createDraft(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.bankAccountId as string,
    input,
  );
  res.status(201).json(reconciliation);
}

export async function listReconciliations(req: Request, res: Response) {
  const auth = requireAuth(req);
  const items = await bankReconciliationService.list(
    auth.organisationId,
    req.params.propertyId as string,
    req.params.bankAccountId as string,
  );
  res.json({ items });
}

export async function getReconciliation(req: Request, res: Response) {
  const auth = requireAuth(req);
  const reconciliation = await bankReconciliationService.get(
    auth.organisationId,
    req.params.propertyId as string,
    req.params.reconciliationId as string,
  );
  res.json(reconciliation);
}

export async function calculateReconciliation(req: Request, res: Response) {
  const auth = requireAuth(req);
  const reconciliation = await bankReconciliationService.calculate(
    auth.organisationId,
    req.params.propertyId as string,
    req.params.reconciliationId as string,
  );
  res.json(reconciliation);
}

export async function completeReconciliation(req: Request, res: Response) {
  const auth = requireAuth(req);
  const reconciliation = await bankReconciliationService.complete(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.reconciliationId as string,
  );
  res.status(201).json(reconciliation);
}

export async function reopenReconciliation(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = reopenReconciliationSchema.parse(req.body);
  const reconciliation = await bankReconciliationService.reopen(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.reconciliationId as string,
    input.reason,
  );
  res.status(201).json(reconciliation);
}
