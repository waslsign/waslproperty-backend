import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { authorizationService } from '../../middlewares/authorize.middleware.js';
import { ArrearsService } from './arrears.service.js';
import {
  arrearsRegisterQuerySchema,
  arrearsSummaryQuerySchema,
  createCollectionCaseSchema,
  createCollectionNoteSchema,
  draftReminderSchema,
  lotArrearsDetailQuerySchema,
  updateCollectionCaseSchema,
} from './arrears.schemas.js';

const arrearsService = new ArrearsService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getArrearsSummary(req: Request, res: Response) {
  const auth = requireAuth(req);
  const propertyId = req.params.propertyId as string;
  const query = arrearsSummaryQuerySchema.parse(req.query);
  const summary = await arrearsService.getSummary(
    auth.organisationId,
    propertyId,
    query.asOfDate ?? todayDateOnly(),
    query.financialFundId,
  );
  res.json(summary);
}

export async function getArrearsRegister(req: Request, res: Response) {
  const auth = requireAuth(req);
  const propertyId = req.params.propertyId as string;
  const query = arrearsRegisterQuerySchema.parse(req.query);
  const includeOwnerNames = await authorizationService.can(auth, 'people.view', propertyId);
  const items = await arrearsService.getRegister(
    auth.organisationId,
    propertyId,
    query.asOfDate ?? todayDateOnly(),
    { financialFundId: query.financialFundId, ageingBucket: query.ageingBucket, collectionStatus: query.collectionStatus },
    includeOwnerNames,
  );
  res.json({ items });
}

export async function getLotArrearsDetail(req: Request, res: Response) {
  const auth = requireAuth(req);
  const propertyId = req.params.propertyId as string;
  const spaceId = req.params.spaceId as string;
  const query = lotArrearsDetailQuerySchema.parse(req.query);
  const includeOwnerNames = await authorizationService.can(auth, 'people.view', propertyId);
  const detail = await arrearsService.getLotDetail(
    auth.organisationId,
    propertyId,
    spaceId,
    query.asOfDate ?? todayDateOnly(),
    includeOwnerNames,
  );
  res.json(detail);
}

export async function createCollectionCase(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createCollectionCaseSchema.parse(req.body);
  const kase = await arrearsService.createCollectionCase(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.spaceId as string,
    input,
  );
  res.status(201).json(kase);
}

export async function updateCollectionCase(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = updateCollectionCaseSchema.parse(req.body);
  const kase = await arrearsService.updateCollectionCase(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.caseId as string,
    input,
  );
  res.json(kase);
}

export async function getCollectionCase(req: Request, res: Response) {
  const auth = requireAuth(req);
  const kase = await arrearsService.getCollectionCase(
    auth.organisationId,
    req.params.propertyId as string,
    req.params.caseId as string,
  );
  res.json(kase);
}

export async function addCollectionNote(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createCollectionNoteSchema.parse(req.body);
  const note = await arrearsService.addCollectionNote(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.caseId as string,
    input,
  );
  res.status(201).json(note);
}

export async function draftReminder(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = draftReminderSchema.parse(req.body);
  const reminder = await arrearsService.draftReminder(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.spaceId as string,
    input.asOfDate ?? todayDateOnly(),
    input.collectionCaseId,
  );
  res.status(201).json(reminder);
}

export async function getReminder(req: Request, res: Response) {
  const auth = requireAuth(req);
  const reminder = await arrearsService.getReminder(
    auth.organisationId,
    req.params.propertyId as string,
    req.params.reminderId as string,
  );
  res.json(reminder);
}

export async function cancelReminder(req: Request, res: Response) {
  const auth = requireAuth(req);
  const reminder = await arrearsService.cancelReminder(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.reminderId as string,
  );
  res.json(reminder);
}
