import type { Request, Response } from 'express';
import { PropertyRole } from '@prisma/client';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { RolePermissionsService } from './role-permissions.service.js';
import {
  rolePermissionsRoleParamSchema,
  updateRolePermissionsSchema,
} from './role-permissions.schemas.js';

const rolePermissionsService = new RolePermissionsService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function getRolePermissions(req: Request, res: Response) {
  const auth = requireAuth(req);
  const summary = await rolePermissionsService.getSummary(auth.organisationId);
  res.json({
    roles: summary,
    capabilityGroups: rolePermissionsService.capabilityGroups,
    configurableRoles: rolePermissionsService.configurableRoles,
  });
}

export async function updateRolePermissions(req: Request, res: Response) {
  const auth = requireAuth(req);
  const { role } = rolePermissionsRoleParamSchema.parse(req.params);
  const input = updateRolePermissionsSchema.parse(req.body);
  const capabilities = await rolePermissionsService.updateRole(
    auth.organisationId,
    auth.userId,
    role as PropertyRole,
    input,
  );
  res.json({ role, capabilities });
}

export async function resetRolePermissions(req: Request, res: Response) {
  const auth = requireAuth(req);
  const { role } = rolePermissionsRoleParamSchema.parse(req.params);
  const capabilities = await rolePermissionsService.resetRole(
    auth.organisationId,
    auth.userId,
    role as PropertyRole,
  );
  res.json({ role, capabilities });
}
