import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { BankAccountsService } from './bank-accounts.service.js';
import {
  listBankAccountsQuerySchema,
  registerBankAccountSchema,
  updateBankAccountSchema,
} from './bank-accounts.schemas.js';

const bankAccountsService = new BankAccountsService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function registerBankAccount(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = registerBankAccountSchema.parse(req.body);
  const account = await bankAccountsService.register(auth.organisationId, auth.userId, req.params.propertyId as string, input);
  res.status(201).json(account);
}

export async function listBankAccounts(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = listBankAccountsQuerySchema.parse(req.query);
  const items = await bankAccountsService.list(auth.organisationId, req.params.propertyId as string, query.activeOnly);
  res.json({ items });
}

export async function getBankAccount(req: Request, res: Response) {
  const auth = requireAuth(req);
  const account = await bankAccountsService.get(
    auth.organisationId,
    req.params.propertyId as string,
    req.params.bankAccountId as string,
  );
  res.json(account);
}

export async function listEligibleGlAccounts(req: Request, res: Response) {
  const auth = requireAuth(req);
  const items = await bankAccountsService.listEligibleGlAccounts(auth.organisationId, req.params.propertyId as string);
  res.json({ items });
}

export async function updateBankAccount(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = updateBankAccountSchema.parse(req.body);
  const account = await bankAccountsService.update(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.bankAccountId as string,
    input,
  );
  res.json(account);
}
