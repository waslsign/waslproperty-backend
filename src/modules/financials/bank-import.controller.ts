import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { BankImportService } from './bank-import.service.js';
import { applyBankStatementSchema, previewBankStatementSchema } from './bank-import.schemas.js';

const bankImportService = new BankImportService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function previewBankStatement(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = previewBankStatementSchema.parse(req.body);
  const report = await bankImportService.preview(
    auth.organisationId,
    req.params.propertyId as string,
    req.params.bankAccountId as string,
    input,
  );
  res.json(report);
}

export async function applyBankStatement(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = applyBankStatementSchema.parse(req.body);
  const result = await bankImportService.apply(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.bankAccountId as string,
    input,
  );
  res.status(201).json(result);
}

export async function listBankStatementImports(req: Request, res: Response) {
  const auth = requireAuth(req);
  const items = await bankImportService.listImports(
    auth.organisationId,
    req.params.propertyId as string,
    req.params.bankAccountId as string,
  );
  res.json({ items });
}
