import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { QuotesService } from './quotes.service.js';
import {
  createQuoteSchema,
  rejectQuoteSchema,
  setWorkflowModeSchema,
  submitQuoteSchema,
} from './quotes.schemas.js';

const quotesService = new QuotesService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function createQuote(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createQuoteSchema.parse(req.body);
  const quote = await quotesService.create(auth.organisationId, input);
  res.status(201).json(quote);
}

export async function getQuote(req: Request, res: Response) {
  const auth = requireAuth(req);
  const quote = await quotesService.getById(auth.organisationId, req.params.id as string);
  res.json(quote);
}

export async function submitQuote(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = submitQuoteSchema.parse(req.body);
  const quote = await quotesService.submit(
    auth.organisationId,
    auth.userId,
    req.params.id as string,
    input,
  );
  res.json(quote);
}

export async function setQuoteWorkflowMode(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = setWorkflowModeSchema.parse(req.body);
  const quote = await quotesService.setWorkflowMode(
    auth.organisationId,
    auth.userId,
    req.params.id as string,
    input,
  );
  res.json(quote);
}

export async function approveQuote(req: Request, res: Response) {
  const auth = requireAuth(req);
  const quote = await quotesService.approve(
    auth.organisationId,
    auth.userId,
    req.params.id as string,
  );
  res.json(quote);
}

export async function rejectQuote(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = rejectQuoteSchema.parse(req.body);
  const quote = await quotesService.reject(
    auth.organisationId,
    auth.userId,
    req.params.id as string,
    input,
  );
  res.json(quote);
}

/** A manager recording that a contractor declined to quote (received by
 * phone/email rather than through the contractor's own secure link). */
export async function declineQuote(req: Request, res: Response) {
  const auth = requireAuth(req);
  const quote = await quotesService.decline(
    auth.organisationId,
    auth.userId,
    req.params.id as string,
  );
  res.json(quote);
}

export async function withdrawQuote(req: Request, res: Response) {
  const auth = requireAuth(req);
  const quote = await quotesService.withdraw(
    auth.organisationId,
    auth.userId,
    req.params.id as string,
  );
  res.json(quote);
}
