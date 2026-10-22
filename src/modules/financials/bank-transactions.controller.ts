import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { BankTransactionsService } from './bank-transactions.service.js';
import { listBankTransactionsQuerySchema } from './bank-import.schemas.js';

const bankTransactionsService = new BankTransactionsService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function listBankTransactions(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = listBankTransactionsQuerySchema.parse(req.query);
  const items = await bankTransactionsService.list(
    auth.organisationId,
    req.params.propertyId as string,
    req.params.bankAccountId as string,
    query,
  );
  res.json({ items });
}

export async function getBankTransaction(req: Request, res: Response) {
  const auth = requireAuth(req);
  const transaction = await bankTransactionsService.get(
    auth.organisationId,
    req.params.propertyId as string,
    req.params.bankTransactionId as string,
  );
  res.json(transaction);
}
