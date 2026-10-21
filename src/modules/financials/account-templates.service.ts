import type { PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/AppError.js';
import { withPublicReference } from '../../lib/public-reference.js';
import { recordActivity } from '../activity/activity.js';
import type { CreateAccountTemplateInput } from './accounts.schemas.js';
import type { AccountView } from './accounts.service.js';

export interface AccountTemplateLineView {
  code: string;
  name: string;
  classification: string;
  parentCode: string | null;
}

export interface AccountTemplateView {
  id: string;
  publicReference: string;
  name: string;
  version: number;
  isActive: boolean;
  lines: AccountTemplateLineView[];
  createdAt: string;
}

/**
 * M16.2.1 — organisation-level, versioned account templates. Copy-on-
 * provision only (see prisma/schema.prisma's Chart of Accounts section doc
 * comment, point 1) — `provision` reads a template's lines once and
 * writes independent AccountingAccount rows; nothing about a scheme's
 * accounts is ever re-derived from the template afterward. A new version
 * of a template never edits an older one in place, mirroring
 * FinancialBudget's own immutable-history versioning.
 */
export class AccountTemplateService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(organisationId: string): Promise<AccountTemplateView[]> {
    const templates = await this.prisma.accountTemplate.findMany({
      where: { organisationId, isActive: true },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
    });
    return templates.map(toTemplateView);
  }

  /** Creates version 1 of a new template name, or the next version of an
   * existing one — never edits an existing version's lines in place. */
  async create(
    organisationId: string,
    actorUserId: string,
    input: CreateAccountTemplateInput,
  ): Promise<AccountTemplateView> {
    const codes = new Set<string>();
    for (const line of input.lines) {
      if (codes.has(line.code)) {
        throw new ValidationError(`Duplicate code "${line.code}" within this template.`);
      }
      codes.add(line.code);
    }
    for (const line of input.lines) {
      if (line.parentCode && !codes.has(line.parentCode)) {
        throw new ValidationError(
          `Line "${line.code}" references parentCode "${line.parentCode}", which isn't in this template.`,
        );
      }
    }

    const maxVersion = await this.prisma.accountTemplate.aggregate({
      where: { organisationId, name: input.name },
      _max: { version: true },
    });
    const version = (maxVersion._max.version ?? 0) + 1;

    return this.prisma.$transaction(async (tx) => {
      let template;
      try {
        template = await withPublicReference('ACCT', (publicReference) =>
          tx.accountTemplate.create({
            data: {
              publicReference,
              organisationId,
              name: input.name,
              version,
              createdByUserId: actorUserId,
              lines: {
                create: input.lines.map((line, index) => ({
                  code: line.code,
                  name: line.name,
                  classification: line.classification,
                  parentCode: line.parentCode ?? null,
                  sortOrder: index,
                })),
              },
            },
            include: { lines: { orderBy: { sortOrder: 'asc' } } },
          }),
        );
      } catch (err) {
        if (isUniqueConstraintViolation(err)) {
          throw new ConflictError('A template with this name and version already exists.');
        }
        throw err;
      }
      return toTemplateView(template);
    });
  }

  /** Copies every line of the given template version into independent
   * AccountingAccount rows for `propertyId` — a code already present on
   * the property's chart of accounts is skipped (never overwritten), so
   * provisioning twice, or provisioning after some accounts were already
   * added by hand, is safe and idempotent. */
  async provision(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    accountTemplateId: string,
  ): Promise<{ created: AccountView[]; skippedCodes: string[] }> {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, organisationId },
    });
    if (!property) {
      throw new NotFoundError('Property not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const configuration = await tx.financialConfiguration.findUnique({ where: { propertyId } });
      if (!configuration) {
        throw new ConflictError(
          'Start financial setup for this property before provisioning a chart of accounts.',
        );
      }

      const template = await tx.accountTemplate.findFirst({
        where: { id: accountTemplateId, organisationId },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!template) {
        throw new NotFoundError('Account template not found');
      }

      const existing = await tx.accountingAccount.findMany({
        where: { propertyId },
        select: { code: true },
      });
      const existingCodes = new Set(existing.map((a) => a.code));

      const created: AccountView[] = [];
      const skippedCodes: string[] = [];
      // Two passes: codes first, then parent links — a line referencing a
      // sibling parentCode must resolve to an id created in this same
      // provisioning run (or skip cleanly if that sibling was itself
      // skipped as a pre-existing code).
      const createdIdByCode = new Map<string, string>();

      for (const line of template.lines) {
        if (existingCodes.has(line.code)) {
          skippedCodes.push(line.code);
          continue;
        }
        const account = await withPublicReference('ACC', (publicReference) =>
          tx.accountingAccount.create({
            data: {
              publicReference,
              organisationId,
              propertyId,
              financialConfigurationId: configuration.id,
              code: line.code,
              name: line.name,
              classification: line.classification,
              sourceTemplateLineId: line.id,
              createdByUserId: actorUserId,
            },
          }),
        );
        createdIdByCode.set(line.code, account.id);
        created.push({
          id: account.id,
          publicReference: account.publicReference,
          code: account.code,
          name: account.name,
          description: account.description,
          classification: account.classification,
          parentAccountId: account.parentAccountId,
          restrictedToFundId: account.restrictedToFundId,
          restrictedToFundName: null,
          isActive: account.isActive,
          externalCode: account.externalCode,
          sourceTemplateLineId: account.sourceTemplateLineId,
          sourceImportBatchId: account.sourceImportBatchId,
          createdAt: account.createdAt.toISOString(),
          updatedAt: account.updatedAt.toISOString(),
        });
      }

      for (const line of template.lines) {
        if (!line.parentCode) continue;
        const childId = createdIdByCode.get(line.code);
        const parentId = createdIdByCode.get(line.parentCode);
        if (childId && parentId) {
          await tx.accountingAccount.update({
            where: { id: childId },
            data: { parentAccountId: parentId },
          });
        }
      }

      if (created.length > 0) {
        await recordActivity(tx, {
          organisationId,
          propertyId,
          actorUserId,
          eventType: 'FINANCIAL_ACCOUNTS_IMPORTED',
          entityType: 'AccountTemplate',
          entityId: template.id,
          title: `${created.length} account(s) provisioned from template "${template.name}" v${template.version}`,
        });
      }

      return { created, skippedCodes };
    });
  }
}

function toTemplateView(template: {
  id: string;
  publicReference: string;
  name: string;
  version: number;
  isActive: boolean;
  createdAt: Date;
  lines: { code: string; name: string; classification: string; parentCode: string | null }[];
}): AccountTemplateView {
  return {
    id: template.id,
    publicReference: template.publicReference,
    name: template.name,
    version: template.version,
    isActive: template.isActive,
    lines: template.lines.map((l) => ({
      code: l.code,
      name: l.name,
      classification: l.classification,
      parentCode: l.parentCode,
    })),
    createdAt: template.createdAt.toISOString(),
  };
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  );
}
