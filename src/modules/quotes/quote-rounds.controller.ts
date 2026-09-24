import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { QuoteRoundsService } from './quote-rounds.service.js';
import {
  awardQuoteRoundSchema,
  cancelQuoteRoundSchema,
  createQuoteRoundSchema,
  inviteContractorsSchema,
  presignQuoteAttachmentSchema,
} from './quote-rounds.schemas.js';

const quoteRoundsService = new QuoteRoundsService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function createQuoteRound(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createQuoteRoundSchema.parse(req.body);
  const round = await quoteRoundsService.create(auth.organisationId, auth.userId, input);
  res.status(201).json(round);
}

export async function getQuoteRound(req: Request, res: Response) {
  const auth = requireAuth(req);
  const round = await quoteRoundsService.getById(auth.organisationId, req.params.id as string);
  res.json(round);
}

export async function getQuoteRoundByMaintenanceRequest(req: Request, res: Response) {
  const auth = requireAuth(req);
  const round = await quoteRoundsService.findByMaintenanceRequestId(
    auth.organisationId,
    req.params.maintenanceRequestId as string,
  );
  res.json(round);
}

export async function getEligibleContractorsForRequest(req: Request, res: Response) {
  const auth = requireAuth(req);
  const result = await quoteRoundsService.listContractorEligibilityForRequest(
    auth.organisationId,
    req.params.maintenanceRequestId as string,
  );
  res.json(result);
}

export async function inviteContractors(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = inviteContractorsSchema.parse(req.body);
  const round = await quoteRoundsService.inviteContractors(
    auth.organisationId,
    auth.userId,
    req.params.id as string,
    input.contractorIds,
  );
  res.json(round);
}

export async function awardQuoteRound(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = awardQuoteRoundSchema.parse(req.body);
  const result = await quoteRoundsService.award(
    auth.organisationId,
    auth.userId,
    req.params.id as string,
    input.quoteId,
    input.note,
  );
  res.json(result);
}

export async function cancelQuoteRound(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = cancelQuoteRoundSchema.parse(req.body);
  const round = await quoteRoundsService.cancel(
    auth.organisationId,
    auth.userId,
    req.params.id as string,
    input.reason,
  );
  res.json(round);
}

export async function presignQuoteAttachment(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = presignQuoteAttachmentSchema.parse(req.body);
  const result = await quoteRoundsService.presignAttachment(
    auth.organisationId,
    req.params.id as string,
    input,
  );
  res.json(result);
}

export async function registerQuoteAttachment(req: Request, res: Response) {
  const auth = requireAuth(req);
  const result = await quoteRoundsService.registerAttachment(
    auth.organisationId,
    auth.userId,
    req.params.id as string,
    req.body,
  );
  res.status(201).json(result);
}

export async function listQuoteAttachments(req: Request, res: Response) {
  const auth = requireAuth(req);
  const result = await quoteRoundsService.listAttachments(
    auth.organisationId,
    req.params.id as string,
  );
  res.json(result);
}
