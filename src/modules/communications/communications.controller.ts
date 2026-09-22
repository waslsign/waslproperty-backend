import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { CommunicationsService } from './communications.service.js';
import {
  communicationsQuerySchema,
  createCommunicationSchema,
  previewAudienceSchema,
  sendCommunicationSchema,
  updateCommunicationSchema,
} from './communications.schemas.js';

const communicationsService = new CommunicationsService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function listCommunications(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = communicationsQuerySchema.parse(req.query);
  const result = await communicationsService.list(auth.organisationId, auth, query);
  res.json(result);
}

export async function createCommunication(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createCommunicationSchema.parse(req.body);
  const communication = await communicationsService.create(
    auth.organisationId,
    auth,
    auth.userId,
    input,
  );
  res.status(201).json(communication);
}

export async function getCommunication(req: Request, res: Response) {
  const auth = requireAuth(req);
  const communication = await communicationsService.getById(
    auth.organisationId,
    auth,
    req.params.id as string,
  );
  res.json(communication);
}

export async function updateCommunication(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = updateCommunicationSchema.parse(req.body);
  const communication = await communicationsService.update(
    auth.organisationId,
    auth,
    req.params.id as string,
    input,
  );
  res.json(communication);
}

export async function sendCommunication(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = sendCommunicationSchema.parse(req.body);
  const communication = await communicationsService.send(
    auth.organisationId,
    auth,
    auth.userId,
    req.params.id as string,
    input,
  );
  res.json(communication);
}

export async function cancelCommunication(req: Request, res: Response) {
  const auth = requireAuth(req);
  const communication = await communicationsService.cancel(
    auth.organisationId,
    auth,
    auth.userId,
    req.params.id as string,
  );
  res.json(communication);
}

export async function duplicateCommunication(req: Request, res: Response) {
  const auth = requireAuth(req);
  const communication = await communicationsService.duplicateAsDraft(
    auth.organisationId,
    auth,
    auth.userId,
    req.params.id as string,
  );
  res.status(201).json(communication);
}

export async function previewCommunicationAudience(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = previewAudienceSchema.parse(req.body);
  const preview = await communicationsService.previewAudience(
    auth.organisationId,
    auth,
    input.audienceCriteria,
  );
  res.json(preview);
}

export async function getCommunicationDelivery(req: Request, res: Response) {
  const auth = requireAuth(req);
  const summary = await communicationsService.getDeliverySummary(
    auth.organisationId,
    auth,
    req.params.id as string,
  );
  res.json({ items: summary });
}
