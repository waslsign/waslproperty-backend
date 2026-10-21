import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { generateManualSourceId, LedgerPostingService } from './ledger-posting.service.js';
import {
  generateOpeningJournalSchema,
  listJournalsQuerySchema,
  postManualJournalSchema,
  reverseJournalSchema,
  trialBalanceQuerySchema,
} from './ledger.schemas.js';
import { OpeningJournalService } from './opening-journal.service.js';

const ledgerPostingService = new LedgerPostingService(getPrismaClient());
const openingJournalService = new OpeningJournalService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function listJournals(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = listJournalsQuerySchema.parse(req.query);
  const items = await ledgerPostingService.list(auth.organisationId, req.params.propertyId as string, query);
  res.json({ items });
}

export async function getJournal(req: Request, res: Response) {
  const auth = requireAuth(req);
  const journal = await ledgerPostingService.get(
    auth.organisationId,
    req.params.propertyId as string,
    req.params.journalId as string,
  );
  res.json(journal);
}

export async function postManualJournal(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = postManualJournalSchema.parse(req.body);
  const journal = await ledgerPostingService.post(auth.organisationId, auth.userId, req.params.propertyId as string, {
    effectiveDate: input.effectiveDate,
    narration: input.narration,
    sourceType: 'MANUAL',
    sourceId: input.sourceId ?? generateManualSourceId(),
    lines: input.lines,
  });
  res.status(201).json(journal);
}

export async function reverseJournal(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = reverseJournalSchema.parse(req.body);
  const journal = await ledgerPostingService.reverse(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.journalId as string,
    input,
  );
  res.status(201).json(journal);
}

export async function getTrialBalance(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = trialBalanceQuerySchema.parse(req.query);
  const rows = await ledgerPostingService.trialBalance(
    auth.organisationId,
    req.params.propertyId as string,
    query.asOfDate,
    query.financialFundId,
  );
  res.json({ items: rows });
}

export async function generateOpeningJournal(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = generateOpeningJournalSchema.parse(req.body);
  const journal = await openingJournalService.generate(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    input,
  );
  res.status(201).json(journal);
}
