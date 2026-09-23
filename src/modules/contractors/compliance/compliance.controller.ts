import type { Request, Response } from 'express';
import { MaintenanceCategory } from '@prisma/client';
import { UnauthorizedError, ValidationError } from '../../../errors/AppError.js';
import { getPrismaClient } from '../../../lib/prisma.js';
import { ContractorCredentialsService } from './credentials.service.js';
import { ContractorComplianceRequirementsService } from './requirements.service.js';
import { ContractorEligibilityService } from './eligibility.service.js';
import { COMMON_CREDENTIAL_TYPES } from './credentialTypes.js';
import {
  createComplianceRequirementSchema,
  createCredentialSchema,
  presignCredentialDocumentSchema,
  rejectCredentialSchema,
  updateComplianceRequirementSchema,
  updateCredentialSchema,
  verifyCredentialSchema,
} from './compliance.schemas.js';

const prisma = getPrismaClient();
const credentialsService = new ContractorCredentialsService(prisma);
const requirementsService = new ContractorComplianceRequirementsService(prisma);
const eligibilityService = new ContractorEligibilityService(prisma);

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

// --- Credential types reference (for the "Add credential" picker) ---

export function listCommonCredentialTypes(_req: Request, res: Response) {
  res.json({ items: COMMON_CREDENTIAL_TYPES });
}

// --- Credentials ---

export async function presignCredentialDocument(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = presignCredentialDocumentSchema.parse(req.body);
  const result = await credentialsService.presignDocument(
    auth.organisationId,
    req.params.contractorId as string,
    input,
  );
  res.json(result);
}

export async function listCredentials(req: Request, res: Response) {
  const auth = requireAuth(req);
  const items = await credentialsService.list(
    auth.organisationId,
    req.params.contractorId as string,
  );
  res.json({ items });
}

export async function createCredential(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createCredentialSchema.parse(req.body);
  const credential = await credentialsService.create(
    auth.organisationId,
    auth.userId,
    req.params.contractorId as string,
    input,
  );
  res.status(201).json(credential);
}

export async function updateCredential(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = updateCredentialSchema.parse(req.body);
  const credential = await credentialsService.update(
    auth.organisationId,
    auth.userId,
    req.params.contractorId as string,
    req.params.credentialId as string,
    input,
  );
  res.json(credential);
}

export async function removeCredential(req: Request, res: Response) {
  const auth = requireAuth(req);
  await credentialsService.remove(
    auth.organisationId,
    auth.userId,
    req.params.contractorId as string,
    req.params.credentialId as string,
  );
  res.status(204).send();
}

export async function verifyCredential(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = verifyCredentialSchema.parse(req.body ?? {});
  const credential = await credentialsService.verify(
    auth.organisationId,
    auth.userId,
    req.params.contractorId as string,
    req.params.credentialId as string,
    input,
  );
  res.json(credential);
}

export async function rejectCredential(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = rejectCredentialSchema.parse(req.body);
  const credential = await credentialsService.reject(
    auth.organisationId,
    auth.userId,
    req.params.contractorId as string,
    req.params.credentialId as string,
    input,
  );
  res.json(credential);
}

// --- Compliance overview (contractor 360) ---

export async function getContractorComplianceOverview(req: Request, res: Response) {
  const auth = requireAuth(req);
  const overview = await eligibilityService.getComplianceOverview(
    auth.organisationId,
    req.params.contractorId as string,
  );
  res.json(overview);
}

// --- Organisation compliance requirements (Organisation Settings) ---

export async function listComplianceRequirements(req: Request, res: Response) {
  const auth = requireAuth(req);
  const categoryParam = req.query.category as string | undefined;
  if (categoryParam && !(Object.values(MaintenanceCategory) as string[]).includes(categoryParam)) {
    throw new ValidationError('Invalid category');
  }
  const items = await requirementsService.list(
    auth.organisationId,
    categoryParam as MaintenanceCategory | undefined,
  );
  res.json({ items });
}

export async function createComplianceRequirement(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createComplianceRequirementSchema.parse(req.body);
  const requirement = await requirementsService.create(auth.organisationId, auth.userId, input);
  res.status(201).json(requirement);
}

export async function updateComplianceRequirement(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = updateComplianceRequirementSchema.parse(req.body);
  const requirement = await requirementsService.update(
    auth.organisationId,
    auth.userId,
    req.params.id as string,
    input,
  );
  res.json(requirement);
}

export async function removeComplianceRequirement(req: Request, res: Response) {
  const auth = requireAuth(req);
  await requirementsService.remove(auth.organisationId, auth.userId, req.params.id as string);
  res.status(204).send();
}
