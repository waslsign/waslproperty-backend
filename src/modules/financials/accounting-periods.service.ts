import type { AccountingPeriodStatus, Prisma, PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/AppError.js';
import { formatDateOnly, parseDateOnly } from '../../lib/dateOnly.js';
import { withPublicReference } from '../../lib/public-reference.js';
import { recordActivity } from '../activity/activity.js';
import type {
  CloseAccountingPeriodInput,
  CreateAccountingPeriodInput,
  ReopenAccountingPeriodInput,
} from './accounting-periods.schemas.js';

export interface AccountingPeriodView {
  id: string;
  publicReference: string;
  startDate: string;
  endDate: string;
  status: AccountingPeriodStatus;
  closedByUserId: string | null;
  closedAt: string | null;
  reopenedByUserId: string | null;
  reopenedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * M16.2.2 — Accounting Periods. Posting is only ever allowed into an OPEN
 * period (see LedgerPostingService.post); this service owns the period
 * calendar itself. Non-overlap is validated here, under the same
 * FinancialConfiguration row lock FinancialBudgetsService.activate already
 * uses — not a DB exclusion constraint (no btree_gist dependency
 * introduced) — see AccountingPeriod's own doc comment for why that's an
 * acceptable, deliberate simplification: every mutation to this property's
 * period calendar serializes through the same lock.
 */
export class AccountingPeriodsService {
  constructor(private readonly prisma: PrismaClient) {}

  private async getOwnedProperty(organisationId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, organisationId },
    });
    if (!property) {
      throw new NotFoundError('Property not found');
    }
    return property;
  }

  private async getConfiguration(client: PrismaClient | Prisma.TransactionClient, propertyId: string) {
    const configuration = await client.financialConfiguration.findUnique({ where: { propertyId } });
    if (!configuration) {
      throw new ConflictError(
        'Start financial setup for this property before managing accounting periods.',
      );
    }
    return configuration;
  }

  private async getOwnedPeriod(
    client: PrismaClient | Prisma.TransactionClient,
    organisationId: string,
    propertyId: string,
    periodId: string,
  ) {
    const period = await client.accountingPeriod.findFirst({
      where: { id: periodId, organisationId, propertyId },
    });
    if (!period) {
      throw new NotFoundError('Accounting period not found');
    }
    return period;
  }

  async list(organisationId: string, propertyId: string): Promise<AccountingPeriodView[]> {
    await this.getOwnedProperty(organisationId, propertyId);
    const periods = await this.prisma.accountingPeriod.findMany({
      where: { organisationId, propertyId },
      orderBy: { startDate: 'desc' },
    });
    return periods.map(toView);
  }

  /** Finds the OPEN period (if any) covering a given effective date — the
   * lookup LedgerPostingService uses to resolve where a posting lands.
   * Returns null rather than throwing; the caller decides what a missing
   * period means (reject the posting). */
  async findCoveringPeriod(
    client: PrismaClient | Prisma.TransactionClient,
    propertyId: string,
    effectiveDate: Date,
  ) {
    return client.accountingPeriod.findFirst({
      where: { propertyId, startDate: { lte: effectiveDate }, endDate: { gte: effectiveDate } },
    });
  }

  async create(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    input: CreateAccountingPeriodInput,
  ): Promise<AccountingPeriodView> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const configuration = await this.getConfiguration(tx, propertyId);
      await tx.$queryRaw`SELECT id FROM "financial_configurations" WHERE id = ${configuration.id} FOR UPDATE`;

      const start = parseDateOnly(input.startDate);
      const end = parseDateOnly(input.endDate);
      if (end.getTime() <= start.getTime()) {
        throw new ValidationError('endDate must be after startDate.');
      }

      const existing = await tx.accountingPeriod.findMany({
        where: { propertyId },
        select: { startDate: true, endDate: true },
      });
      for (const period of existing) {
        const overlaps =
          start.getTime() <= period.endDate.getTime() &&
          period.startDate.getTime() <= end.getTime();
        if (overlaps) {
          throw new ConflictError(
            `This period overlaps with an existing accounting period (${formatDateOnly(period.startDate)} – ${formatDateOnly(period.endDate)}).`,
          );
        }
      }

      const period = await withPublicReference('PER', (publicReference) =>
        tx.accountingPeriod.create({
          data: {
            publicReference,
            organisationId,
            propertyId,
            financialConfigurationId: configuration.id,
            startDate: start,
            endDate: end,
          },
        }),
      );

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'FINANCIAL_PERIOD_OPENED',
        entityType: 'AccountingPeriod',
        entityId: period.id,
        title: `Accounting period opened: ${formatDateOnly(start)} – ${formatDateOnly(end)}`,
      });

      return toView(period);
    });
  }

  /** financials.approve only — see the capability's own doc comment.
   * Idempotent for an already-closed period. Closing does not itself
   * check for unposted/unreconciled items in M16.2.2 (no sub-ledger
   * producers exist yet to check); that checklist item is explicitly
   * deferred to M16.4/M16.5, which will extend this method rather than
   * replace it. */
  async close(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    periodId: string,
    input: CloseAccountingPeriodInput,
  ): Promise<AccountingPeriodView> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const configuration = await this.getConfiguration(tx, propertyId);
      await tx.$queryRaw`SELECT id FROM "financial_configurations" WHERE id = ${configuration.id} FOR UPDATE`;

      const period = await this.getOwnedPeriod(tx, organisationId, propertyId, periodId);
      if (period.status === 'CLOSED') {
        return toView(period);
      }

      const updated = await tx.accountingPeriod.update({
        where: { id: period.id },
        data: { status: 'CLOSED', closedByUserId: actorUserId, closedAt: new Date() },
      });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'FINANCIAL_PERIOD_CLOSED',
        entityType: 'AccountingPeriod',
        entityId: period.id,
        title: `Accounting period closed: ${formatDateOnly(period.startDate)} – ${formatDateOnly(period.endDate)}`,
        description: input.reason ?? null,
      });

      return toView(updated);
    });
  }

  /** financials.approve only. A separate, equally-audited action from
   * close — never an automatic undo. Requires a reason (unlike close,
   * which doesn't) since reopening a closed period is the more
   * consequential of the two. */
  async reopen(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    periodId: string,
    input: ReopenAccountingPeriodInput,
  ): Promise<AccountingPeriodView> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const configuration = await this.getConfiguration(tx, propertyId);
      await tx.$queryRaw`SELECT id FROM "financial_configurations" WHERE id = ${configuration.id} FOR UPDATE`;

      const period = await this.getOwnedPeriod(tx, organisationId, propertyId, periodId);
      if (period.status !== 'CLOSED') {
        throw new ConflictError('Only a closed period can be reopened.');
      }

      const updated = await tx.accountingPeriod.update({
        where: { id: period.id },
        data: { status: 'OPEN', reopenedByUserId: actorUserId, reopenedAt: new Date() },
      });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'FINANCIAL_PERIOD_REOPENED',
        entityType: 'AccountingPeriod',
        entityId: period.id,
        title: `Accounting period reopened: ${formatDateOnly(period.startDate)} – ${formatDateOnly(period.endDate)}`,
        description: input.reason,
      });

      return toView(updated);
    });
  }
}

function toView(period: {
  id: string;
  publicReference: string;
  startDate: Date;
  endDate: Date;
  status: AccountingPeriodStatus;
  closedByUserId: string | null;
  closedAt: Date | null;
  reopenedByUserId: string | null;
  reopenedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AccountingPeriodView {
  return {
    id: period.id,
    publicReference: period.publicReference,
    startDate: formatDateOnly(period.startDate),
    endDate: formatDateOnly(period.endDate),
    status: period.status,
    closedByUserId: period.closedByUserId,
    closedAt: period.closedAt ? period.closedAt.toISOString() : null,
    reopenedByUserId: period.reopenedByUserId,
    reopenedAt: period.reopenedAt ? period.reopenedAt.toISOString() : null,
    createdAt: period.createdAt.toISOString(),
    updatedAt: period.updatedAt.toISOString(),
  };
}
