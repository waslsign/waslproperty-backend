import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { AccountImportService } from './account-import.service.js';
import {
  createAccountSchema,
  importAccountsApplySchema,
  importAccountsPreviewSchema,
  listAccountsQuerySchema,
  updateAccountSchema,
} from './accounts.schemas.js';
import { AccountsService } from './accounts.service.js';

const accountsService = new AccountsService(getPrismaClient());
const accountImportService = new AccountImportService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function listAccounts(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = listAccountsQuerySchema.parse(req.query);
  const items = await accountsService.list(auth.organisationId, req.params.propertyId as string, query);
  res.json({ items });
}

export async function createAccount(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createAccountSchema.parse(req.body);
  const account = await accountsService.create(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    input,
  );
  res.status(201).json(account);
}

export async function updateAccount(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = updateAccountSchema.parse(req.body);
  const account = await accountsService.update(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.accountId as string,
    input,
  );
  res.json(account);
}

export async function deactivateAccount(req: Request, res: Response) {
  const auth = requireAuth(req);
  const account = await accountsService.deactivate(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.accountId as string,
  );
  res.json(account);
}

export async function reactivateAccount(req: Request, res: Response) {
  const auth = requireAuth(req);
  const account = await accountsService.reactivate(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.accountId as string,
  );
  res.json(account);
}

export async function exportAccountsCsv(req: Request, res: Response) {
  const auth = requireAuth(req);
  const csv = await accountsService.exportCsv(auth.organisationId, req.params.propertyId as string);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="chart-of-accounts.csv"');
  res.send(csv);
}

export async function previewAccountsImport(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = importAccountsPreviewSchema.parse(req.body);
  const report = await accountImportService.preview(
    auth.organisationId,
    req.params.propertyId as string,
    input,
  );
  res.json(report);
}

export async function applyAccountsImport(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = importAccountsApplySchema.parse(req.body);
  const result = await accountImportService.apply(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    input,
  );
  res.status(201).json(result);
}
