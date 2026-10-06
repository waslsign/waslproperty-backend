import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import {
  addFundSchema,
  bulkSetLotOpeningPositionsSchema,
  startFinancialSetupSchema,
  updateFinancialYearSchema,
  updateFundSchema,
} from './financials.schemas.js';
import { FinancialsService } from './financials.service.js';

const financialsService = new FinancialsService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function getFinancialSummary(req: Request, res: Response) {
  const auth = requireAuth(req);
  const summary = await financialsService.getSummary(
    auth.organisationId,
    req.params.propertyId as string,
  );
  res.json(summary);
}

export async function startFinancialSetup(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = startFinancialSetupSchema.parse(req.body);
  const summary = await financialsService.startSetup(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    input,
  );
  res.json(summary);
}

export async function updateFinancialYear(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = updateFinancialYearSchema.parse(req.body);
  const summary = await financialsService.updateFinancialYear(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    input,
  );
  res.json(summary);
}

export async function addFinancialFund(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = addFundSchema.parse(req.body);
  const summary = await financialsService.addFund(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    input,
  );
  res.json(summary);
}

export async function updateFinancialFund(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = updateFundSchema.parse(req.body);
  const summary = await financialsService.updateFund(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.fundId as string,
    input,
  );
  res.json(summary);
}

export async function bulkSetFinancialLotOpeningPositions(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = bulkSetLotOpeningPositionsSchema.parse(req.body);
  const summary = await financialsService.bulkSetLotOpeningPositions(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    input,
  );
  res.json(summary);
}

export async function getFinancialReconciliation(req: Request, res: Response) {
  const auth = requireAuth(req);
  const report = await financialsService.getReconciliation(
    auth.organisationId,
    req.params.propertyId as string,
  );
  res.json(report);
}

export async function activateFinancialSetup(req: Request, res: Response) {
  const auth = requireAuth(req);
  const summary = await financialsService.activate(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
  );
  res.json(summary);
}
