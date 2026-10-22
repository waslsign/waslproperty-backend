import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import {
  generateBalanceSheetPdf,
  generateIncomeExpenseStatementPdf,
  generateLotOwnerStatementPdf,
  generatePropertyFinancialSummaryPdf,
} from '../../lib/financialReportDocument.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { authorizationService } from '../../middlewares/authorize.middleware.js';
import {
  balanceSheetQuerySchema,
  incomeExpenseQuerySchema,
  propertyFinancialSummaryQuerySchema,
} from './financial-reports.schemas.js';
import { FinancialReportsService } from './financial-reports.service.js';
import { lotStatementQuerySchema } from './lot-ledger.schemas.js';
import { LotLedgerService } from './lot-ledger.service.js';

const financialReportsService = new FinancialReportsService(getPrismaClient());
const lotLedgerService = new LotLedgerService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function getIncomeExpenseStatement(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = incomeExpenseQuerySchema.parse(req.query);
  const view = await financialReportsService.getIncomeExpenseStatement(
    auth.organisationId,
    req.params.propertyId as string,
    query.startDate,
    query.endDate,
    query.financialFundId,
    auth.userId,
  );
  res.json(view);
}

export async function downloadIncomeExpenseStatementPdf(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = incomeExpenseQuerySchema.parse(req.query);
  const view = await financialReportsService.getIncomeExpenseStatement(
    auth.organisationId,
    req.params.propertyId as string,
    query.startDate,
    query.endDate,
    query.financialFundId,
    auth.userId,
  );
  const bytes = await generateIncomeExpenseStatementPdf(view);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="income-expense-statement-${query.startDate}-to-${query.endDate}.pdf"`,
  );
  res.send(Buffer.from(bytes));
}

export async function getBalanceSheet(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = balanceSheetQuerySchema.parse(req.query);
  const view = await financialReportsService.getBalanceSheet(
    auth.organisationId,
    req.params.propertyId as string,
    query.asOfDate,
    query.financialFundId,
    auth.userId,
  );
  res.json(view);
}

export async function downloadBalanceSheetPdf(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = balanceSheetQuerySchema.parse(req.query);
  const view = await financialReportsService.getBalanceSheet(
    auth.organisationId,
    req.params.propertyId as string,
    query.asOfDate,
    query.financialFundId,
    auth.userId,
  );
  const bytes = await generateBalanceSheetPdf(view);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="balance-sheet-${query.asOfDate}.pdf"`);
  res.send(Buffer.from(bytes));
}

export async function getPropertyFinancialSummary(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = propertyFinancialSummaryQuerySchema.parse(req.query);
  const view = await financialReportsService.getPropertyFinancialSummary(
    auth.organisationId,
    req.params.propertyId as string,
    query.startDate,
    query.endDate,
    query.financialFundId,
    auth.userId,
  );
  res.json(view);
}

export async function downloadPropertyFinancialSummaryPdf(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = propertyFinancialSummaryQuerySchema.parse(req.query);
  const view = await financialReportsService.getPropertyFinancialSummary(
    auth.organisationId,
    req.params.propertyId as string,
    query.startDate,
    query.endDate,
    query.financialFundId,
    auth.userId,
  );
  const bytes = await generatePropertyFinancialSummaryPdf(view);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="financial-summary-${query.startDate}-to-${query.endDate}.pdf"`,
  );
  res.send(Buffer.from(bytes));
}

/**
 * Lot Owner Statement PDF — manager-facing only (see spec §5 / ADR-030):
 * this route requires `financials.view` on the property exactly like
 * every other lot-ledger endpoint, with no owner-self-service scoping
 * added. Zero new query logic — reuses LotLedgerService.getStatement,
 * the same call the existing JSON statement endpoint already makes.
 */
export async function downloadLotOwnerStatementPdf(req: Request, res: Response) {
  const auth = requireAuth(req);
  const propertyId = req.params.propertyId as string;
  const spaceId = req.params.spaceId as string;
  const query = lotStatementQuerySchema.parse(req.query);
  // Same split as the existing JSON statement endpoint (lot-ledger.controller.ts):
  // owner identity requires people.view independently of financials.view.
  const includeOwnerNames = await authorizationService.can(auth, 'people.view', propertyId);
  const statement = await lotLedgerService.getStatement(
    auth.organisationId,
    propertyId,
    spaceId,
    query.periodStartDate,
    query.periodEndDate,
    includeOwnerNames,
  );
  const bytes = await generateLotOwnerStatementPdf(statement);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="lot-statement-${query.periodStartDate}-to-${query.periodEndDate}.pdf"`,
  );
  res.send(Buffer.from(bytes));
}
