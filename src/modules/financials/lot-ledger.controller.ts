import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { authorizationService } from '../../middlewares/authorize.middleware.js';
import { lotLedgerQuerySchema, lotStatementQuerySchema } from './lot-ledger.schemas.js';
import { LotLedgerService } from './lot-ledger.service.js';

const lotLedgerService = new LotLedgerService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

/** `people.view` is checked independently of `financials.view` (which the
 * route itself already requires) on every one of these three endpoints —
 * owner identity is never bundled into a financials-gated response by
 * default, same split as listLotLevyCharges (levies.controller.ts). */
async function canIncludeOwnerNames(req: Request, propertyId: string) {
  const auth = requireAuth(req);
  return authorizationService.can(auth, 'people.view', propertyId);
}

export async function getLotFinancialAccount(req: Request, res: Response) {
  const auth = requireAuth(req);
  const propertyId = req.params.propertyId as string;
  const spaceId = req.params.spaceId as string;
  const includeOwnerNames = await canIncludeOwnerNames(req, propertyId);
  const account = await lotLedgerService.getFinancialAccount(auth.organisationId, propertyId, spaceId, includeOwnerNames);
  res.json(account);
}

export async function getLotLedger(req: Request, res: Response) {
  const auth = requireAuth(req);
  const propertyId = req.params.propertyId as string;
  const spaceId = req.params.spaceId as string;
  const query = lotLedgerQuerySchema.parse(req.query);
  const includeOwnerNames = await canIncludeOwnerNames(req, propertyId);
  const page = await lotLedgerService.getLedger(auth.organisationId, propertyId, spaceId, query, includeOwnerNames);
  res.json(page);
}

export async function getLotStatement(req: Request, res: Response) {
  const auth = requireAuth(req);
  const propertyId = req.params.propertyId as string;
  const spaceId = req.params.spaceId as string;
  const query = lotStatementQuerySchema.parse(req.query);
  const includeOwnerNames = await canIncludeOwnerNames(req, propertyId);
  const statement = await lotLedgerService.getStatement(
    auth.organisationId,
    propertyId,
    spaceId,
    query.periodStartDate,
    query.periodEndDate,
    includeOwnerNames,
  );
  res.json(statement);
}
