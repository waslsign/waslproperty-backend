import type { Request, Response } from 'express';
import { getPrismaClient } from '../../lib/prisma.js';
import { QuoteRoundsService } from './quote-rounds.service.js';
import { presignQuoteAttachmentSchema, rfqPublicSubmitSchema } from './quote-rounds.schemas.js';

const quoteRoundsService = new QuoteRoundsService(getPrismaClient());

export async function getRfqInvitation(req: Request, res: Response) {
  const result = await quoteRoundsService.getPublicInvitation(req.params.token as string);
  res.json(result);
}

export async function submitRfqResponse(req: Request, res: Response) {
  const input = rfqPublicSubmitSchema.parse(req.body);
  const result = await quoteRoundsService.publicSubmit(req.params.token as string, input);
  res.json(result);
}

export async function declineRfqResponse(req: Request, res: Response) {
  const result = await quoteRoundsService.publicDecline(req.params.token as string);
  res.json(result);
}

export async function presignRfqAttachment(req: Request, res: Response) {
  const input = presignQuoteAttachmentSchema.parse(req.body);
  const result = await quoteRoundsService.presignPublicAttachment(
    req.params.token as string,
    input,
  );
  res.json(result);
}

export async function registerRfqAttachment(req: Request, res: Response) {
  const result = await quoteRoundsService.registerPublicAttachment(
    req.params.token as string,
    req.body,
  );
  res.status(201).json(result);
}
