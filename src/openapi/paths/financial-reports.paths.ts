import { z } from 'zod';
import {
  balanceSheetQuerySchema,
  incomeExpenseQuerySchema,
} from '../../modules/financials/financial-reports.schemas.js';
import { lotStatementQuerySchema } from '../../modules/financials/lot-ledger.schemas.js';
import { commonErrors, jsonContent } from '../components/common.schemas.js';
import { registry, SECURITY_CUSTOMER } from '../registry.js';
import { propertyIdPathParam } from './properties.paths.js';

/**
 * FIN-021 (limited scope) — Financial Statements & Reporting. See
 * docs/architecture/financial-statements-reporting-spec.md and ADR-030.
 */

const TAG = 'Financial Management — Reports (FIN-021)';

const reportAccountLineSchema = z.object({
  accountId: z.string(),
  accountCode: z.string(),
  accountName: z.string(),
  amount: z.string(),
});

const periodDisclosureSchema = z.object({
  periodOpen: z.boolean(),
  noCoveringPeriod: z.boolean(),
});

const incomeExpenseFundSectionSchema = z.object({
  financialFundId: z.string(),
  fundName: z.string(),
  income: z.array(reportAccountLineSchema),
  expense: z.array(reportAccountLineSchema),
  totalIncome: z.string(),
  totalExpense: z.string(),
  netSurplusOrDeficit: z.string(),
});

const incomeExpenseStatementSchema = z.object({
  propertyId: z.string(),
  propertyName: z.string(),
  strataPlanNumber: z.string().nullable(),
  currencyCode: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  accountingBasis: z.literal('ACCRUAL'),
  periodDisclosure: periodDisclosureSchema,
  funds: z.array(incomeExpenseFundSectionSchema),
  combined: z
    .object({ totalIncome: z.string(), totalExpense: z.string(), netSurplusOrDeficit: z.string() })
    .nullable(),
  generatedAt: z.string(),
  generatedByUserId: z.string(),
});

const balanceSheetSchema = z.object({
  propertyId: z.string(),
  propertyName: z.string(),
  strataPlanNumber: z.string().nullable(),
  currencyCode: z.string(),
  asOfDate: z.string(),
  accountingBasis: z.literal('ACCRUAL'),
  periodDisclosure: periodDisclosureSchema,
  assets: z.array(reportAccountLineSchema),
  liabilities: z.array(reportAccountLineSchema),
  equity: z.array(reportAccountLineSchema),
  currentEarningsUnclosed: z.string(),
  totalAssets: z.string(),
  totalLiabilitiesAndEquity: z.string(),
  balanceCheckDifference: z.string(),
  generatedAt: z.string(),
  generatedByUserId: z.string(),
});

const propertyFinancialSummarySchema = z.object({
  incomeExpenseStatement: incomeExpenseStatementSchema,
  balanceSheet: balanceSheetSchema,
});

const pdfResponse = { description: 'PDF file.', content: { 'application/pdf': { schema: { type: 'string' as const, format: 'binary' as const } } } };

// --- Income & Expense Statement ---

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/reports/income-expense',
  operationId: 'getIncomeExpenseStatement',
  tags: [TAG],
  summary: 'Income & Expense Statement for a date range, per fund.',
  description:
    'Requires `financials.view`. Accrual basis (matches the underlying ledger). Reports every ' +
    'fund separately — never a single blended total only — plus a combined total when more ' +
    'than one fund is included. Flags (never blocks) a still-open accounting period or a window ' +
    'with no covering period at all.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam, query: incomeExpenseQuerySchema },
  responses: {
    200: jsonContent(incomeExpenseStatementSchema, 'Income & Expense Statement.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/reports/income-expense/pdf',
  operationId: 'downloadIncomeExpenseStatementPdf',
  tags: [TAG],
  summary: 'Downloads the Income & Expense Statement as a PDF.',
  description: 'Requires `financials.view`. Same figures as the JSON endpoint, rendered as a PDF.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam, query: incomeExpenseQuerySchema },
  responses: { 200: pdfResponse, 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404], 409: commonErrors[409] },
});

// --- Balance Sheet ---

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/reports/balance-sheet',
  operationId: 'getBalanceSheet',
  tags: [TAG],
  summary: 'Balance Sheet as at a selected date.',
  description:
    'Requires `financials.view`. Cumulative since the property’s financial cutover, not ' +
    'period-bound. Includes an explicit, always-present "current surplus/(deficit), unclosed" ' +
    'equity line and balance-check difference — this milestone has no year-end close, so nothing ' +
    'ever sweeps a period’s net result into a recorded equity account (see ADR-030).',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam, query: balanceSheetQuerySchema },
  responses: {
    200: jsonContent(balanceSheetSchema, 'Balance Sheet.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/reports/balance-sheet/pdf',
  operationId: 'downloadBalanceSheetPdf',
  tags: [TAG],
  summary: 'Downloads the Balance Sheet as a PDF.',
  description: 'Requires `financials.view`. Same figures as the JSON endpoint, rendered as a PDF.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam, query: balanceSheetQuerySchema },
  responses: { 200: pdfResponse, 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404], 409: commonErrors[409] },
});

// --- Property Financial Summary ---

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/reports/summary',
  operationId: 'getPropertyFinancialSummary',
  tags: [TAG],
  summary: 'Property Financial Summary: Income & Expense Statement plus Balance Sheet as at the window’s end date.',
  description: 'Requires `financials.view`. A presentation composite — introduces no new calculation.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam, query: incomeExpenseQuerySchema },
  responses: {
    200: jsonContent(propertyFinancialSummarySchema, 'Property Financial Summary.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/reports/summary/pdf',
  operationId: 'downloadPropertyFinancialSummaryPdf',
  tags: [TAG],
  summary: 'Downloads the Property Financial Summary as a PDF.',
  description: 'Requires `financials.view`. Same figures as the JSON endpoint, rendered as a PDF.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam, query: incomeExpenseQuerySchema },
  responses: { 200: pdfResponse, 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404], 409: commonErrors[409] },
});

// --- Lot Owner Statement PDF ---

const spaceIdPathParam = registry.register(
  'LotOwnerStatementPdfPathParam',
  z.object({ propertyId: z.string(), spaceId: z.string() }),
);

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/lots/{spaceId}/statement/pdf',
  operationId: 'downloadLotOwnerStatementPdf',
  tags: [TAG],
  summary: 'Downloads a lot owner statement as a PDF.',
  description:
    'Requires `financials.view`. Manager-facing only — no owner self-service scoping (see ' +
    'ADR-030). Zero new calculation: reuses the same LotLedgerService.getStatement the existing ' +
    'JSON statement endpoint already calls. Owner name is included only if the caller also holds ' +
    '`people.view`, same split as the JSON statement endpoint.',
  security: SECURITY_CUSTOMER,
  request: { params: spaceIdPathParam, query: lotStatementQuerySchema },
  responses: { 200: pdfResponse, 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404] },
});
