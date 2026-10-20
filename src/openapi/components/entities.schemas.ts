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
  netBalance: z.string(),
});

export const trialBalanceListSchema = registry.register(
  'TrialBalanceList',
  z.object({ items: z.array(trialBalanceRowSchema) }),
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
