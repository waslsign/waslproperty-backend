import type { MaintenanceCategory, PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../../errors/AppError.js';
import { recordActivity } from '../../activity/activity.js';
import type {
  CreateComplianceRequirementInput,
  UpdateComplianceRequirementInput,
} from './compliance.schemas.js';

/**
 * Organisation Settings -> Contractor Compliance: what credentials this
 * organisation requires (or merely recognises as optional) for each trade.
 * OWNER/ADMIN only, at the route level — the same bar as Roles &
 * Permissions configuration (see role-permissions.service.ts), since this
 * is genuinely an organisation-wide setting with no property to scope
 * against.
 */
export class ContractorComplianceRequirementsService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(organisationId: string, category?: MaintenanceCategory) {
    return this.prisma.contractorComplianceRequirement.findMany({
      where: { organisationId, ...(category ? { category } : {}) },
      orderBy: [{ category: 'asc' }, { credentialType: 'asc' }],
    });
  }

  private async getOwned(organisationId: string, requirementId: string) {
    const requirement = await this.prisma.contractorComplianceRequirement.findFirst({
      where: { id: requirementId, organisationId },
    });
    if (!requirement) {
      throw new NotFoundError('Compliance requirement not found');
    }
    return requirement;
  }

  async create(
    organisationId: string,
    actorUserId: string,
    input: CreateComplianceRequirementInput,
  ) {
    const existing = await this.prisma.contractorComplianceRequirement.findUnique({
      where: {
        organisationId_category_credentialType: {
          organisationId,
          category: input.category,
          credentialType: input.credentialType,
        },
      },
    });
    if (existing) {
      throw new ConflictError('A requirement for this trade and credential type already exists');
    }

    return this.prisma.$transaction(async (tx) => {
      const requirement = await tx.contractorComplianceRequirement.create({
        data: { organisationId, createdByUserId: actorUserId, ...input },
      });

      await recordActivity(tx, {
        organisationId,
        actorUserId,
        eventType: 'CONTRACTOR_COMPLIANCE_REQUIREMENTS_UPDATED',
        entityType: 'ContractorComplianceRequirement',
        entityId: requirement.id,
        title: `Compliance requirement added: ${input.credentialType} for ${input.category}`,
      });

      return requirement;
    });
  }

  async update(
    organisationId: string,
    actorUserId: string,
    requirementId: string,
    input: UpdateComplianceRequirementInput,
  ) {
    const existing = await this.getOwned(organisationId, requirementId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contractorComplianceRequirement.update({
        where: { id: requirementId },
        data: input,
      });

      await recordActivity(tx, {
        organisationId,
        actorUserId,
        eventType: 'CONTRACTOR_COMPLIANCE_REQUIREMENTS_UPDATED',
        entityType: 'ContractorComplianceRequirement',
        entityId: updated.id,
        title: `Compliance requirement updated: ${existing.credentialType} for ${existing.category}`,
      });

      return updated;
    });
  }

  async remove(organisationId: string, actorUserId: string, requirementId: string) {
    const existing = await this.getOwned(organisationId, requirementId);

    await this.prisma.$transaction(async (tx) => {
      await tx.contractorComplianceRequirement.delete({ where: { id: requirementId } });
      await recordActivity(tx, {
        organisationId,
        actorUserId,
        eventType: 'CONTRACTOR_COMPLIANCE_REQUIREMENTS_UPDATED',
        entityType: 'ContractorComplianceRequirement',
        entityId: requirementId,
        title: `Compliance requirement removed: ${existing.credentialType} for ${existing.category}`,
      });
    });
  }
}
