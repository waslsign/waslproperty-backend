import type { FinancialFundType, FinancialSetupStatus, Prisma, PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import { formatDateOnly, parseDateOnly } from '../../lib/dateOnly.js';
import { withPublicReference } from '../../lib/public-reference.js';
import { recordActivity } from '../activity/activity.js';
import type {
  AddFundInput,
  BulkSetLotOpeningPositionsInput,
  StartFinancialSetupInput,
  UpdateFinancialYearInput,
  UpdateFundInput,
} from './financials.schemas.js';

const DEFAULT_FUND_NAME: Record<Exclude<FinancialFundType, 'OTHER'>, string> = {
  ADMINISTRATION: 'Administration Fund',
  CAPITAL_WORKS: 'Capital Works Fund',
};

export interface FinancialFundSummary {
  id: string;
  publicReference: string;
  fundType: FinancialFundType;
  name: string;
  currencyCode: string;
  openingBalance: {
    id: string;
    publicReference: string;
    amount: string;
    asOfDate: string;
    currencyCode: string;
    referenceNote: string | null;
  } | null;
}

export interface LotOpeningPositionSummary {
  spaceId: string;
  spacePublicReference: string;
  spaceName: string;
  spaceCode: string;
  lotNumber: string | null;
  recorded: boolean;
  amountOwing: string;
  creditBalance: string;
  asOfDate: string | null;
  currencyCode: string | null;
  referenceNote: string | null;
}

export interface FinancialSummary {
  status: FinancialSetupStatus;
  publicReference: string | null;
  currencyCode: string | null;
  financialYearStartDate: string | null;
  financialYearEndDate: string | null;
  cutoverDate: string | null;
  activatedAt: string | null;
  activatedByUserId: string | null;
  funds: FinancialFundSummary[];
  lotPositions: LotOpeningPositionSummary[];
  lotPositionsRecordedCount: number;
  lotPositionsTotalCount: number;
}

export interface ReconciliationIssue {
  /** A stable machine-readable code (e.g. "STRATA_NOT_ACTIVE") — the
   * frontend keys UI (icons/links) off this, never off the message text. */
  code: string;
  message: string;
  details?: unknown;
}

export interface ReconciliationReport {
  errors: ReconciliationIssue[];
  warnings: ReconciliationIssue[];
  infos: ReconciliationIssue[];
  /** errors.length === 0 — computed once here so the frontend/activate()
   * never re-derive it independently and risk disagreeing. */
  readyToActivate: boolean;
}

/** The NOT_CONFIGURED shape returned when a property has no
 * FinancialConfiguration row at all — see this module's doc comment on why
 * that absence, not a stored NOT_CONFIGURED row, is the real representation. */
function notConfiguredSummary(): FinancialSummary {
  return {
    status: 'NOT_CONFIGURED',
    publicReference: null,
    currencyCode: null,
    financialYearStartDate: null,
    financialYearEndDate: null,
    cutoverDate: null,
    activatedAt: null,
    activatedByUserId: null,
    funds: [],
    lotPositions: [],
    lotPositionsRecordedCount: 0,
    lotPositionsTotalCount: 0,
  };
}

/**
 * M16.1 — Strata Financial Management foundation: financial onboarding and
 * the trustworthy opening position for an existing strata scheme being
 * migrated into WaslProp. See prisma/schema.prisma's "Strata Financial
 * Management" section doc comment for the three load-bearing design
 * decisions (no mutable running balance, long-lived Fund vs one-time
 * OpeningBalance snapshot, separate amountOwing/creditBalance columns)
 * this service exists to uphold — every method below enforces them, not
 * just the schema shape.
 *
 * Mirrors StrataService's structure deliberately: a FinancialConfiguration
 * is NEVER auto-created or auto-activated (see Section 16 of the M16.1
 * requirements), setup is idempotent step-by-step exactly like the strata
 * "Enable Strata Management" flow, and activation is one explicit,
 * irreversible-in-M16.1 action gated by a deterministic reconciliation
 * check (getReconciliation) — never automatic after data entry.
 */
export class FinancialsService {
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

  private async getConfiguration(
    client: PrismaClient | Prisma.TransactionClient,
    propertyId: string,
  ) {
    return client.financialConfiguration.findUnique({ where: { propertyId } });
  }

  /** Every mutating method but startSetup calls this first — once ACTIVE,
   * the financial year, funds, and lot opening positions are all
   * historically fixed (Section 4.B — IMMUTABILITY). Future corrections
   * are a FinancialAdjustment (M16.2+), never a write to these rows. */
  private assertMutable(configuration: { status: FinancialSetupStatus }): void {
    if (configuration.status === 'ACTIVE') {
      throw new ConflictError(
        'This scheme’s financial opening position is already active and historically fixed. ' +
          'Corrections are made as a formal adjustment, not an edit to the opening setup.',
      );
    }
  }

  async getSummary(organisationId: string, propertyId: string): Promise<FinancialSummary> {
    await this.getOwnedProperty(organisationId, propertyId);
    return this.buildSummary(this.prisma, organisationId, propertyId);
  }

  /**
   * Step 1 of the guided flow, and the only place a FinancialConfiguration
   * row is ever created — never auto-created for an existing property by a
   * migration (Section 16). Idempotent: safe to call again while
   * SETUP_IN_PROGRESS (applies any newly-provided date fields, same as
   * StrataService.enable); rejected once ACTIVE via assertMutable.
   */
  async startSetup(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    input: StartFinancialSetupInput,
  ): Promise<FinancialSummary> {
    await this.getOwnedProperty(organisationId, propertyId);
    const organisation = await this.prisma.organisation.findUniqueOrThrow({
      where: { id: organisationId },
      select: { currencyCode: true },
    });

    return this.prisma.$transaction(async (tx) => {
      const existing = await this.getConfiguration(tx, propertyId);
      if (existing) {
        this.assertMutable(existing);
        await tx.financialConfiguration.update({
          where: { id: existing.id },
          data: dateFieldsFromInput(input),
        });
      } else {
        await withPublicReference('FIN', (publicReference) =>
          tx.financialConfiguration.create({
            data: {
              publicReference,
              organisationId,
              propertyId,
              status: 'SETUP_IN_PROGRESS',
              currencyCode: organisation.currencyCode,
              ...dateFieldsFromInput(input),
            },
          }),
        );

        await recordActivity(tx, {
          organisationId,
          propertyId,
          actorUserId,
          eventType: 'FINANCIAL_SETUP_STARTED',
          entityType: 'Property',
          entityId: propertyId,
          title: 'Financial management setup started',
        });
      }

      return this.buildSummary(tx, organisationId, propertyId);
    });
  }

  /** Updating the financial year/cutover fields at any point while
   * SETUP_IN_PROGRESS — requires setup to have been started first (never
   * implicitly starts it), same precondition shape as
   * StrataService.updatePlan. */
  async updateFinancialYear(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    input: UpdateFinancialYearInput,
  ): Promise<FinancialSummary> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const configuration = await this.getConfiguration(tx, propertyId);
      if (!configuration) {
        throw new ConflictError(
          'Start financial setup for this property before configuring its financial year',
        );
      }
      this.assertMutable(configuration);

      await tx.financialConfiguration.update({
        where: { id: configuration.id },
        data: dateFieldsFromInput(input),
      });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'FINANCIAL_YEAR_CONFIGURED',
        entityType: 'Property',
        entityId: propertyId,
        title: 'Financial year updated',
      });

      return this.buildSummary(tx, organisationId, propertyId);
    });
  }

  /**
   * Step 2 — adds one fund, optionally with its opening balance in the
   * same call (Section 6.4/6.5). Administration and Capital Works are
   * rejected as duplicates (service-layer check, not a DB constraint — see
   * the schema's own doc comment on why OTHER stays freely multi-valued).
   */
  async addFund(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    input: AddFundInput,
  ): Promise<FinancialSummary> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const configuration = await this.getConfiguration(tx, propertyId);
      if (!configuration) {
        throw new ConflictError('Start financial setup for this property before adding funds');
      }
      this.assertMutable(configuration);

      if (input.fundType !== 'OTHER') {
        const duplicate = await tx.financialFund.findFirst({
          where: { financialConfigurationId: configuration.id, fundType: input.fundType },
        });
        if (duplicate) {
          throw new ConflictError(
            `A ${DEFAULT_FUND_NAME[input.fundType]} already exists for this property`,
          );
        }
      }

      const name =
        input.name ?? (input.fundType === 'OTHER' ? input.name : DEFAULT_FUND_NAME[input.fundType]);
      const currencyCode = configuration.currencyCode as string;

      const fund = await withPublicReference('FUND', (publicReference) =>
        tx.financialFund.create({
          data: {
            publicReference,
            organisationId,
            propertyId,
            financialConfigurationId: configuration.id,
            fundType: input.fundType,
            name,
            currencyCode,
          },
        }),
      );

      if (input.openingBalance) {
        await withPublicReference('FOB', (publicReference) =>
          tx.financialOpeningBalance.create({
            data: {
              publicReference,
              organisationId,
              propertyId,
              financialFundId: fund.id,
              amount: input.openingBalance!.amount,
              asOfDate: parseDateOnly(input.openingBalance!.asOfDate),
              currencyCode,
              referenceNote: input.openingBalance!.referenceNote ?? null,
              createdByUserId: actorUserId,
            },
          }),
        );
      }

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'FINANCIAL_FUNDS_CONFIGURED',
        entityType: 'Property',
        entityId: propertyId,
        title: `${name} added`,
      });

      return this.buildSummary(tx, organisationId, propertyId);
    });
  }

  /** Editing an existing fund's name and/or (upserting) its opening
   * balance. fundType is never editable here — see the schema's own doc
   * comment. */
  async updateFund(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    fundId: string,
    input: UpdateFundInput,
  ): Promise<FinancialSummary> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const configuration = await this.getConfiguration(tx, propertyId);
      if (!configuration) {
        throw new NotFoundError('Fund not found');
      }
      this.assertMutable(configuration);

      const fund = await tx.financialFund.findFirst({
        where: {
          id: fundId,
          organisationId,
          propertyId,
          financialConfigurationId: configuration.id,
        },
        include: { openingBalance: true },
      });
      if (!fund) {
        throw new NotFoundError('Fund not found');
      }

      if (input.name !== undefined) {
        await tx.financialFund.update({ where: { id: fund.id }, data: { name: input.name } });
      }

      if (input.openingBalance) {
        const balanceData = {
          amount: input.openingBalance.amount,
          asOfDate: parseDateOnly(input.openingBalance.asOfDate),
          referenceNote: input.openingBalance.referenceNote ?? null,
        };
        if (fund.openingBalance) {
          await tx.financialOpeningBalance.update({
            where: { id: fund.openingBalance.id },
            data: balanceData,
          });
        } else {
          await withPublicReference('FOB', (publicReference) =>
            tx.financialOpeningBalance.create({
              data: {
                publicReference,
                organisationId,
                propertyId,
                financialFundId: fund.id,
                currencyCode: fund.currencyCode,
                createdByUserId: actorUserId,
                ...balanceData,
              },
            }),
          );
        }
      }

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'FINANCIAL_FUNDS_CONFIGURED',
        entityType: 'Property',
        entityId: propertyId,
        title: `${fund.name} updated`,
      });

      return this.buildSummary(tx, organisationId, propertyId);
    });
  }

  /**
   * Step 3 — bulk-upserts lot opening positions (Section 6.6), exactly
   * like StrataService.bulkSetLots: the UI naturally edits the whole lot
   * list in one table. Every spaceId must be a real LOT on this property
   * — never Common Property, never cross-property, never unclassified
   * (Section 6.6's "Common Property must not receive an owner levy
   * account" and Section 7's reconciliation checks re-verify this too, as
   * defense in depth against the space being reclassified afterward).
   */
  async bulkSetLotOpeningPositions(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    input: BulkSetLotOpeningPositionsInput,
  ): Promise<FinancialSummary> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const configuration = await this.getConfiguration(tx, propertyId);
      if (!configuration) {
        throw new ConflictError(
          'Start financial setup for this property before recording lot opening positions',
        );
      }
      this.assertMutable(configuration);

      for (const entry of input.positions) {
        const space = await tx.space.findFirst({
          where: { id: entry.spaceId, organisationId, propertyId },
        });
        if (!space) {
          throw new NotFoundError('Space not found');
        }
        if (space.strataClassification !== 'LOT') {
          throw new ConflictError(
            `${space.name} is not a strata lot — an opening financial position can only be recorded for a Lot, never Common Property or an unclassified space`,
          );
        }

        const data = {
          amountOwing: entry.amountOwing,
          creditBalance: entry.creditBalance,
          asOfDate: parseDateOnly(entry.asOfDate),
          currencyCode: configuration.currencyCode as string,
          referenceNote: entry.referenceNote ?? null,
        };

        // find-then-create-or-update rather than Prisma's upsert: the
        // create path needs a fresh, collision-safe publicReference from
        // withPublicReference (see that helper's own doc comment), which
        // an upsert's `create` object has no way to receive, since it
        // isn't produced by a callback the way withPublicReference's
        // `persist` argument requires.
        const existingPosition = await tx.lotOpeningPosition.findUnique({
          where: { spaceId: space.id },
        });
        if (existingPosition) {
          await tx.lotOpeningPosition.update({ where: { id: existingPosition.id }, data });
        } else {
          await withPublicReference('LOP', (publicReference) =>
            tx.lotOpeningPosition.create({
              data: {
                publicReference,
                organisationId,
                propertyId,
                financialConfigurationId: configuration.id,
                spaceId: space.id,
                createdByUserId: actorUserId,
                ...data,
              },
            }),
          );
        }
      }

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'FINANCIAL_LOT_POSITIONS_CONFIGURED',
        entityType: 'Property',
        entityId: propertyId,
        title: `${input.positions.length} lot opening position${input.positions.length === 1 ? '' : 's'} recorded`,
      });

      return this.buildSummary(tx, organisationId, propertyId);
    });
  }

  /**
   * Step 4 — the deterministic Financial Setup Review (Section 7). Pure
   * read, computed fresh every call — never cached, never trusted from a
   * prior call, since activate() re-runs this exact function server-side
   * rather than trusting whatever the client last displayed. Only checks
   * genuinely truthful, available-data rules — no invented accounting
   * equality (e.g. never asserts fund balances must equal lot balances;
   * WaslProp has no independent way to verify that from migration data
   * alone).
   */
  async getReconciliation(
    organisationId: string,
    propertyId: string,
  ): Promise<ReconciliationReport> {
    const property = await this.getOwnedProperty(organisationId, propertyId);
    const configuration = await this.getConfiguration(this.prisma, propertyId);

    const errors: ReconciliationIssue[] = [];
    const warnings: ReconciliationIssue[] = [];
    const infos: ReconciliationIssue[] = [];

    if (!configuration) {
      errors.push({
        code: 'SETUP_NOT_STARTED',
        message: 'Financial setup has not been started for this property.',
      });
      return { errors, warnings, infos, readyToActivate: false };
    }

    if (property.strataStatus !== 'ACTIVE') {
      errors.push({
        code: 'STRATA_NOT_ACTIVE',
        message:
          'This property’s strata scheme must be ACTIVE before financial management can be activated.',
        details: { strataStatus: property.strataStatus },
      });
    }

    const { financialYearStartDate, financialYearEndDate, cutoverDate } = configuration;
    if (!financialYearStartDate || !financialYearEndDate) {
      errors.push({
        code: 'FINANCIAL_YEAR_MISSING',
        message: 'A financial year start and end date are both required.',
      });
    } else if (financialYearEndDate.getTime() <= financialYearStartDate.getTime()) {
      errors.push({
        code: 'FINANCIAL_YEAR_INVALID',
        message: 'The financial year end date must be after the start date.',
      });
    }

    if (!cutoverDate) {
      errors.push({
        code: 'CUTOVER_DATE_MISSING',
        message: 'A financial cutover date is required.',
      });
    } else if (financialYearStartDate && financialYearEndDate) {
      if (
        cutoverDate.getTime() < financialYearStartDate.getTime() ||
        cutoverDate.getTime() > financialYearEndDate.getTime()
      ) {
        warnings.push({
          code: 'CUTOVER_DATE_OUTSIDE_FINANCIAL_YEAR',
          message: `The cutover date (${formatDateOnly(cutoverDate)}) falls outside the financial year you entered. Confirm this is intentional.`,
        });
      }
    }

    const funds = await this.prisma.financialFund.findMany({
      where: { financialConfigurationId: configuration.id },
      include: { openingBalance: true },
    });
    const hasAdministration = funds.some((f) => f.fundType === 'ADMINISTRATION');
    const hasCapitalWorks = funds.some((f) => f.fundType === 'CAPITAL_WORKS');
    if (!hasAdministration) {
      errors.push({
        code: 'ADMINISTRATION_FUND_MISSING',
        message: 'An Administration Fund is required.',
      });
    }
    if (!hasCapitalWorks) {
      errors.push({
        code: 'CAPITAL_WORKS_FUND_MISSING',
        message: 'A Capital Works Fund is required.',
      });
    }

    for (const fund of funds) {
      if (configuration.currencyCode && fund.currencyCode !== configuration.currencyCode) {
        errors.push({
          code: 'FUND_CURRENCY_MISMATCH',
          message: `${fund.name}'s currency (${fund.currencyCode}) does not match this scheme's currency (${configuration.currencyCode}).`,
        });
      }
      if (fund.openingBalance && Number(fund.openingBalance.amount) < 0) {
        errors.push({
          code: 'NEGATIVE_FUND_BALANCE',
          message: `${fund.name}'s opening balance cannot be negative.`,
        });
      }
    }

    const lots = await this.prisma.space.findMany({
      where: { propertyId, strataClassification: 'LOT' },
      include: { lotOpeningPosition: true },
    });
    const recordedLots = lots.filter((l) => l.lotOpeningPosition);
    const unrecordedCount = lots.length - recordedLots.length;
    if (unrecordedCount > 0) {
      warnings.push({
        code: 'LOTS_WITHOUT_OPENING_POSITION',
        message: `${unrecordedCount} of ${lots.length} lot${lots.length === 1 ? '' : 's'} have no opening position recorded. This is fine for lots with genuinely no history, but double-check before activating.`,
        details: { unrecordedCount, totalLots: lots.length },
      });
    }
    for (const lot of recordedLots) {
      const position = lot.lotOpeningPosition!;
      if (Number(position.amountOwing) < 0 || Number(position.creditBalance) < 0) {
        errors.push({
          code: 'NEGATIVE_LOT_BALANCE',
          message: `${lot.name}'s opening position has a negative amount.`,
        });
      }
      if (configuration.currencyCode && position.currencyCode !== configuration.currencyCode) {
        errors.push({
          code: 'LOT_CURRENCY_MISMATCH',
          message: `${lot.name}'s opening position currency (${position.currencyCode}) does not match this scheme's currency (${configuration.currencyCode}).`,
        });
      }
    }

    // Defense-in-depth only — structurally guaranteed by every query above
    // already being scoped by propertyId/organisationId, never expected to
    // actually fire; see IDOR/isolation tests, not a runtime check here.

    if (errors.length === 0) {
      infos.push({
        code: 'ALL_CHECKS_PASSED',
        message: 'No errors found — all required checks passed.',
      });
    }

    return { errors, warnings, infos, readyToActivate: errors.length === 0 };
  }

  /**
   * The explicit, deliberate activation action (Section 7 — "Activation
   * must be an explicit user action. No automatic activation after data
   * entry."). Re-runs getReconciliation server-side rather than trusting
   * any client-reported state; idempotent for an already-ACTIVE
   * configuration (mirrors StrataService.completeSetup).
   */
  async activate(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
  ): Promise<FinancialSummary> {
    await this.getOwnedProperty(organisationId, propertyId);
    const configuration = await this.getConfiguration(this.prisma, propertyId);
    if (!configuration) {
      throw new ConflictError('Start financial setup for this property before activating it');
    }
    if (configuration.status === 'ACTIVE') {
      return this.buildSummary(this.prisma, organisationId, propertyId);
    }

    const report = await this.getReconciliation(organisationId, propertyId);
    if (!report.readyToActivate) {
      throw new ConflictError(
        'Cannot activate financial management while reconciliation errors remain.',
        { errors: report.errors },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.financialConfiguration.update({
        where: { id: configuration.id },
        data: { status: 'ACTIVE', activatedAt: new Date(), activatedByUserId: actorUserId },
      });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'FINANCIAL_SETUP_ACTIVATED',
        entityType: 'Property',
        entityId: propertyId,
        title: 'Financial management activated',
      });

      return this.buildSummary(tx, organisationId, propertyId);
    });
  }

  private async buildSummary(
    client: PrismaClient | Prisma.TransactionClient,
    organisationId: string,
    propertyId: string,
  ): Promise<FinancialSummary> {
    const configuration = await client.financialConfiguration.findUnique({
      where: { propertyId },
      include: { funds: { include: { openingBalance: true } } },
    });
    if (!configuration) {
      return notConfiguredSummary();
    }

    const lots = await client.space.findMany({
      where: { organisationId, propertyId, strataClassification: 'LOT' },
      include: { lotOpeningPosition: true },
      orderBy: { lotNumber: 'asc' },
    });

    return {
      status: configuration.status,
      publicReference: configuration.publicReference,
      currencyCode: configuration.currencyCode,
      financialYearStartDate: configuration.financialYearStartDate
        ? formatDateOnly(configuration.financialYearStartDate)
        : null,
      financialYearEndDate: configuration.financialYearEndDate
        ? formatDateOnly(configuration.financialYearEndDate)
        : null,
      cutoverDate: configuration.cutoverDate ? formatDateOnly(configuration.cutoverDate) : null,
      activatedAt: configuration.activatedAt ? configuration.activatedAt.toISOString() : null,
      activatedByUserId: configuration.activatedByUserId,
      funds: configuration.funds.map((fund) => ({
        id: fund.id,
        publicReference: fund.publicReference,
        fundType: fund.fundType,
        name: fund.name,
        currencyCode: fund.currencyCode,
        openingBalance: fund.openingBalance
          ? {
              id: fund.openingBalance.id,
              publicReference: fund.openingBalance.publicReference,
              amount: fund.openingBalance.amount.toString(),
              asOfDate: formatDateOnly(fund.openingBalance.asOfDate),
              currencyCode: fund.openingBalance.currencyCode,
              referenceNote: fund.openingBalance.referenceNote,
            }
          : null,
      })),
      lotPositions: lots.map((lot) => ({
        spaceId: lot.id,
        spacePublicReference: lot.publicReference,
        spaceName: lot.name,
        spaceCode: lot.code,
        lotNumber: lot.lotNumber,
        recorded: !!lot.lotOpeningPosition,
        amountOwing: lot.lotOpeningPosition?.amountOwing.toString() ?? '0',
        creditBalance: lot.lotOpeningPosition?.creditBalance.toString() ?? '0',
        asOfDate: lot.lotOpeningPosition ? formatDateOnly(lot.lotOpeningPosition.asOfDate) : null,
        currencyCode: lot.lotOpeningPosition?.currencyCode ?? null,
        referenceNote: lot.lotOpeningPosition?.referenceNote ?? null,
      })),
      lotPositionsRecordedCount: lots.filter((l) => l.lotOpeningPosition).length,
      lotPositionsTotalCount: lots.length,
    };
  }
}

/** Shared by startSetup/updateFinancialYear — the only difference between
 * them is whether `null` (explicit clear) is accepted; startSetup's input
 * type has no `null` variant, so this always sees `undefined` for "leave
 * alone" there and only ever sees `null` when called from
 * updateFinancialYear. */
interface DateFields {
  financialYearStartDate?: Date | null;
  financialYearEndDate?: Date | null;
  cutoverDate?: Date | null;
}

function dateFieldsFromInput(input: {
  financialYearStartDate?: string | null;
  financialYearEndDate?: string | null;
  cutoverDate?: string | null;
}): DateFields {
  const data: DateFields = {};
  if (input.financialYearStartDate !== undefined) {
    data.financialYearStartDate = input.financialYearStartDate
      ? parseDateOnly(input.financialYearStartDate)
      : null;
  }
  if (input.financialYearEndDate !== undefined) {
    data.financialYearEndDate = input.financialYearEndDate
      ? parseDateOnly(input.financialYearEndDate)
      : null;
  }
  if (input.cutoverDate !== undefined) {
    data.cutoverDate = input.cutoverDate ? parseDateOnly(input.cutoverDate) : null;
  }
  return data;
}
