import { z } from 'zod';
import { registry } from '../registry.js';

/**
 * Response component schemas for the API's core resources.
 *
 * IMPORTANT — read before trusting these as byte-exact: controllers in this
 * codebase return the Prisma payload (optionally with `include`d relations)
 * directly as JSON; there is no separate response-DTO mapping layer (see
 * "API Technical Debt" in the milestone report). These schemas document the
 * real contract — every field below is a genuine column or relation from
 * prisma/schema.prisma, nothing invented — but the exact set of nested
 * relations present on any one response can vary by endpoint (e.g.
 * GET /properties/:id includes more than GET /properties). Treat a field
 * typed here as present-when-included rather than always-present unless its
 * description says otherwise.
 */

const timestamps = {
  createdAt: z.string().datetime().openapi({ example: '2026-01-15T09:30:00.000Z' }),
  updatedAt: z.string().datetime().openapi({ example: '2026-01-15T09:30:00.000Z' }),
};

export const organisationSchema = registry.register(
  'Organisation',
  z.object({
    id: z.string().openapi({ description: 'Internal CUID — see ADR-001.' }),
    name: z.string().openapi({ example: 'Harbour View Strata Management' }),
    slug: z.string().openapi({ example: 'harbour-view-strata' }),
    status: z.enum(['ACTIVE', 'SUSPENDED']),
    currencyCode: z.string().openapi({ example: 'AUD' }),
    countryCode: z.string().nullable().openapi({ example: 'AU' }),
    aiEnabled: z.boolean(),
    ...timestamps,
  }),
);

export const propertySummarySchema = registry.register(
  'PropertySummary',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'PROP-K7M4Q2' }),
    name: z.string().openapi({ example: 'Harbour View Residences' }),
    code: z.string().openapi({ example: 'HVR' }),
    propertyType: z.string().openapi({ example: 'RESIDENTIAL' }),
    status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']),
    addressLine1: z.string(),
    addressLine2: z.string().nullable(),
    city: z.string(),
    state: z.string().nullable(),
    country: z.string(),
    postalCode: z.string().nullable(),
    isStrataManaged: z.boolean(),
    strataStatus: z.enum(['NOT_ENABLED', 'SETUP_IN_PROGRESS', 'ACTIVE']),
  }),
);

export const propertyDetailSchema = registry.register(
  'PropertyDetail',
  propertySummarySchema.extend({
    organisationId: z.string(),
    strataPlanNumber: z.string().nullable(),
    strataSchemeName: z.string().nullable(),
    strataPlanDeclaredUnitsOfEntitlement: z.string().nullable().openapi({
      description: 'Decimal, serialized as a string. Total declared UOE from the strata plan.',
      example: '1000.00',
    }),
    ...timestamps,
  }),
);

export const spaceSchema = registry.register(
  'Space',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'LOT-9F2K7Q' }),
    propertyId: z.string(),
    name: z.string().openapi({ example: 'Unit 1204' }),
    code: z.string(),
    spaceType: z.string().openapi({ example: 'APARTMENT' }),
    floor: z.string().nullable(),
    sizeSqft: z.number().int().nullable(),
    status: z.enum(['VACANT', 'OCCUPIED', 'UNAVAILABLE']),
    isStrataLot: z.boolean(),
    lotNumber: z.string().nullable(),
    entitlementValue: z.string().nullable().openapi({
      description: 'Decimal, serialized as a string. Units of Entitlement — see ADR-005.',
      example: '144.00',
    }),
    strataClassification: z.enum(['UNCLASSIFIED', 'LOT', 'COMMON_PROPERTY']),
    ...timestamps,
  }),
);

const strataLotSummarySchema = z.object({
  spaceId: z.string(),
  name: z.string(),
  code: z.string(),
  lotNumber: z.string().nullable(),
  unitsOfEntitlement: z.string().openapi({ example: '144.00' }),
  entitlementSharePct: z.number().openapi({ example: 14.4 }),
});

const unclassifiedSpaceSummarySchema = z.object({
  spaceId: z.string(),
  name: z.string(),
  code: z.string(),
});

export const strataSummarySchema = registry.register(
  'StrataSummary',
  z.object({
    strataStatus: z.enum(['NOT_ENABLED', 'SETUP_IN_PROGRESS', 'ACTIVE']),
    strataPlanNumber: z.string().nullable(),
    strataSchemeName: z.string().nullable(),
    strataPlanDeclaredUnitsOfEntitlement: z.string().nullable(),
    lotCount: z.number().int(),
    commonPropertyCount: z.number().int().openapi({
      description: 'Spaces explicitly classified COMMON_PROPERTY — never counted toward UOE.',
    }),
    unclassifiedCount: z.number().int().openapi({
      description: 'Expected while SETUP_IN_PROGRESS; never allowed once ACTIVE.',
    }),
    unclassifiedSpaces: z.array(unclassifiedSpaceSummarySchema),
    totalUnitsOfEntitlement: z.number().openapi({
      description: 'SUM(Space.entitlementValue) across this property’s LOT spaces.',
      example: 1000,
    }),
    reconciliation: z.object({
      declaredTotal: z.number().nullable(),
      allocatedTotal: z.number(),
      remaining: z.number().nullable(),
      isComplete: z.boolean().nullable().openapi({
        description: 'Exact-equality comparison — see strata.calculations.ts and ADR-005.',
      }),
    }),
    lots: z.array(strataLotSummarySchema),
  }),
);

const financialOpeningBalanceSummarySchema = z.object({
  id: z.string(),
  publicReference: z.string().openapi({ example: 'FOB-K7M4Q2' }),
  amount: z.string().openapi({ example: '12450.00' }),
  asOfDate: z
    .string()
    .openapi({ example: '2026-10-01', description: 'YYYY-MM-DD, no time/timezone.' }),
  currencyCode: z.string().openapi({ example: 'AUD' }),
  referenceNote: z.string().nullable(),
});

const financialFundSummarySchema = z.object({
  id: z.string(),
  publicReference: z.string().openapi({ example: 'FUND-K7M4Q2' }),
  fundType: z.enum(['ADMINISTRATION', 'CAPITAL_WORKS', 'OTHER']),
  name: z.string().openapi({ example: 'Administration Fund' }),
  currencyCode: z.string().openapi({ example: 'AUD' }),
  openingBalance: financialOpeningBalanceSummarySchema.nullable(),
});

const lotOpeningPositionSummarySchema = z.object({
  spaceId: z.string(),
  spacePublicReference: z.string().openapi({ example: 'LOT-K7M4Q2' }),
  spaceName: z.string(),
  spaceCode: z.string(),
  lotNumber: z.string().nullable(),
  recorded: z.boolean().openapi({
    description:
      'Whether this lot has an opening position recorded yet — leaving a lot blank ' +
      'is valid, so false is not an error state.',
  }),
  amountOwing: z.string().openapi({ example: '1250.00' }),
  creditBalance: z.string().openapi({ example: '0.00' }),
  asOfDate: z.string().nullable(),
  currencyCode: z.string().nullable(),
  referenceNote: z.string().nullable(),
});

export const financialSummarySchema = registry.register(
  'FinancialSummary',
  z.object({
    status: z.enum(['NOT_CONFIGURED', 'SETUP_IN_PROGRESS', 'ACTIVE']),
    publicReference: z.string().nullable().openapi({ example: 'FIN-K7M4Q2' }),
    currencyCode: z.string().nullable().openapi({ example: 'AUD' }),
    financialYearStartDate: z.string().nullable().openapi({ example: '2026-07-01' }),
    financialYearEndDate: z.string().nullable().openapi({ example: '2027-06-30' }),
    cutoverDate: z.string().nullable().openapi({ example: '2026-10-01' }),
    activatedAt: z.string().datetime().nullable(),
    activatedByUserId: z.string().nullable(),
    funds: z.array(financialFundSummarySchema),
    lotPositions: z.array(lotOpeningPositionSummarySchema),
    lotPositionsRecordedCount: z.number().int(),
    lotPositionsTotalCount: z.number().int(),
  }),
);

export const financialReconciliationReportSchema = registry.register(
  'FinancialReconciliationReport',
  z.object({
    errors: z
      .array(z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }))
      .openapi({ description: 'Each one blocks activation.' }),
    warnings: z
      .array(z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }))
      .openapi({ description: 'Does not block activation, but should be reviewed.' }),
    infos: z.array(
      z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
    ),
    readyToActivate: z.boolean().openapi({ description: 'True iff errors is empty.' }),
  }),
);

const financialBudgetLineSchema = z.object({
  id: z.string(),
  publicReference: z.string().openapi({ example: 'BUDL-K7M4Q2' }),
  financialFundId: z.string(),
  fundPublicReference: z.string().openapi({ example: 'FUND-K7M4Q2' }),
  fundType: z.string().openapi({ example: 'ADMINISTRATION' }),
  fundName: z.string().openapi({ example: 'Administration Fund' }),
  lineType: z.enum(['REVENUE', 'EXPENDITURE', 'TRANSFER', 'RESERVE_CONTRIBUTION', 'OTHER']).openapi({
    description: 'M16.2.1. Drives totalBudgetedRevenue/totalBudgetedExpenditure below.',
  }),
  category: z.string().openapi({ example: 'Insurance' }),
  description: z.string().nullable(),
  plannedAmount: z.string().openapi({ example: '8500.00' }),
  notes: z.string().nullable(),
  sortOrder: z.number().int(),
  accountId: z.string().nullable().openapi({
    description: 'M16.2.1 — optional chart-of-accounts reference, same property only.',
  }),
  accountCode: z.string().nullable(),
  accountName: z.string().nullable(),
});

const financialBudgetFundTotalSchema = z.object({
  financialFundId: z.string(),
  fundPublicReference: z.string().openapi({ example: 'FUND-K7M4Q2' }),
  fundType: z.string().openapi({ example: 'ADMINISTRATION' }),
  fundName: z.string().openapi({ example: 'Administration Fund' }),
  totalRevenue: z.string().openapi({ example: '12000.00' }),
  totalExpenditure: z.string().openapi({ example: '30500.00' }),
});

export const financialBudgetSchema = registry.register(
  'FinancialBudget',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'BUD-K7M4Q2' }),
    financialYearStartDate: z.string().openapi({ example: '2026-07-01' }),
    financialYearEndDate: z.string().openapi({ example: '2027-06-30' }),
    version: z.number().int().openapi({
      description: 'Deterministic, server-assigned — 1 for a financial year’s first budget.',
    }),
    status: z.enum(['DRAFT', 'APPROVED', 'ACTIVE', 'SUPERSEDED']),
    source: z.enum(['CREATED', 'IMPORTED']).openapi({
      description: 'IMPORTED = the scheme’s already-approved budget, captured during onboarding.',
    }),
    currencyCode: z.string().openapi({ example: 'AUD' }),
    notes: z.string().nullable(),
    externalApprovalDate: z.string().nullable().openapi({
      description: 'IMPORTED only — the real-world date the scheme itself approved this budget.',
      example: '2026-05-12',
    }),
    externalApprovalReference: z.string().nullable(),
    createdByUserId: z.string().nullable(),
    approvedByUserId: z.string().nullable(),
    approvedAt: z.string().datetime().nullable(),
    activatedAt: z.string().datetime().nullable(),
    supersededAt: z.string().datetime().nullable(),
    revisionOfBudgetId: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    totalBudgetedRevenue: z.string().openapi({
      description:
        'M16.2.1 — SUM(lines.plannedAmount) where lineType = REVENUE. Always derived, never a ' +
        'stored column. Replaces the removed `totalBudget` field (no deprecated alias — see the ' +
        'M16.2.1 ADR).',
      example: '42000.00',
    }),
    totalBudgetedExpenditure: z.string().openapi({
      description: 'SUM(lines.plannedAmount) where lineType = EXPENDITURE.',
      example: '58400.00',
    }),
    budgetedSurplusDeficit: z.string().openapi({
      description:
        'totalBudgetedRevenue - totalBudgetedExpenditure. TRANSFER/RESERVE_CONTRIBUTION/OTHER ' +
        'lines are excluded from this headline figure (reported per-line only) until a full ' +
        'funding bridge ships — see FIN-007.',
      example: '-16400.00',
    }),
    totalsByFund: z.array(financialBudgetFundTotalSchema),
    lines: z.array(financialBudgetLineSchema),
  }),
);

export const financialBudgetListSchema = registry.register(
  'FinancialBudgetList',
  z.object({ items: z.array(financialBudgetSchema) }),
);

export const accountClassificationEnumSchema = z.enum([
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'INCOME',
  'EXPENSE',
]);

export const accountingAccountSchema = registry.register(
  'AccountingAccount',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'ACC-K7M4Q2' }),
    code: z.string().openapi({ example: '159100' }),
    name: z.string().openapi({ example: 'Insurance--Premiums' }),
    description: z.string().nullable(),
    classification: accountClassificationEnumSchema,
    parentAccountId: z.string().nullable(),
    restrictedToFundId: z.string().nullable().openapi({
      description: 'Null = usable against any fund — see the M16.2.1 ADR (D2).',
    }),
    restrictedToFundName: z.string().nullable(),
    isActive: z.boolean().openapi({
      description: 'Accounts are deactivated, never deleted — see the Chart of Accounts ADR.',
    }),
    externalCode: z.string().nullable(),
    sourceTemplateLineId: z.string().nullable(),
    sourceImportBatchId: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);

export const accountingAccountListSchema = registry.register(
  'AccountingAccountList',
  z.object({ items: z.array(accountingAccountSchema) }),
);

const accountImportRowSchema = z.object({
  rowNumber: z.number().int(),
  code: z.string(),
  name: z.string(),
  codeType: z.string().nullable(),
  suggestedClassification: accountClassificationEnumSchema.nullable(),
  suggestionConfidence: z.enum(['explicit', 'heuristic', 'none']).openapi({
    description:
      'explicit = stated in the file’s own Code type column; heuristic = a non-authoritative ' +
      'name-keyword guess that must be confirmed; none = no suggestion, a classification must be ' +
      'supplied via rowClassifications before this row can be applied.',
  }),
  resolvedClassification: accountClassificationEnumSchema.nullable(),
  status: z.enum(['READY', 'WARNING', 'ERROR']),
  issues: z.array(z.string()),
});

export const accountImportPreviewSchema = registry.register(
  'AccountImportPreview',
  z.object({
    fileName: z.string().nullable(),
    totalRows: z.number().int(),
    readyCount: z.number().int(),
    warningCount: z.number().int(),
    errorCount: z.number().int(),
    rows: z.array(accountImportRowSchema),
  }),
);

export const accountImportApplyResultSchema = registry.register(
  'AccountImportApplyResult',
  z.object({
    batch: z.object({
      id: z.string(),
      publicReference: z.string().openapi({ example: 'IMP-K7M4Q2' }),
      totalRows: z.number().int(),
      createdCount: z.number().int(),
      skippedCount: z.number().int(),
    }),
    accounts: z.array(accountingAccountSchema),
  }),
);

export const accountingPeriodSchema = registry.register(
  'AccountingPeriod',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'PER-K7M4Q2' }),
    startDate: z.string().openapi({ example: '2026-07-01' }),
    endDate: z.string().openapi({ example: '2027-06-30' }),
    status: z.enum(['OPEN', 'CLOSED']),
    closedByUserId: z.string().nullable(),
    closedAt: z.string().datetime().nullable(),
    reopenedByUserId: z.string().nullable(),
    reopenedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);

export const accountingPeriodListSchema = registry.register(
  'AccountingPeriodList',
  z.object({ items: z.array(accountingPeriodSchema) }),
);

const postingRoleEnumSchema = z.enum([
  'FUND_CASH',
  'LOT_LEVY_RECEIVABLE',
  'LEVY_INCOME',
  'UNAPPLIED_CASH',
  'ACCOUNTS_PAYABLE',
  'GST_PAYABLE',
  'GST_RECEIVABLE',
  'SUSPENSE',
  'OPENING_BALANCE_EQUITY',
  'INTER_FUND_TRANSFER',
]);

export const postingProfileRuleSchema = registry.register(
  'PostingProfileRule',
  z.object({
    id: z.string(),
    role: postingRoleEnumSchema,
    financialFundId: z.string().nullable().openapi({
      description: 'Null = applies regardless of fund context.',
    }),
    accountId: z.string(),
    accountCode: z.string(),
    accountName: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);

export const postingProfileRuleListSchema = registry.register(
  'PostingProfileRuleList',
  z.object({ items: z.array(postingProfileRuleSchema) }),
);

const journalLineSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  accountCode: z.string(),
  accountName: z.string(),
  financialFundId: z.string(),
  fundName: z.string(),
  debit: z.string().openapi({ example: '500.00' }),
  credit: z.string().openapi({ example: '0.00' }),
  lineNarration: z.string().nullable(),
  sortOrder: z.number().int(),
});

export const journalEntrySchema = registry.register(
  'JournalEntry',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'JRN-K7M4Q2' }),
    accountingPeriodId: z.string(),
    effectiveDate: z.string().openapi({ example: '2026-10-20' }),
    postedAt: z.string().datetime(),
    currencyCode: z.string().openapi({ example: 'AUD' }),
    sourceType: z.string().openapi({ example: 'MANUAL' }),
    sourceId: z.string(),
    sourceEventVersion: z.number().int(),
    narration: z.string(),
    postedByUserId: z.string(),
    reversalOfJournalId: z.string().nullable(),
    reversalReason: z.string().nullable(),
    totalDebit: z.string().openapi({
      description: 'SUM(lines.debit) — always derived, never a stored column. Equal to SUM(lines.credit).',
      example: '500.00',
    }),
    lines: z.array(journalLineSchema),
  }),
);

export const journalEntryListSchema = registry.register(
  'JournalEntryList',
  z.object({ items: z.array(journalEntrySchema) }),
);

export const trialBalanceRowSchema = z.object({
  accountId: z.string(),
  accountCode: z.string(),
  accountName: z.string(),
  classification: z.string(),
  totalDebit: z.string(),
  totalCredit: z.string(),
  netBalance: z.string().openapi({
    description: 'Signed, debit-positive. Kept for callers relying on the raw figure.',
  }),
  presentedSide: z.enum(['DEBIT', 'CREDIT']).openapi({
    description: 'Conventional trial-balance presentation: which column this balance sits under.',
  }),
  presentedBalance: z.string().openapi({
    description: 'Always non-negative — the magnitude to show under presentedSide\'s column.',
    example: '1200.00',
  }),
});

export const trialBalanceListSchema = registry.register(
  'TrialBalanceList',
  z.object({ items: z.array(trialBalanceRowSchema) }),
);

const levyInstallmentSchema = z.object({
  id: z.string(),
  installmentNumber: z.number().int().openapi({ description: '1-based — sortOrder + 1.', example: 1 }),
  dueDate: z.string().openapi({ example: '2026-10-01' }),
  amount: z.string().openapi({ example: '10000.00' }),
  status: z.enum(['PENDING', 'ISSUED', 'REVERSED']).openapi({
    description: 'ADR-024 — this instalment\'s own issuance state, independent of its siblings.',
  }),
  issuedByUserId: z.string().nullable(),
  issuedAt: z.string().datetime().nullable(),
  journalEntryId: z.string().nullable().openapi({
    description: 'The journal THIS instalment\'s issuance produced — null until ISSUED.',
  }),
  reversedByUserId: z.string().nullable(),
  reversedAt: z.string().datetime().nullable(),
  reversalReason: z.string().nullable(),
  sortOrder: z.number().int(),
});

export const levyScheduleSchema = registry.register(
  'LevySchedule',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'LEVY-K7M4Q2' }),
    financialFundId: z.string(),
    fundName: z.string(),
    financialBudgetId: z.string().nullable(),
    kind: z.enum(['REGULAR', 'SPECIAL']),
    name: z.string(),
    totalAmount: z.string().openapi({ example: '40000.00' }),
    status: z.enum(['DRAFT', 'APPROVED', 'PARTIALLY_ISSUED', 'ISSUED', 'CANCELLED', 'REVERSED']).openapi({
      description:
        'Derived from the instalments\' own statuses (ADR-024) — PARTIALLY_ISSUED: some issued, ' +
        'some not; ISSUED: every instalment issued; REVERSED: legacy pre-ADR-024 whole-schedule ' +
        'reversal only, never reached by new issuance.',
    }),
    rationale: z.string().nullable(),
    externalApprovalDate: z.string().nullable(),
    externalApprovalReference: z.string().nullable(),
    createdByUserId: z.string().nullable(),
    approvedByUserId: z.string().nullable(),
    approvedAt: z.string().datetime().nullable(),
    issuedByUserId: z.string().nullable().openapi({
      description: 'Legacy pre-ADR-024 whole-schedule issuance only — see each instalment instead.',
    }),
    issuedAt: z.string().datetime().nullable(),
    journalEntryId: z.string().nullable().openapi({
      description: 'Legacy pre-ADR-024 whole-schedule issuance only — see each instalment\'s own journalEntryId.',
    }),
    cancelledByUserId: z.string().nullable(),
    cancelledAt: z.string().datetime().nullable(),
    cancelReason: z.string().nullable(),
    reversedByUserId: z.string().nullable(),
    reversedAt: z.string().datetime().nullable(),
    reversalReason: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    installments: z.array(levyInstallmentSchema),
  }),
);

export const levyScheduleListSchema = registry.register(
  'LevyScheduleList',
  z.object({ items: z.array(levyScheduleSchema) }),
);

export const lotAllocationPreviewRowSchema = z.object({
  spaceId: z.string(),
  spaceName: z.string(),
  lotNumber: z.string().nullable(),
  entitlementValue: z.string(),
  installments: z.array(
    z.object({
      levyInstallmentId: z.string(),
      dueDate: z.string(),
      amount: z.string(),
    }),
  ),
  total: z.string(),
});

export const lotAllocationPreviewListSchema = registry.register(
  'LotAllocationPreviewList',
  z.object({ items: z.array(lotAllocationPreviewRowSchema) }),
);

export const lotLevyChargeSchema = registry.register(
  'LotLevyCharge',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'LVC-K7M4Q2' }),
    levyScheduleId: z.string(),
    levyScheduleName: z.string(),
    levyInstallmentId: z.string(),
    installmentNumber: z.number().int().openapi({ example: 1 }),
    dueDate: z.string().openapi({ example: '2026-10-15' }),
    spaceId: z.string(),
    lotLabel: z.string().openapi({
      description: 'Human-readable lot identifier (lotNumber, else space code/name) — never the raw spaceId.',
      example: 'Lot 12',
    }),
    ownerName: z.string().nullable().openapi({
      description:
        'Present only when the caller independently holds people.view on top of financials.view; ' +
        'null otherwise, or if the lot has no recorded OWNER membership.',
    }),
    financialFundId: z.string(),
    fundName: z.string(),
    amount: z.string(),
    effectiveAmount: z.string().openapi({
      description: 'amount + SUM(adjustments) — derived fresh, never stored.',
    }),
    status: z.enum(['ISSUED', 'PART_PAID', 'PAID', 'OVERDUE', 'CANCELLED']),
    createdAt: z.string().datetime(),
  }),
);

export const lotLevyChargeListSchema = registry.register(
  'LotLevyChargeList',
  z.object({ items: z.array(lotLevyChargeSchema) }),
);

export const levyAdjustmentSchema = registry.register(
  'LevyAdjustment',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'LVA-K7M4Q2' }),
    lotLevyChargeId: z.string(),
    amount: z.string(),
    reason: z.string(),
    journalEntryId: z.string(),
    createdByUserId: z.string(),
    createdAt: z.string().datetime(),
  }),
);

// --- M16.4 — Lot Ledger & Owner Financial Accounts ---

export const lotLedgerRowTypeSchema = z.enum([
  'OPENING_POSITION',
  'REGULAR_LEVY_CHARGE',
  'SPECIAL_LEVY_CHARGE',
  'LEVY_REVERSAL',
  'LEVY_ADJUSTMENT',
  'RECEIPT',
  'RECEIPT_REVERSAL',
  'PAYMENT_ALLOCATION',
]);

export const lotLedgerRowSchema = registry.register(
  'LotLedgerRow',
  z.object({
    id: z.string().openapi({ description: 'Stable, derived row id — not a standalone persisted record.' }),
    date: z.string().openapi({ example: '2026-10-15' }),
    postedAt: z.string().datetime(),
    type: lotLedgerRowTypeSchema,
    description: z.string(),
    financialFundId: z.string().nullable().openapi({
      description: 'Null for the opening-position row — LotOpeningPosition carries no fund attribution.',
    }),
    fundName: z.string().nullable(),
    debit: z.string(),
    credit: z.string(),
    runningBalance: z.string().openapi({
      description: 'Computed over this lot\'s complete chronological row set, never per-page.',
    }),
    sourceReference: z.string().nullable(),
    levyScheduleId: z.string().nullable(),
    levyScheduleName: z.string().nullable(),
    levyInstallmentId: z.string().nullable(),
    installmentNumber: z.number().int().nullable(),
    reversalOfSourceReference: z.string().nullable(),
    reversalReason: z.string().nullable(),
    createdByUserId: z.string().nullable(),
  }),
);

export const lotOpeningPositionViewSchema = registry.register(
  'LotOpeningPositionView',
  z.object({
    recorded: z.boolean(),
    amountOwing: z.string(),
    creditBalance: z.string(),
    net: z.string().openapi({ description: 'amountOwing - creditBalance.' }),
    asOfDate: z.string().nullable(),
    fundAttributed: z.literal(false),
  }),
);

export const lotFundBreakdownEntrySchema = registry.register(
  'LotFundBreakdownEntry',
  z.object({
    financialFundId: z.string(),
    fundName: z.string(),
    totalIssuedLevyCharges: z.string(),
    totalReversedCharges: z.string(),
    totalAdjustments: z.string(),
    totalReceipts: z.string().openapi({
      description: 'Already netted into netBalance — never double-counted against PAYMENT_ALLOCATION rows (M16.5).',
    }),
    netBalance: z.string(),
  }),
);

export const lotFinancialAccountSchema = registry.register(
  'LotFinancialAccount',
  z.object({
    spaceId: z.string(),
    propertyId: z.string(),
    lotLabel: z.string(),
    ownerName: z.string().nullable().openapi({
      description: 'Present only when the caller independently holds people.view on top of financials.view.',
    }),
    currencyCode: z.string().nullable(),
    financialYearStartDate: z.string().nullable(),
    financialYearEndDate: z.string().nullable(),
    openingPosition: lotOpeningPositionViewSchema,
    totalIssuedLevyCharges: z.string(),
    totalReversedCharges: z.string(),
    totalAdjustments: z.string(),
    totalReceipts: z.string().openapi({ description: 'Sum of non-reversed Receipt amounts (M16.5), regardless of allocation status.' }),
    totalUnapplied: z.string().openapi({
      description: 'totalReceipts minus applied allocations — an honest advance/credit balance, never force-allocated (M16.5).',
    }),
    currentBalance: z.string(),
    balanceClassification: z.enum(['AMOUNT_OWING', 'CREDIT', 'SETTLED']),
    fundBreakdown: z.array(lotFundBreakdownEntrySchema),
    lastActivity: z
      .object({ date: z.string(), description: z.string(), type: lotLedgerRowTypeSchema })
      .nullable(),
  }),
);

export const lotLedgerPageSchema = registry.register(
  'LotLedgerPage',
  z.object({
    items: z.array(lotLedgerRowSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    ownerName: z.string().nullable(),
    lotLabel: z.string(),
  }),
);

export const lotStatementSchema = registry.register(
  'LotStatement',
  z.object({
    spaceId: z.string(),
    propertyId: z.string(),
    propertyName: z.string(),
    strataPlanNumber: z.string().nullable(),
    lotLabel: z.string(),
    ownerName: z.string().nullable(),
    currencyCode: z.string().nullable(),
    periodStartDate: z.string(),
    periodEndDate: z.string(),
    openingBalance: z.string(),
    movements: z.array(lotLedgerRowSchema),
    totalDebits: z.string(),
    totalCredits: z.string(),
    closingBalance: z.string(),
    generatedAt: z.string().datetime(),
  }),
);

// --- M16.5 — Receipts & Payment Allocation ---

export const receiptPaymentMethodSchema = z.enum(['BANK_TRANSFER', 'CASH', 'CHEQUE', 'OTHER']);
export const receiptStatusSchema = z.enum(['RECORDED', 'REVERSED']);
export const paymentAllocationStatusSchema = z.enum(['APPLIED', 'REVERSED']);

export const paymentAllocationViewSchema = registry.register(
  'PaymentAllocationView',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'PAL-9F3K2L' }),
    receiptId: z.string(),
    receiptPublicReference: z.string(),
    lotLevyChargeId: z.string(),
    lotLevyChargePublicReference: z.string(),
    amount: z.string(),
    status: paymentAllocationStatusSchema,
    journalEntryId: z.string(),
    reversedByUserId: z.string().nullable(),
    reversedAt: z.string().datetime().nullable(),
    reversalReason: z.string().nullable(),
    createdByUserId: z.string(),
    createdAt: z.string().datetime(),
  }),
);

export const receiptViewSchema = registry.register(
  'ReceiptView',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'RCT-4H8D1Q' }),
    propertyId: z.string(),
    spaceId: z.string(),
    lotLabel: z.string(),
    ownerName: z.string().nullable().openapi({
      description: 'Present only when the caller independently holds people.view on top of financials.view.',
    }),
    financialFundId: z.string(),
    fundName: z.string(),
    destinationAccountId: z.string(),
    destinationAccountCode: z.string(),
    destinationAccountName: z.string(),
    amount: z.string(),
    appliedAmount: z.string().openapi({ description: 'Derived: sum of this receipt\'s APPLIED allocations.' }),
    unappliedAmount: z.string().openapi({ description: 'Derived: amount minus appliedAmount — the honest advance/credit balance.' }),
    currencyCode: z.string(),
    paymentMethod: receiptPaymentMethodSchema,
    paymentReference: z.string().nullable(),
    description: z.string().nullable(),
    receiptDate: z.string().openapi({ example: '2026-10-15' }),
    postingDate: z.string().openapi({ example: '2026-10-15' }),
    externalBankReference: z.string().nullable().openapi({
      description: 'A supplied reference only — recording a receipt never implies it is bank-reconciled.',
    }),
    status: receiptStatusSchema,
    journalEntryId: z.string(),
    allocations: z.array(paymentAllocationViewSchema),
    reversedByUserId: z.string().nullable(),
    reversedAt: z.string().datetime().nullable(),
    reversalReason: z.string().nullable(),
    createdByUserId: z.string(),
    createdAt: z.string().datetime(),
  }),
);

export const receiptListSchema = registry.register(
  'ReceiptList',
  z.object({ items: z.array(receiptViewSchema) }),
);

// --- M16.6 — Arrears Management (ADR-027) ---

export const ageingBucketSchema = registry.register(
  'AgeingBucket',
  z.enum(['CURRENT', 'DAYS_1_30', 'DAYS_31_60', 'DAYS_61_90', 'DAYS_90_PLUS']),
);

export const collectionCaseStatusSchema = z.enum([
  'OPEN',
  'IN_PROGRESS',
  'AWAITING_PAYMENT',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
]);

export const paymentReminderStatusSchema = z.enum(['DRAFT', 'CANCELLED', 'SENT', 'FAILED']);

export const chargeArrearsViewSchema = registry.register(
  'ChargeArrearsView',
  z.object({
    lotLevyChargeId: z.string(),
    publicReference: z.string().openapi({ example: 'LVC-7F2K9' }),
    levyScheduleId: z.string(),
    levyScheduleName: z.string(),
    levyInstallmentId: z.string(),
    dueDate: z.string().openapi({ example: '2026-10-15' }),
    financialFundId: z.string(),
    fundName: z.string(),
    originalAmount: z.string(),
    adjustmentsTotal: z.string(),
    effectiveAmount: z.string(),
    appliedAmount: z.string(),
    outstandingAmount: z.string(),
    isOverdue: z.boolean(),
    daysOverdue: z.number().int(),
    ageingBucket: ageingBucketSchema,
  }),
);

export const lotArrearsSummarySchema = registry.register(
  'LotArrearsSummary',
  z.object({
    spaceId: z.string(),
    lotLabel: z.string(),
    ownerName: z.string().nullable().openapi({
      description: 'Present only when the caller independently holds people.view on top of financials.view.',
    }),
    financialFundId: z.string().nullable(),
    totalOutstanding: z.string(),
    totalOverdue: z.string(),
    oldestDueDate: z.string().nullable(),
    maxDaysOverdue: z.number().int(),
    ageingBucket: ageingBucketSchema.nullable(),
    unappliedCredits: z.string().openapi({
      description: 'Never netted into totalOverdue/totalOutstanding — an honest advance, never force-allocated.',
    }),
    collectionStatus: z.union([collectionCaseStatusSchema, z.literal('NONE')]),
    collectionCaseId: z.string().nullable(),
    lastActivityAt: z.string().nullable(),
  }),
);

export const arrearsRegisterSchema = registry.register(
  'ArrearsRegister',
  z.object({ items: z.array(lotArrearsSummarySchema) }),
);

export const arrearsSummarySchema = registry.register(
  'ArrearsSummary',
  z.object({
    propertyId: z.string(),
    asOfDate: z.string().openapi({ example: '2026-10-21' }),
    currencyCode: z.string().nullable(),
    totalOverdue: z.string(),
    totalCurrentOutstanding: z.string(),
    totalUnappliedCredits: z.string(),
    lotsInArrearsCount: z.number().int(),
    ageingBuckets: z.record(ageingBucketSchema, z.string()),
    overdueByFund: z.array(z.object({ financialFundId: z.string(), fundName: z.string(), totalOverdue: z.string() })),
  }),
);

export const openingBalanceArrearsSchema = registry.register(
  'OpeningBalanceArrears',
  z.object({
    amountOwing: z.string(),
    creditBalance: z.string(),
    asOfDate: z.string(),
    ageingBucket: z.literal('UNKNOWN').openapi({
      description: 'M16.1 opening balances carry no original levy due date — never fabricated, never aged.',
    }),
  }),
);

export const lotArrearsDetailSchema = registry.register(
  'LotArrearsDetail',
  z.object({
    spaceId: z.string(),
    propertyId: z.string(),
    lotLabel: z.string(),
    ownerName: z.string().nullable(),
    asOfDate: z.string(),
    totalOutstanding: z.string(),
    totalOverdue: z.string(),
    unappliedCredits: z.string(),
    charges: z.array(chargeArrearsViewSchema),
    openingPosition: openingBalanceArrearsSchema.nullable(),
    receipts: z.array(
      z.object({
        id: z.string(),
        publicReference: z.string(),
        amount: z.string(),
        status: z.string(),
        receiptDate: z.string(),
        allocations: z.array(
          z.object({
            id: z.string(),
            publicReference: z.string(),
            lotLevyChargePublicReference: z.string(),
            amount: z.string(),
            status: z.string(),
          }),
        ),
      }),
    ),
    collectionCases: z.array(
      z.object({
        id: z.string(),
        publicReference: z.string(),
        status: collectionCaseStatusSchema,
        assignedToUserId: z.string().nullable(),
        nextFollowUpDate: z.string().nullable(),
        openedAt: z.string().datetime(),
        closedAt: z.string().datetime().nullable(),
        closeReason: z.string().nullable(),
        notes: z.array(
          z.object({
            id: z.string(),
            body: z.string(),
            contactAttempted: z.boolean(),
            contactMethod: z.string().nullable(),
            createdByUserId: z.string(),
            createdAt: z.string().datetime(),
          }),
        ),
        reminders: z.array(
          z.object({
            id: z.string(),
            publicReference: z.string(),
            status: paymentReminderStatusSchema,
            asOfDate: z.string(),
            totalAmountOwing: z.string(),
            generatedAt: z.string().datetime(),
          }),
        ),
      }),
    ),
  }),
);

export const collectionCaseSchema = registry.register(
  'CollectionCase',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'COL-3SB5FG' }),
    organisationId: z.string(),
    propertyId: z.string(),
    spaceId: z.string(),
    status: collectionCaseStatusSchema,
    assignedToUserId: z.string().nullable(),
    nextFollowUpDate: z.string().datetime().nullable(),
    openedByUserId: z.string(),
    openedAt: z.string().datetime(),
    closedByUserId: z.string().nullable(),
    closedAt: z.string().datetime().nullable(),
    closeReason: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);

export const collectionNoteSchema = registry.register(
  'CollectionNote',
  z.object({
    id: z.string(),
    collectionCaseId: z.string(),
    organisationId: z.string(),
    propertyId: z.string(),
    body: z.string(),
    contactAttempted: z.boolean(),
    contactMethod: z.string().nullable(),
    createdByUserId: z.string(),
    createdAt: z.string().datetime(),
  }),
);

export const paymentReminderSchema = registry.register(
  'PaymentReminder',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'PRM-2C7Q2M' }),
    organisationId: z.string(),
    propertyId: z.string(),
    spaceId: z.string(),
    collectionCaseId: z.string().nullable(),
    status: paymentReminderStatusSchema,
    asOfDate: z.string(),
    totalAmountOwing: z.string(),
    currencyCode: z.string(),
    content: z.record(z.string(), z.unknown()).openapi({
      description: 'A point-in-time snapshot for preview/print only — never read back as current arrears truth.',
    }),
    generatedByUserId: z.string(),
    generatedAt: z.string().datetime(),
    cancelledByUserId: z.string().nullable(),
    cancelledAt: z.string().datetime().nullable(),
  }),
);

export const contactSummarySchema = registry.register(
  'ContactSummary',
  z.object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().email(),
    phone: z.string().nullable(),
    status: z.enum(['ACTIVE', 'INACTIVE']),
  }),
);

export const membershipSchema = registry.register(
  'PropertyMembership',
  z.object({
    id: z.string(),
    propertyId: z.string(),
    spaceId: z.string().nullable(),
    contactId: z.string(),
    role: z.string().openapi({
      example: 'PROPERTY_MANAGER',
      description:
        'A PropertyRole value, e.g. OWNER_REPRESENTATIVE, PROPERTY_MANAGER, TENANT, RESIDENT.',
    }),
    startDate: z.string().datetime(),
    endDate: z.string().datetime().nullable(),
    status: z.enum(['ACTIVE', 'ENDED']),
    contact: contactSummarySchema.optional(),
  }),
);

export const maintenanceRequestSchema = registry.register(
  'MaintenanceRequest',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'MR-P8X3DF' }),
    propertyId: z.string(),
    spaceId: z.string().nullable(),
    title: z.string().openapi({ example: 'Leaking kitchen tap' }),
    description: z.string(),
    category: z.string().openapi({ example: 'PLUMBING' }),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
    status: z
      .enum(['NEW', 'UNDER_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED'])
      .openapi({ description: 'See User & Operational Workflows → Maintenance Management.' }),
    procurementPath: z
      .enum(['DIRECT_WORK', 'REQUEST_QUOTES', 'EMERGENCY_WORK'])
      .nullable()
      .openapi({
        description: 'Null until “Arrange work” is chosen; null forever for pre-M11 requests.',
      }),
    reportedAt: z.string().datetime(),
    resolvedAt: z.string().datetime().nullable(),
    closedAt: z.string().datetime().nullable(),
    ...timestamps,
  }),
);

export const contractorSchema = registry.register(
  'Contractor',
  z.object({
    id: z.string(),
    name: z.string().openapi({ example: 'Acme Plumbing Services' }),
    companyName: z.string().nullable(),
    email: z.string().email(),
    phone: z.string().nullable(),
    status: z.enum(['ACTIVE', 'INACTIVE']),
    tradeTypes: z.array(z.string()),
    tradeCategories: z.array(z.string()).openapi({
      description: 'MaintenanceCategory values this contractor is classified under.',
    }),
    businessNumber: z.string().nullable(),
  }),
);

export const contractorEligibilitySchema = registry.register(
  'ContractorEligibility',
  z.object({
    eligible: z.boolean(),
    reasons: z
      .array(
        z.object({
          code: z.string().openapi({ example: 'MISSING_REQUIRED_CREDENTIAL' }),
          message: z.string(),
        }),
      )
      .openapi({ description: 'Empty when eligible is true.' }),
  }),
);

export const contractorQuoteSchema = registry.register(
  'ContractorQuote',
  z.object({
    id: z.string(),
    workOrderId: z.string().nullable(),
    quoteRoundId: z.string().nullable(),
    contractorId: z.string(),
    amount: z.string().nullable().openapi({ example: '1250.00' }),
    currencyCode: z.string().openapi({ example: 'AUD' }),
    description: z.string().nullable(),
    status: z.enum([
      'REQUESTED',
      'SUBMITTED',
      'DECLINED',
      'WITHDRAWN',
      'SELECTED',
      'APPROVED',
      'REJECTED',
    ]),
    source: z.enum(['MANUAL', 'CONTRACTOR_PORTAL']),
    workflowMode: z
      .enum(['NONE', 'APPROVAL_ONLY', 'SIGNATURE_ONLY', 'APPROVAL_THEN_SIGNATURE'])
      .nullable(),
    requiredWorkflowMode: z
      .enum(['NONE', 'APPROVAL_ONLY', 'SIGNATURE_ONLY', 'APPROVAL_THEN_SIGNATURE'])
      .nullable()
      .openapi({ description: 'Resolved once from the Approval Policy; immutable afterwards.' }),
    approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).nullable(),
    signatureStatus: z.enum(['PENDING', 'SIGNED', 'DECLINED']).nullable(),
    submittedAt: z.string().datetime().nullable(),
    selectedAt: z.string().datetime().nullable(),
    ...timestamps,
  }),
);

export const quoteRoundSchema = registry.register(
  'QuoteRound',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'RFQ-3H8L2M' }),
    propertyId: z.string(),
    maintenanceRequestId: z.string(),
    category: z.string(),
    title: z.string(),
    scopeDescription: z.string(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
    currencyCode: z.string(),
    status: z.enum(['OPEN', 'CLOSED', 'AWARDED', 'CANCELLED']),
    awardedQuoteId: z.string().nullable(),
    awardedAt: z.string().datetime().nullable(),
    invitations: z
      .array(
        z.object({
          id: z.string(),
          contractorId: z.string(),
          quoteId: z.string().nullable(),
        }),
      )
      .optional(),
    quotes: z.array(contractorQuoteSchema).optional(),
    ...timestamps,
  }),
);

const workOrderContractorSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  companyName: z.string().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

const workOrderQuoteSummarySchema = contractorQuoteSchema.extend({
  contractor: z.object({
    id: z.string(),
    name: z.string(),
    companyName: z.string().nullable(),
    email: z.string().email(),
  }),
});

export const workOrderSchema = registry.register(
  'WorkOrder',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'WO-N6K2RT' }),
    propertyId: z.string(),
    spaceId: z.string().nullable(),
    maintenanceRequestId: z.string().nullable(),
    title: z.string(),
    description: z.string(),
    status: z.enum(['DRAFT', 'READY', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
    scheduledAt: z.string().datetime().nullable(),
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    estimatedCost: z.string().nullable().openapi({ example: '1250.00' }),
    actualCost: z.string().nullable(),
    currencyCode: z.string(),
    contractorId: z.string().nullable(),
    createdByUserId: z.string(),
    selectedQuoteId: z.string().nullable(),
    quoteRoundId: z.string().nullable(),
    property: z.object({
      id: z.string(),
      publicReference: z.string(),
      name: z.string(),
      code: z.string(),
    }),
    space: z
      .object({ id: z.string(), publicReference: z.string(), name: z.string(), code: z.string() })
      .nullable(),
    maintenanceRequest: z
      .object({
        id: z.string(),
        publicReference: z.string(),
        title: z.string(),
        category: z.string(),
      })
      .nullable(),
    contractor: workOrderContractorSummarySchema.nullable(),
    createdBy: z.object({ id: z.string(), firstName: z.string(), lastName: z.string() }),
    quotes: z.array(workOrderQuoteSummarySchema),
    selectedQuote: workOrderQuoteSummarySchema.nullable(),
    quoteRound: z
      .object({
        id: z.string(),
        publicReference: z.string(),
        title: z.string(),
        dueAt: z.string().datetime().nullable(),
      })
      .nullable(),
    ...timestamps,
  }),
);

export const workOrderVariationSchema = registry.register(
  'WorkOrderVariation',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'VAR-7Q2X9L' }),
    workOrderId: z.string(),
    description: z.string(),
    amountDelta: z.string().openapi({
      description: 'Decimal; may be negative (a reduction in scope/cost).',
      example: '350.00',
    }),
    currencyCode: z.string(),
    status: z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED']),
    workflowMode: z
      .enum(['NONE', 'APPROVAL_ONLY', 'SIGNATURE_ONLY', 'APPROVAL_THEN_SIGNATURE'])
      .nullable(),
    requiredWorkflowMode: z
      .enum(['NONE', 'APPROVAL_ONLY', 'SIGNATURE_ONLY', 'APPROVAL_THEN_SIGNATURE'])
      .nullable(),
    approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).nullable(),
    signatureStatus: z.enum(['PENDING', 'SIGNED', 'DECLINED']).nullable(),
    approvedAt: z.string().datetime().nullable(),
    rejectedAt: z.string().datetime().nullable(),
    cancelledAt: z.string().datetime().nullable(),
    ...timestamps,
  }),
);

export const commercialSummarySchema = registry.register(
  'WorkOrderCommercialSummary',
  z.object({
    originalAmount: z.string().openapi({ example: '1250.00' }),
    approvedVariationsTotal: z.string().openapi({
      description: 'Sum of APPROVED variations’ amountDelta only.',
      example: '350.00',
    }),
    authorisedTotal: z.string().openapi({
      description: 'originalAmount + approvedVariationsTotal, computed at read time.',
      example: '1600.00',
    }),
    currencyCode: z.string(),
  }),
);

export const communicationSchema = registry.register(
  'Communication',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'COM-7D3K8N' }),
    title: z.string(),
    body: z.string(),
    status: z.enum(['DRAFT', 'SCHEDULED', 'SENT', 'CANCELLED']),
    channels: z.array(z.enum(['IN_APP', 'EMAIL', 'WHATSAPP'])).openapi({
      description: 'WHATSAPP exists in the schema but can never be selected by a client today.',
    }),
    audienceCriteria: z.object({
      scope: z.enum(['ORGANISATION', 'PROPERTY', 'SPACE']),
      propertyIds: z.array(z.string()).optional(),
      spaceIds: z.array(z.string()).optional(),
      roles: z.array(z.string()).optional(),
      includeContactIds: z.array(z.string()).optional(),
    }),
    savedAudienceId: z.string().nullable(),
    scheduledAt: z.string().datetime().nullable(),
    sentAt: z.string().datetime().nullable(),
    cancelledAt: z.string().datetime().nullable(),
    ...timestamps,
  }),
);

export const communicationDeliverySchema = registry.register(
  'CommunicationDelivery',
  z.object({
    communicationId: z.string(),
    totalRecipients: z.number().int(),
    byChannel: z.record(
      z.string(),
      z.object({
        pending: z.number().int(),
        sent: z.number().int(),
        failed: z.number().int(),
      }),
    ),
  }),
);

export const savedAudienceSchema = registry.register(
  'SavedAudience',
  z.object({
    id: z.string(),
    name: z.string(),
    criteria: z.object({
      scope: z.enum(['ORGANISATION', 'PROPERTY', 'SPACE']),
      propertyIds: z.array(z.string()).optional(),
      spaceIds: z.array(z.string()).optional(),
      roles: z.array(z.string()).optional(),
      includeContactIds: z.array(z.string()).optional(),
    }),
    ...timestamps,
  }),
);

export const notificationSchema = registry.register(
  'Notification',
  z.object({
    id: z.string(),
    title: z.string(),
    body: z.string().nullable(),
    entityType: z.string().nullable(),
    entityId: z.string().nullable(),
    readAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  }),
);

export const propertyDocumentSchema = registry.register(
  'PropertyDocument',
  z.object({
    id: z.string(),
    documentType: z.enum(['NSW_STRATA_PLAN']).nullable().openapi({
      description: 'Null until classification completes. Only one document type exists today.',
    }),
    status: z.enum(['UPLOADED', 'ANALYSING', 'REVIEW_REQUIRED', 'READY', 'FAILED', 'CONFIRMED']),
    fileName: z.string(),
    contentType: z.literal('application/pdf'),
    fileSize: z.number().int(),
    pageCount: z.number().int().nullable(),
    draft: z
      .record(z.string(), z.unknown())
      .nullable()
      .openapi({
        description:
          'The current editable review state (property fields + lots[]) — proposed data ' +
          'until the explicit confirm step. Shape is specific to the NSW Strata Plan document ' +
          'type; see Property Document Intelligence → Structured Extraction.',
      }),
    createdPropertyId: z.string().nullable().openapi({
      description: 'Set exactly once, at confirmation. Makes confirm idempotent.',
    }),
    confirmedAt: z.string().datetime().nullable(),
    ...timestamps,
  }),
);

export const documentValidationIssueSchema = z.object({
  code: z.string().openapi({ example: 'UOE_MISMATCH' }),
  severity: z.enum(['BLOCKING', 'WARNING']),
  message: z.string(),
  path: z.string().optional(),
});

export const aiResourceSchema = registry.register(
  'AiResource',
  z.object({
    type: z.enum([
      'MAINTENANCE_REQUEST',
      'WORK_ORDER',
      'CONTRACTOR_QUOTE',
      'QUOTE_ROUND',
      'CONTRACTOR',
      'PROPERTY',
      'WORK_ORDER_VARIATION',
      'COMMUNICATION',
    ]),
    id: z.string(),
    reference: z.string().openapi({ example: 'Maintenance Request — Leaking tap' }),
    publicReference: z.string().nullable().openapi({ example: 'MR-P8X3DF' }),
    label: z.string(),
  }),
);

export const aiFindingSchema = registry.register(
  'AiFinding',
  z.object({
    type: z.enum(['DELAY', 'RISK', 'PATTERN', 'EXCEPTION', 'DIFFERENCE', 'COMPLIANCE', 'INFO']),
    severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
    title: z.string(),
    explanation: z.string(),
    factOrInference: z.enum(['FACT', 'AI_ANALYSIS']).openapi({
      description:
        'FACT = every word came directly from tool-returned data. AI_ANALYSIS = the model ' +
        'connected or interpreted facts — always hedged, never presented as certain. See ' +
        'ADR-007 — The LLM Is Never Authority.',
    }),
    evidence: z.array(aiResourceSchema),
  }),
);

export const aiSuggestedActionSchema = registry.register(
  'AiSuggestedAction',
  z.union([
    z.object({
      type: z.literal('OPEN_RESOURCE'),
      resourceType: z.string(),
      resourceId: z.string(),
      publicReference: z.string().nullable(),
      label: z.string(),
    }),
    z.object({
      type: z.literal('ASK_FOLLOWUP'),
      prompt: z.string(),
      label: z.string(),
    }),
  ]),
);

export const aiResponseSchema = registry.register(
  'AiResponse',
  z.object({
    answer: z.string(),
    sections: z.array(z.object({ heading: z.string(), body: z.string() })),
    findings: z.array(aiFindingSchema),
    resources: z.array(aiResourceSchema),
    suggestedActions: z.array(aiSuggestedActionSchema),
    clarification: z.string().optional().openapi({
      description: 'Set instead of a normal answer when the assistant needs disambiguation.',
    }),
  }),
);

export const aiConversationSummarySchema = registry.register(
  'AiConversationSummary',
  z.object({
    id: z.string(),
    createdAt: z.string().datetime(),
    lastMessageAt: z.string().datetime(),
    messageCount: z.number().int(),
  }),
);

export const aiConversationDetailSchema = registry.register(
  'AiConversationDetail',
  aiConversationSummarySchema.extend({
    messages: z.array(
      z.object({
        role: z.enum(['user', 'assistant']),
        message: z.string().optional(),
        response: aiResponseSchema.optional(),
        createdAt: z.string().datetime(),
      }),
    ),
  }),
);

export const aiStatusSchema = registry.register(
  'AiStatus',
  z.object({
    available: z.boolean(),
    reason: z.enum(['PLATFORM_DISABLED', 'ORGANISATION_DISABLED', 'NOT_AUTHORISED']).optional(),
  }),
);

// --- M16.7 — Banking & Manual Bank Reconciliation ---

export const bankAccountTypeOpenApiSchema = registry.register(
  'BankAccountType',
  z.enum(['OPERATING', 'RESERVE', 'TRUST', 'OTHER']),
);

export const bankAccountStatusOpenApiSchema = registry.register(
  'BankAccountStatus',
  z.enum(['ACTIVE', 'INACTIVE']),
);

export const bankAccountViewSchema = registry.register(
  'BankAccountView',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'BANK-7F3Q2L' }),
    propertyId: z.string(),
    accountName: z.string().openapi({ example: 'Operating Account — Administration Fund' }),
    institutionName: z.string().openapi({ example: 'Commonwealth Bank' }),
    accountIdentifierMasked: z.string().openapi({
      description: 'The ONLY representation ever persisted — the raw identifier is never stored.',
      example: '••••1234',
    }),
    currencyCode: z.string(),
    accountType: bankAccountTypeOpenApiSchema,
    glCashAccountId: z.string(),
    glCashAccountCode: z.string(),
    glCashAccountName: z.string(),
    financialFundId: z.string().nullable(),
    fundName: z.string().nullable(),
    status: bankAccountStatusOpenApiSchema,
    openingReconciledBalance: z.string().nullable(),
    openingReconciledDate: z.string().nullable().openapi({ example: '2026-07-01' }),
    lastReconciledDate: z.string().nullable().openapi({
      description: 'periodEndDate of the latest RECONCILED reconciliation for this account, or null if never reconciled.',
      example: '2026-09-30',
    }),
    reconciliationStatus: z.enum(['NEVER_RECONCILED', 'UP_TO_DATE', 'DRAFT_IN_PROGRESS', 'REOPENED']),
    createdByUserId: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);
export const bankAccountListSchema = registry.register(
  'BankAccountList',
  z.object({ items: z.array(bankAccountViewSchema) }),
);

export const eligibleGlAccountViewSchema = registry.register(
  'EligibleGlAccountView',
  z.object({
    accountId: z.string(),
    accountCode: z.string(),
    accountName: z.string(),
    financialFundId: z.string().nullable(),
    fundName: z.string().nullable(),
  }),
);
export const eligibleGlAccountListSchema = registry.register(
  'EligibleGlAccountList',
  z.object({ items: z.array(eligibleGlAccountViewSchema) }),
);

export const bankImportPreviewRowSchema = registry.register(
  'BankImportPreviewRow',
  z.object({
    rowNumber: z.number().int(),
    transactionDate: z.string().nullable(),
    valueDate: z.string().nullable(),
    amount: z.string().nullable(),
    description: z.string(),
    bankReference: z.string().nullable(),
    runningBalance: z.string().nullable(),
    externalTransactionId: z.string().nullable(),
    sourceRowHash: z.string().nullable(),
    status: z.enum(['READY', 'DUPLICATE', 'ERROR']),
    issues: z.array(z.string()),
  }),
);
export const bankImportPreviewReportSchema = registry.register(
  'BankImportPreviewReport',
  z.object({
    fileName: z.string().nullable(),
    bankAccountId: z.string(),
    totalRows: z.number().int(),
    readyCount: z.number().int(),
    duplicateCount: z.number().int(),
    errorCount: z.number().int(),
    rows: z.array(bankImportPreviewRowSchema),
    fileAlreadyImported: z.boolean(),
  }),
);
export const bankImportApplyResultSchema = registry.register(
  'BankImportApplyResult',
  z.object({
    import: z.object({
      id: z.string(),
      publicReference: z.string().openapi({ example: 'BIMP-5K2J9P' }),
      totalRows: z.number().int(),
      importedCount: z.number().int(),
      duplicateCount: z.number().int(),
    }),
    transactionIds: z.array(z.string()),
  }),
);

export const bankTransactionMatchSummarySchema = registry.register(
  'BankTransactionMatchSummary',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'BMTCH-3H8D1Q' }),
    matchType: z.enum(['RECEIPT', 'JOURNAL_LINE', 'NEW_RECEIPT']),
    status: z.enum(['SUGGESTED', 'CONFIRMED', 'REVERSED']),
    confidence: z.string().openapi({ example: 'UNIQUE_REFERENCE' }),
    explanation: z.string(),
    receiptId: z.string().nullable(),
    receiptPublicReference: z.string().nullable(),
    journalLineId: z.string().nullable(),
    confirmedByUserId: z.string().nullable(),
    confirmedAt: z.string().datetime().nullable(),
  }),
);
export const bankTransactionViewSchema = registry.register(
  'BankTransactionView',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'BTX-2K9F3L' }),
    propertyId: z.string(),
    bankAccountId: z.string(),
    importBatchId: z.string(),
    transactionDate: z.string().openapi({ example: '2026-10-15' }),
    valueDate: z.string().nullable(),
    amount: z.string().openapi({ description: 'Signed — positive for a deposit, negative for a payment.' }),
    currencyCode: z.string(),
    description: z.string(),
    bankReference: z.string().nullable(),
    runningBalance: z.string().nullable(),
    externalTransactionId: z.string().nullable(),
    matchStatus: z.enum(['UNMATCHED', 'SUGGESTED', 'MATCHED', 'IGNORED']),
    reconciliationStatus: z.enum(['UNRECONCILED', 'RECONCILED']),
    reconciliationId: z.string().nullable(),
    createdAt: z.string().datetime(),
    activeMatch: bankTransactionMatchSummarySchema.nullable(),
  }),
);
export const bankTransactionListSchema = registry.register(
  'BankTransactionList',
  z.object({ items: z.array(bankTransactionViewSchema) }),
);

export const bankMatchSuggestionSchema = registry.register(
  'BankMatchSuggestion',
  z.object({
    id: z.string(),
    publicReference: z.string(),
    matchType: z.enum(['RECEIPT', 'JOURNAL_LINE']),
    confidence: z.string(),
    explanation: z.string(),
    receiptId: z.string().nullable(),
    receiptPublicReference: z.string().nullable(),
    receiptAmount: z.string().nullable(),
    journalLineId: z.string().nullable(),
  }),
);

export const bankReconciliationStatusOpenApiSchema = registry.register(
  'BankReconciliationStatus',
  z.enum(['DRAFT', 'IN_REVIEW', 'RECONCILED', 'REOPENED']),
);
export const bankReconciliationViewSchema = registry.register(
  'BankReconciliationView',
  z.object({
    id: z.string(),
    publicReference: z.string().openapi({ example: 'RECN-8G2K1L' }),
    propertyId: z.string(),
    bankAccountId: z.string(),
    periodStartDate: z.string().openapi({ example: '2026-10-01' }),
    periodEndDate: z.string().openapi({ example: '2026-10-31' }),
    statementOpeningBalance: z.string(),
    statementClosingBalance: z.string(),
    glOpeningBalance: z.string(),
    glClosingBalance: z.string(),
    outstandingDepositsTotal: z.string(),
    unpresentedPaymentsTotal: z.string(),
    difference: z.string().openapi({
      description: 'glClosingBalance - outstandingDepositsTotal + unpresentedPaymentsTotal - statementClosingBalance. Must be 0.00 to complete.',
    }),
    status: bankReconciliationStatusOpenApiSchema,
    supersedesReconciliationId: z.string().nullable(),
    preparedByUserId: z.string(),
    reviewedByUserId: z.string().nullable(),
    completedAt: z.string().datetime().nullable(),
    reopenedByUserId: z.string().nullable(),
    reopenedAt: z.string().datetime().nullable(),
    reopenReason: z.string().nullable(),
    statementInternallyConsistent: z.boolean().openapi({
      description: 'True if statementOpeningBalance + sum(imported transactions in period) == statementClosingBalance.',
    }),
    outstandingTransactionCount: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);
export const bankReconciliationListSchema = registry.register(
  'BankReconciliationList',
  z.object({ items: z.array(bankReconciliationViewSchema) }),
);
