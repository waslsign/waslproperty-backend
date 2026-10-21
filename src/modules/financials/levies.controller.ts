import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { authorizationService } from '../../middlewares/authorize.middleware.js';
import {
  approveLevyScheduleSchema,
  cancelLevyScheduleSchema,
  createLevyAdjustmentSchema,
  createRegularLevyScheduleSchema,
  createSpecialLevyScheduleSchema,
  issueLevyScheduleSchema,
  listLotLevyChargesQuerySchema,
  reverseLevyScheduleSchema,
} from './levies.schemas.js';
import { LevyService } from './levies.service.js';

const levyService = new LevyService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function listLevySchedules(req: Request, res: Response) {
  const auth = requireAuth(req);
  const items = await levyService.list(auth.organisationId, req.params.propertyId as string);
  res.json({ items });
}

export async function getLevySchedule(req: Request, res: Response) {
  const auth = requireAuth(req);
  const schedule = await levyService.getById(
    auth.organisationId,
    req.params.propertyId as string,
    req.params.scheduleId as string,
  );
  res.json(schedule);
}

export async function createRegularLevySchedule(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createRegularLevyScheduleSchema.parse(req.body);
  const schedule = await levyService.createRegular(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    input,
  );
  res.status(201).json(schedule);
}

export async function createSpecialLevySchedule(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createSpecialLevyScheduleSchema.parse(req.body);
  const schedule = await levyService.createSpecial(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    input,
  );
  res.status(201).json(schedule);
}

export async function approveLevySchedule(req: Request, res: Response) {
  const auth = requireAuth(req);
  approveLevyScheduleSchema.parse(req.body ?? {});
  const schedule = await levyService.approve(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.scheduleId as string,
  );
  res.json(schedule);
}

export async function cancelLevySchedule(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = cancelLevyScheduleSchema.parse(req.body);
  const schedule = await levyService.cancel(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.scheduleId as string,
    input.reason,
  );
  res.json(schedule);
}

export async function previewLevySchedule(req: Request, res: Response) {
  const auth = requireAuth(req);
  const rows = await levyService.preview(
    auth.organisationId,
    req.params.propertyId as string,
    req.params.scheduleId as string,
  );
  res.json({ items: rows });
}

export async function issueLevySchedule(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = issueLevyScheduleSchema.parse(req.body ?? {});
  const schedule = await levyService.issue(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.scheduleId as string,
    input,
  );
  res.status(201).json(schedule);
}

export async function reverseLevySchedule(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = reverseLevyScheduleSchema.parse(req.body);
  const schedule = await levyService.reverseInstallment(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.scheduleId as string,
    input.levyInstallmentId,
    input.reason,
  );
  res.status(201).json(schedule);
}

export async function listLotLevyCharges(req: Request, res: Response) {
  const auth = requireAuth(req);
  const propertyId = req.params.propertyId as string;
  const query = listLotLevyChargesQuerySchema.parse(req.query);
  const includeOwnerNames = await authorizationService.can(auth, 'people.view', propertyId);
  const items = await levyService.listCharges(auth.organisationId, propertyId, query, includeOwnerNames);
  res.json({ items });
}

export async function createLevyAdjustment(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createLevyAdjustmentSchema.parse(req.body);
  const adjustment = await levyService.createAdjustment(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.chargeId as string,
    input,
  );
  res.status(201).json(adjustment);
}
