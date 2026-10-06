import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  FinancialBudget,
  FinancialBudgetLine,
  FinancialBudgetSource,
  FinancialBudgetStatus,
} from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/AppError.js';
import { formatDateOnly, parseDateOnly } from '../../lib/dateOnly.js';
import { buildPublicReference, withPublicReference } from '../../lib/public-reference.js';
import { recordActivity } from '../activity/activity.js';
import type {
  AddBudgetLineInput,
  ApproveBudgetInput,
  CreateBudgetInput,
  CreateBudgetRevisionInput,
  UpdateBudgetLineInput,
  UpdateBudgetMetadataInput,
} from './budgets.schemas.js';

/** A leap-year boundary can shift a same-cadence financial year's exact
 * day-count by 1 (e.g. a July-June year that does vs. doesn't contain 29
 * Feb) — this tolerance absorbs that without allowing a genuinely
 * different-length (e.g. quarterly, or two-year) period through. See
 * FinancialBudgetsService.validatePeriod. */
const FINANCIAL_YEAR_SPAN_TOLERANCE_DAYS = 2;

type BudgetWithLines = FinancialBudget & { lines: FinancialBudgetLine[] };

export interface BudgetLineView {
  id: string;
  publicReference: string;
  financialFundId: string;
  fundPublicReference: string;
  fundType: string;
  fundName: string;
  category: string;
  description: string | null;
  plannedAmount: string;
  notes: string | null;
  sortOrder: number;
}

export interface BudgetFundTotal {
  financialFundId: string;
  fundPublicReference: string;
  fundType: string;
  fundName: string;
  total: string;
}

export interface BudgetView {
  id: string;
  publicReference: string;
  financialYearStartDate: string;
  financialYearEndDate: string;
  version: number;
  status: FinancialBudgetStatus;
  source: FinancialBudgetSource;
  currencyCode: string;
  notes: string | null;
  externalApprovalDate: string | null;
  externalApprovalReference: string | null;
  createdByUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  activatedAt: string | null;
  supersededAt: string | null;
  revisionOfBudgetId: string | null;
  createdAt: string;
  updatedAt: string;
  totalBudget: string;
  totalsByFund: BudgetFundTotal[];
  lines: BudgetLineView[];
}

/**
 * M16.2 — Budget Management. Builds on M16.1's FinancialConfiguration/
 * FinancialFund — see prisma/schema.prisma's "Strata Financial Management:
 * Budgets" section doc comment for the three load-bearing design decisions
 * (no stored totals, immutable history past DRAFT, financial-year identity
 * via the date pair rather than a separate entity) every method here
 * upholds.
 */
export class FinancialBudgetsService {
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

  /** Every mutating method requires financial setup to already be ACTIVE —
   * a budget is a post-onboarding concept; M16.1's opening position must
   * be locked in first. Returns the configuration since its currencyCode/
   * financial-year fields are needed by most callers. */
  private async getActiveConfiguration(
    client: PrismaClient | Prisma.TransactionClient,
    propertyId: string,
  ) {
    const configuration = await client.financialConfiguration.findUnique({ where: { propertyId } });
    if (!configuration) {
      throw new ConflictError(
        'Set up and activate financial management for this property before creating a budget.',
      );
    }
    if (configuration.status !== 'ACTIVE') {
      throw new ConflictError(
        'Financial management must be ACTIVE (opening position confirmed) before a budget can be created.',
      );
    }
    return configuration;
  }

  private async getOwnedBudget(
    client: PrismaClient | Prisma.TransactionClient,
    organisationId: string,
    propertyId: string,
    budgetId: string,
  ): Promise<BudgetWithLines> {
    const budget = await client.financialBudget.findFirst({
      where: { id: budgetId, organisationId, propertyId },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!budget) {
      throw new NotFoundError('Budget not found');
    }
    return budget;
  }

  /** Every mutating line/metadata method but create()/approve()/activate()/
   * createRevision() calls this first — a budget is freely editable only
   * while DRAFT (Section 5 of the M16.2 requirements: "Never allow silent
   * mutation of an approved/active budget"). */
  private assertDraft(budget: { status: FinancialBudgetStatus }): void {
    if (budget.status !== 'DRAFT') {
      throw new ConflictError(
        'This budget is no longer a draft and can’t be edited directly. Create a revision to make changes.',
      );
    }
  }

  /** Section 7: a budget's period must be tied to the scheme's established
   * financial-year cadence, never an arbitrary one, and must not overlap
   * any other financial year already budgeted for this property. Does NOT
   * require an exact match to the configuration's CURRENT dates — that
   * would make it impossible to ever budget a successive year — only that
   * the period's length matches the established cadence (within a leap-day
   * tolerance) and that it doesn't collide with an existing budget's
   * period. */
  private async validatePeriod(
    client: PrismaClient | Prisma.TransactionClient,
    propertyId: string,
    configuration: { financialYearStartDate: Date | null; financialYearEndDate: Date | null },
    start: Date,
    end: Date,
  ): Promise<void> {
    if (end.getTime() <= start.getTime()) {
      throw new ValidationError('financialYearEndDate must be after financialYearStartDate.');
    }

    if (configuration.financialYearStartDate && configuration.financialYearEndDate) {
      const configuredSpanDays = diffDays(
        configuration.financialYearEndDate,
        configuration.financialYearStartDate,
      );
      const requestedSpanDays = diffDays(end, start);
      if (Math.abs(requestedSpanDays - configuredSpanDays) > FINANCIAL_YEAR_SPAN_TOLERANCE_DAYS) {
        throw new ValidationError(
          `This period (${requestedSpanDays} days) doesn’t match this scheme’s established financial year length (${configuredSpanDays} days).`,
        );
      }
    }

    const existingPeriods = await client.financialBudget.findMany({
      where: { propertyId },
      distinct: ['financialYearStartDate', 'financialYearEndDate'],
      select: { financialYearStartDate: true, financialYearEndDate: true },
    });
    for (const period of existingPeriods) {
      const sameExactPeriod =
        period.financialYearStartDate.getTime() === start.getTime() &&
        period.financialYearEndDate.getTime() === end.getTime();
      if (sameExactPeriod) continue;
      const overlaps =
        start.getTime() < period.financialYearEndDate.getTime() &&
        period.financialYearStartDate.getTime() < end.getTime();
      if (overlaps) {
        throw new ConflictError(
          `This period overlaps with another financial year already budgeted for this property (${formatDateOnly(period.financialYearStartDate)} – ${formatDateOnly(period.financialYearEndDate)}).`,
        );
      }
    }
  }

  async list(organisationId: string, propertyId: string): Promise<BudgetView[]> {
    await this.getOwnedProperty(organisationId, propertyId);
    const budgets = await this.prisma.financialBudget.findMany({
      where: { organisationId, propertyId },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
      orderBy: [{ financialYearStartDate: 'desc' }, { version: 'desc' }],
    });
    const fundsById = await this.fundsById(propertyId);
    return budgets.map((b) => this.toView(b, fundsById));
  }

  async getById(organisationId: string, propertyId: string, budgetId: string): Promise<BudgetView> {
    await this.getOwnedProperty(organisationId, propertyId);
    const budget = await this.getOwnedBudget(this.prisma, organisationId, propertyId, budgetId);
    const fundsById = await this.fundsById(propertyId);
    return this.toView(budget, fundsById);
  }

  /** The one place a FinancialBudget row is created for a brand-new
   * financial year (version 1). A second `create` call for a financial
   * year that already has a budget — in ANY status, including a DRAFT or
   * SUPERSEDED one — is rejected; amending an existing financial year's
   * budget is always createRevision, never a second independent create
   * (see this class's doc comment on immutable history / versioning). */
  async create(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    input: CreateBudgetInput,
  ): Promise<BudgetView> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const configuration = await this.getActiveConfiguration(tx, propertyId);
      const start = parseDateOnly(input.financialYearStartDate);
      const end = parseDateOnly(input.financialYearEndDate);
      await this.validatePeriod(tx, propertyId, configuration, start, end);

      const existing = await tx.financialBudget.findFirst({
        where: { propertyId, financialYearStartDate: start, financialYearEndDate: end },
      });
      if (existing) {
        throw new ConflictError(
          'A budget already exists for this financial year. Create a revision instead of a new budget.',
        );
      }

      let budget: FinancialBudget;
      try {
        budget = await withPublicReference('BUD', (publicReference) =>
          tx.financialBudget.create({
            data: {
              publicReference,
              organisationId,
              propertyId,
              financialConfigurationId: configuration.id,
              financialYearStartDate: start,
              financialYearEndDate: end,
              version: 1,
              status: 'DRAFT',
              source: input.source,
              currencyCode: configuration.currencyCode as string,
              notes: input.notes ?? null,
              createdByUserId: actorUserId,
            },
          }),
        );
      } catch (err) {
        if (isUniqueConstraintViolation(err)) {
          throw new ConflictError(
            'A budget already exists for this financial year. Create a revision instead of a new budget.',
          );
        }
        throw err;
      }

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'FINANCIAL_BUDGET_CREATED',
        entityType: 'FinancialBudget',
        entityId: budget.id,
        title: `Budget drafted for ${formatDateOnly(start)} – ${formatDateOnly(end)}`,
      });

      const fundsById = await this.fundsById(propertyId);
      return this.toView({ ...budget, lines: [] }, fundsById);
    });
  }

  async updateMetadata(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    budgetId: string,
    input: UpdateBudgetMetadataInput,
  ): Promise<BudgetView> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const budget = await this.getOwnedBudget(tx, organisationId, propertyId, budgetId);
      this.assertDraft(budget);

      const updated = await tx.financialBudget.update({
        where: { id: budget.id },
        data: { notes: input.notes === undefined ? undefined : input.notes },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });

      const fundsById = await this.fundsById(propertyId);
      return this.toView(updated, fundsById);
    });
  }

  async addLine(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    budgetId: string,
    input: AddBudgetLineInput,
  ): Promise<BudgetView> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const budget = await this.getOwnedBudget(tx, organisationId, propertyId, budgetId);
      this.assertDraft(budget);

      const fund = await tx.financialFund.findFirst({
        where: {
          id: input.financialFundId,
          organisationId,
          propertyId,
          financialConfigurationId: budget.financialConfigurationId,
        },
      });
      if (!fund) {
        throw new NotFoundError('Fund not found');
      }

      const maxSortOrder = budget.lines.reduce((max, l) => Math.max(max, l.sortOrder), -1);

      await withPublicReference('BUDL', (publicReference) =>
        tx.financialBudgetLine.create({
          data: {
            publicReference,
            organisationId,
            propertyId,
            budgetId: budget.id,
            financialFundId: fund.id,
            category: input.category,
            description: input.description ?? null,
            plannedAmount: input.plannedAmount,
            notes: input.notes ?? null,
            sortOrder: maxSortOrder + 1,
          },
        }),
      );

      const refreshed = await this.getOwnedBudget(tx, organisationId, propertyId, budgetId);
      const fundsById = await this.fundsById(propertyId);
      return this.toView(refreshed, fundsById);
    });
  }

  async updateLine(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    budgetId: string,
    lineId: string,
    input: UpdateBudgetLineInput,
  ): Promise<BudgetView> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const budget = await this.getOwnedBudget(tx, organisationId, propertyId, budgetId);
      this.assertDraft(budget);

      const line = budget.lines.find((l) => l.id === lineId);
      if (!line) {
        throw new NotFoundError('Budget line not found');
      }

      await tx.financialBudgetLine.update({
        where: { id: line.id },
        data: {
          category: input.category,
          description: input.description === undefined ? undefined : input.description,
          plannedAmount: input.plannedAmount,
          notes: input.notes === undefined ? undefined : input.notes,
          sortOrder: input.sortOrder,
        },
      });

      const refreshed = await this.getOwnedBudget(tx, organisationId, propertyId, budgetId);
      const fundsById = await this.fundsById(propertyId);
      return this.toView(refreshed, fundsById);
    });
  }

  async deleteLine(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    budgetId: string,
    lineId: string,
  ): Promise<BudgetView> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const budget = await this.getOwnedBudget(tx, organisationId, propertyId, budgetId);
      this.assertDraft(budget);

      const line = budget.lines.find((l) => l.id === lineId);
      if (!line) {
        throw new NotFoundError('Budget line not found');
      }

      await tx.financialBudgetLine.delete({ where: { id: line.id } });

      const refreshed = await this.getOwnedBudget(tx, organisationId, propertyId, budgetId);
      const fundsById = await this.fundsById(propertyId);
      return this.toView(refreshed, fundsById);
    });
  }

  /**
   * DRAFT -> APPROVED. Requires at least one line — an empty budget has no
   * meaningful funding requirement to approve. For an IMPORTED budget,
   * records the scheme's own pre-WaslProp approval context rather than
   * pretending WaslProp witnessed it (see FinancialBudget.
   * externalApprovalDate's doc comment); for a CREATED budget, this IS a
   * genuine approval-within-WaslProp action.
   */
  async approve(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    budgetId: string,
    input: ApproveBudgetInput,
  ): Promise<BudgetView> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const budget = await this.getOwnedBudget(tx, organisationId, propertyId, budgetId);
      if (budget.status !== 'DRAFT') {
        throw new ConflictError('Only a draft budget can be approved.');
      }
      if (budget.lines.length === 0) {
        throw new ValidationError('A budget needs at least one line before it can be approved.');
      }

      if (budget.source === 'IMPORTED') {
        if (!input.externalApprovalDate) {
          throw new ValidationError(
            'externalApprovalDate is required for an imported budget — the date the scheme itself approved it.',
          );
        }
      } else if (input.externalApprovalDate || input.externalApprovalReference) {
        throw new ValidationError(
          'externalApprovalDate/externalApprovalReference only apply to an imported budget.',
        );
      }

      const externalApprovalDate = input.externalApprovalDate
        ? parseDateOnly(input.externalApprovalDate)
        : null;
      if (externalApprovalDate && externalApprovalDate.getTime() > Date.now()) {
        throw new ValidationError('externalApprovalDate cannot be in the future.');
      }

      const updated = await tx.financialBudget.update({
        where: { id: budget.id },
        data: {
          status: 'APPROVED',
          approvedByUserId: actorUserId,
          approvedAt: new Date(),
          externalApprovalDate,
          externalApprovalReference: input.externalApprovalReference ?? null,
        },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType:
          budget.source === 'IMPORTED'
            ? 'FINANCIAL_BUDGET_IMPORT_RECORDED'
            : 'FINANCIAL_BUDGET_APPROVED',
        entityType: 'FinancialBudget',
        entityId: budget.id,
        title:
          budget.source === 'IMPORTED'
            ? `Imported budget recorded for ${formatDateOnly(budget.financialYearStartDate)} – ${formatDateOnly(budget.financialYearEndDate)}`
            : `Budget approved for ${formatDateOnly(budget.financialYearStartDate)} – ${formatDateOnly(budget.financialYearEndDate)}`,
      });

      const fundsById = await this.fundsById(propertyId);
      return this.toView(updated, fundsById);
    });
  }

  /**
   * APPROVED -> ACTIVE. Locks the property's FinancialConfiguration row
   * for the duration of the transaction (Section 6 — "transactional
   * locking where appropriate") so two concurrent activation attempts for
   * the same property can never both decide "nothing is currently active"
   * and both proceed: whichever acquires the lock first fully supersedes-
   * then-promotes before the second even reads the current state. The
   * hand-written partial unique index on (propertyId,
   * financialYearStartDate, financialYearEndDate) WHERE status = 'ACTIVE'
   * is the second, independent layer of defense — see that migration's
   * doc comment.
   */
  async activate(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    budgetId: string,
  ): Promise<BudgetView> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const configuration = await tx.financialConfiguration.findUnique({ where: { propertyId } });
      if (!configuration) {
        throw new NotFoundError('Budget not found');
      }
      await tx.$queryRaw`SELECT id FROM "financial_configurations" WHERE id = ${configuration.id} FOR UPDATE`;

      const budget = await this.getOwnedBudget(tx, organisationId, propertyId, budgetId);
      if (budget.status === 'ACTIVE') {
        const fundsById = await this.fundsById(propertyId);
        return this.toView(budget, fundsById);
      }
      if (budget.status !== 'APPROVED') {
        throw new ConflictError('Only an approved budget can be activated.');
      }

      const currentlyActive = await tx.financialBudget.findFirst({
        where: {
          propertyId,
          status: 'ACTIVE',
          financialYearStartDate: budget.financialYearStartDate,
          financialYearEndDate: budget.financialYearEndDate,
          NOT: { id: budget.id },
        },
      });
      if (currentlyActive) {
        await tx.financialBudget.update({
          where: { id: currentlyActive.id },
          data: { status: 'SUPERSEDED', supersededAt: new Date() },
        });
      }

      const updated = await tx.financialBudget.update({
        where: { id: budget.id },
        data: { status: 'ACTIVE', activatedAt: new Date() },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'FINANCIAL_BUDGET_ACTIVATED',
        entityType: 'FinancialBudget',
        entityId: budget.id,
        title: `Budget activated for ${formatDateOnly(budget.financialYearStartDate)} – ${formatDateOnly(budget.financialYearEndDate)}`,
      });

      const fundsById = await this.fundsById(propertyId);
      return this.toView(updated, fundsById);
    });
  }

  /**
   * Creates the next version (DRAFT) of an APPROVED or ACTIVE budget,
   * copying its lines as a starting point — the source budget itself is
   * never modified (Section 12 — "We should not edit v1. Create ... v2.").
   * Version numbers are assigned from the current max in the financial-year
   * group, with a bounded retry on a unique-constraint collision so two
   * concurrent "revise" calls can never both produce the same version
   * number (same collision-retry idiom as withPublicReference).
   */
  async createRevision(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    budgetId: string,
    input: CreateBudgetRevisionInput,
    maxAttempts = 5,
  ): Promise<BudgetView> {
    await this.getOwnedProperty(organisationId, propertyId);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const source = await this.getOwnedBudget(tx, organisationId, propertyId, budgetId);
          if (source.status !== 'APPROVED' && source.status !== 'ACTIVE') {
            throw new ConflictError('Only an approved or active budget can be revised.');
          }

          const maxVersion = await tx.financialBudget.aggregate({
            where: {
              propertyId,
              financialYearStartDate: source.financialYearStartDate,
              financialYearEndDate: source.financialYearEndDate,
            },
            _max: { version: true },
          });
          const nextVersion = (maxVersion._max.version ?? source.version) + 1;

          const revision = await withPublicReference('BUD', (publicReference) =>
            tx.financialBudget.create({
              data: {
                publicReference,
                organisationId,
                propertyId,
                financialConfigurationId: source.financialConfigurationId,
                financialYearStartDate: source.financialYearStartDate,
                financialYearEndDate: source.financialYearEndDate,
                version: nextVersion,
                status: 'DRAFT',
                source: 'CREATED',
                currencyCode: source.currencyCode,
                notes: input.notes ?? null,
                createdByUserId: actorUserId,
                revisionOfBudgetId: source.id,
              },
            }),
          );

          if (source.lines.length > 0) {
            // A plain buildPublicReference per row, not withPublicReference's
            // retry-on-collision wrapper: createMany has no per-row result to
            // retry against, and with a 32-character, 6-length alphabet a
            // real collision is astronomically unlikely (see that helper's
            // own doc comment) — acceptable for this batch-copy path.
            await tx.financialBudgetLine.createMany({
              data: source.lines.map((line) => ({
                publicReference: buildPublicReference('BUDL'),
                organisationId,
                propertyId,
                budgetId: revision.id,
                financialFundId: line.financialFundId,
                category: line.category,
                description: line.description,
                plannedAmount: line.plannedAmount,
                notes: line.notes,
                sortOrder: line.sortOrder,
              })),
            });
          }

          await recordActivity(tx, {
            organisationId,
            propertyId,
            actorUserId,
            eventType: 'FINANCIAL_BUDGET_REVISED',
            entityType: 'FinancialBudget',
            entityId: revision.id,
            title: `Budget revised to v${nextVersion} for ${formatDateOnly(source.financialYearStartDate)} – ${formatDateOnly(source.financialYearEndDate)}`,
          });

          const refreshed = await this.getOwnedBudget(tx, organisationId, propertyId, revision.id);
          const fundsById = await this.fundsById(propertyId);
          return this.toView(refreshed, fundsById);
        });
      } catch (err) {
        if (isUniqueConstraintViolation(err) && attempt < maxAttempts) continue;
        throw err;
      }
    }
    /* istanbul ignore next -- unreachable: the loop above always returns or throws */
    throw new Error('createRevision: exhausted retry attempts');
  }

  private async fundsById(
    propertyId: string,
  ): Promise<Map<string, { publicReference: string; fundType: string; name: string }>> {
    const funds = await this.prisma.financialFund.findMany({
      where: { propertyId },
      select: { id: true, publicReference: true, fundType: true, name: true },
    });
    return new Map(funds.map((f) => [f.id, f]));
  }

  private toView(
    budget: BudgetWithLines,
    fundsById: Map<string, { publicReference: string; fundType: string; name: string }>,
  ): BudgetView {
    const totalBudget = budget.lines
      .reduce((sum, l) => sum.plus(l.plannedAmount), new Prisma.Decimal(0))
      .toFixed(2);

    const totalsByFundMap = new Map<string, Prisma.Decimal>();
    for (const line of budget.lines) {
      const running = totalsByFundMap.get(line.financialFundId) ?? new Prisma.Decimal(0);
      totalsByFundMap.set(line.financialFundId, running.plus(line.plannedAmount));
    }
    const totalsByFund: BudgetFundTotal[] = Array.from(totalsByFundMap.entries()).map(
      ([financialFundId, total]) => {
        const fund = fundsById.get(financialFundId);
        return {
          financialFundId,
          fundPublicReference: fund?.publicReference ?? '',
          fundType: fund?.fundType ?? '',
          fundName: fund?.name ?? 'Unknown fund',
          total: total.toFixed(2),
        };
      },
    );

    return {
      id: budget.id,
      publicReference: budget.publicReference,
      financialYearStartDate: formatDateOnly(budget.financialYearStartDate),
      financialYearEndDate: formatDateOnly(budget.financialYearEndDate),
      version: budget.version,
      status: budget.status,
      source: budget.source,
      currencyCode: budget.currencyCode,
      notes: budget.notes,
      externalApprovalDate: budget.externalApprovalDate
        ? formatDateOnly(budget.externalApprovalDate)
        : null,
      externalApprovalReference: budget.externalApprovalReference,
      createdByUserId: budget.createdByUserId,
      approvedByUserId: budget.approvedByUserId,
      approvedAt: budget.approvedAt ? budget.approvedAt.toISOString() : null,
      activatedAt: budget.activatedAt ? budget.activatedAt.toISOString() : null,
      supersededAt: budget.supersededAt ? budget.supersededAt.toISOString() : null,
      revisionOfBudgetId: budget.revisionOfBudgetId,
      createdAt: budget.createdAt.toISOString(),
      updatedAt: budget.updatedAt.toISOString(),
      totalBudget,
      totalsByFund,
      lines: budget.lines.map((line) => {
        const fund = fundsById.get(line.financialFundId);
        return {
          id: line.id,
          publicReference: line.publicReference,
          financialFundId: line.financialFundId,
          fundPublicReference: fund?.publicReference ?? '',
          fundType: fund?.fundType ?? '',
          fundName: fund?.name ?? 'Unknown fund',
          category: line.category,
          description: line.description,
          plannedAmount: line.plannedAmount.toFixed(2),
          notes: line.notes,
          sortOrder: line.sortOrder,
        };
      }),
    };
  }
}

function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  );
}
