import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import {
  addBudgetLineSchema,
  approveBudgetSchema,
  createBudgetRevisionSchema,
  createBudgetSchema,
  updateBudgetLineSchema,
  updateBudgetMetadataSchema,
} from './budgets.schemas.js';
import { FinancialBudgetsService } from './budgets.service.js';

const budgetsService = new FinancialBudgetsService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function listFinancialBudgets(req: Request, res: Response) {
  const auth = requireAuth(req);
  const budgets = await budgetsService.list(auth.organisationId, req.params.propertyId as string);
  res.json({ items: budgets });
}

export async function getFinancialBudget(req: Request, res: Response) {
  const auth = requireAuth(req);
  const budget = await budgetsService.getById(
    auth.organisationId,
    req.params.propertyId as string,
    req.params.budgetId as string,
  );
  res.json(budget);
}

export async function createFinancialBudget(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createBudgetSchema.parse(req.body);
  const budget = await budgetsService.create(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    input,
  );
  res.status(201).json(budget);
}

export async function updateFinancialBudgetMetadata(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = updateBudgetMetadataSchema.parse(req.body);
  const budget = await budgetsService.updateMetadata(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.budgetId as string,
    input,
  );
  res.json(budget);
}

export async function addFinancialBudgetLine(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = addBudgetLineSchema.parse(req.body);
  const budget = await budgetsService.addLine(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.budgetId as string,
    input,
  );
  res.status(201).json(budget);
}

export async function updateFinancialBudgetLine(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = updateBudgetLineSchema.parse(req.body);
  const budget = await budgetsService.updateLine(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.budgetId as string,
    req.params.lineId as string,
    input,
  );
  res.json(budget);
}

export async function deleteFinancialBudgetLine(req: Request, res: Response) {
  const auth = requireAuth(req);
  const budget = await budgetsService.deleteLine(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.budgetId as string,
    req.params.lineId as string,
  );
  res.json(budget);
}

export async function approveFinancialBudget(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = approveBudgetSchema.parse(req.body ?? {});
  const budget = await budgetsService.approve(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.budgetId as string,
    input,
  );
  res.json(budget);
}

export async function activateFinancialBudget(req: Request, res: Response) {
  const auth = requireAuth(req);
  const budget = await budgetsService.activate(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.budgetId as string,
  );
  res.json(budget);
}

export async function reviseFinancialBudget(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createBudgetRevisionSchema.parse(req.body ?? {});
  const budget = await budgetsService.createRevision(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.budgetId as string,
    input,
  );
  res.status(201).json(budget);
}
