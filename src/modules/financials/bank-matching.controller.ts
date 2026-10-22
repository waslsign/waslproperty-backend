import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { BankMatchingService } from './bank-matching.service.js';
import {
  createReceiptFromTransactionSchema,
  ignoreTransactionSchema,
  manualMatchJournalLineSchema,
  manualMatchReceiptSchema,
  reverseMatchSchema,
} from './bank-matching.schemas.js';

const bankMatchingService = new BankMatchingService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function generateMatchSuggestion(req: Request, res: Response) {
  const auth = requireAuth(req);
  const suggestion = await bankMatchingService.generateSuggestion(
    auth.organisationId,
    req.params.propertyId as string,
    req.params.bankTransactionId as string,
  );
  res.json({ suggestion });
}

export async function confirmSuggestedMatch(req: Request, res: Response) {
  const auth = requireAuth(req);
  const match = await bankMatchingService.confirmSuggestedMatch(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.matchId as string,
  );
  res.status(201).json(match);
}

export async function manualMatchReceipt(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = manualMatchReceiptSchema.parse(req.body);
  const match = await bankMatchingService.manualMatchReceipt(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.bankTransactionId as string,
    input,
  );
  res.status(201).json(match);
}

export async function manualMatchJournalLine(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = manualMatchJournalLineSchema.parse(req.body);
  const match = await bankMatchingService.manualMatchJournalLine(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.bankTransactionId as string,
    input,
  );
  res.status(201).json(match);
}

export async function reverseMatch(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = reverseMatchSchema.parse(req.body);
  const match = await bankMatchingService.reverseMatch(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.matchId as string,
    input.reason,
  );
  res.status(201).json(match);
}

export async function ignoreTransaction(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = ignoreTransactionSchema.parse(req.body);
  const transaction = await bankMatchingService.ignoreTransaction(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.bankTransactionId as string,
    input.reason,
  );
  res.status(201).json(transaction);
}

export async function createReceiptFromTransaction(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createReceiptFromTransactionSchema.parse(req.body);
  const result = await bankMatchingService.createReceiptFromTransaction(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.bankTransactionId as string,
    input,
  );
  res.status(201).json(result);
}
