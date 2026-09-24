import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { ApprovalPolicyService } from './approval-policy.service.js';
import { upsertApprovalPolicySchema } from './approval-policy.schemas.js';

const approvalPolicyService = new ApprovalPolicyService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function getApprovalPolicy(req: Request, res: Response) {
  const auth = requireAuth(req);
  const policy = await approvalPolicyService.getPolicy(auth.organisationId);
  res.json(policy);
}

export async function upsertApprovalPolicy(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = upsertApprovalPolicySchema.parse(req.body);
  const policy = await approvalPolicyService.upsertPolicy(auth.organisationId, auth.userId, input);
  res.json(policy);
}

export async function disableApprovalPolicy(req: Request, res: Response) {
  const auth = requireAuth(req);
  const policy = await approvalPolicyService.disable(auth.organisationId, auth.userId);
  res.json(policy);
}
