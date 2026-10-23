import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import { parseDateOnly } from '../../lib/dateOnly.js';
import { AccountingPeriodsService } from './accounting-periods.service.js';
import { LedgerPostingService } from './ledger-posting.service.js';

/**
 * FIN-021 (limited scope) — Financial Statements & Reporting. See
 * docs/architecture/financial-statements-reporting-spec.md and ADR-030
 * for the full specification these methods implement.
 *
 * Every number here comes from a fresh read-time aggregation over
 * JournalLine/JournalEntry/AccountingAccount — exactly the same source
 * LedgerPostingService.trialBalance already reads, and for the Balance
 * Sheet this service calls trialBalance directly rather than
 * re-implementing its aggregation. Nothing is stored, cached, or
 * invented: a property with no posted journals in the requested window
 * reports zero, not a fabricated figure.
 */

export type PeriodDisclosure = {
  /** True if any date in the report's window falls inside an
   * AccountingPeriod whose status is still OPEN — see spec §3. Year-end
   * close/locking is out of scope for this milestone; this flag exists
   * only to say so honestly on every report, never to block one. */
  periodOpen: boolean;
  /** True if some date in the window has no AccountingPeriod row
   * covering it at all — see spec §4.3. */
  noCoveringPeriod: boolean;
};

export interface ReportAccountLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  /** Always positive — the report's own section (Income/Expense,
   * Asset/Liability/Equity) already establishes the sign. */
  amount: string;
}

export interface IncomeExpenseFundSection {
  financialFundId: string;
  fundName: string;
  income: ReportAccountLine[];
  expense: ReportAccountLine[];
  totalIncome: string;
  totalExpense: string;
  netSurplusOrDeficit: string;
}

export interface IncomeExpenseStatementView {
  propertyId: string;
  propertyName: string;
  strataPlanNumber: string | null;
  currencyCode: string;
  startDate: string;
  endDate: string;
  accountingBasis: 'ACCRUAL';
  periodDisclosure: PeriodDisclosure;
  funds: IncomeExpenseFundSection[];
  /** Present only when more than one fund is included (no fund filter
   * supplied) — see spec §2.1. Never the only figure shown. */
  combined: {
    totalIncome: string;
    totalExpense: string;
    netSurplusOrDeficit: string;
  } | null;
  generatedAt: string;
  generatedByUserId: string;
}

export interface BalanceSheetView {
  propertyId: string;
  propertyName: string;
  strataPlanNumber: string | null;
  currencyCode: string;
  asOfDate: string;
  accountingBasis: 'ACCRUAL';
  periodDisclosure: PeriodDisclosure;
  assets: ReportAccountLine[];
  liabilities: ReportAccountLine[];
  equity: ReportAccountLine[];
  /** Accumulated INCOME − EXPENSE since the property's financial
   * cutover, up to asOfDate — not a stored equity account. Because this
   * milestone has no year-end close, nothing ever sweeps a period's net
   * result into a recorded equity account; omitting this line would make
   * totalAssets never equal totalLiabilitiesAndEquity for any property
   * with real trading activity. This is standard double-entry
   * presentation (the universal "current year earnings" line every
   * unclosed ledger needs), not a new accounting policy — see spec §2.2. */
  currentEarningsUnclosed: string;
  totalAssets: string;
  totalLiabilitiesAndEquity: string;
  /** Always "0.00" for a correctly-posted ledger — surfaced explicitly
   * rather than silently netted away, so a genuine anomaly is visible. */
  balanceCheckDifference: string;
  generatedAt: string;
  generatedByUserId: string;
}

export interface PropertyFinancialSummaryView {
  incomeExpenseStatement: IncomeExpenseStatementView;
  balanceSheet: BalanceSheetView;
}

const CREDIT_NORMAL = new Set(['LIABILITY', 'EQUITY', 'INCOME']);

export class FinancialReportsService {
  private readonly ledgerPostingService: LedgerPostingService;
  private readonly accountingPeriodsService: AccountingPeriodsService;

  constructor(private readonly prisma: PrismaClient) {
    this.ledgerPostingService = new LedgerPostingService(prisma);
    this.accountingPeriodsService = new AccountingPeriodsService(prisma);
  }

  private async getOwnedProperty(organisationId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, organisationId } });
    if (!property) throw new NotFoundError('Property not found');
    return property;
  }

  private async getActiveConfiguration(organisationId: string, propertyId: string) {
    await this.getOwnedProperty(organisationId, propertyId);
    const configuration = await this.prisma.financialConfiguration.findUnique({ where: { propertyId } });
    if (!configuration || configuration.status !== 'ACTIVE') {
      throw new ConflictError('Financial management has not been set up for this property yet.');
    }
    return configuration;
  }

  private async getPeriodDisclosure(propertyId: string, dates: Date[]): Promise<PeriodDisclosure> {
    let periodOpen = false;
    let noCoveringPeriod = false;
    for (const date of dates) {
      const period = await this.accountingPeriodsService.findCoveringPeriod(this.prisma, propertyId, date);
      if (!period) {
        noCoveringPeriod = true;
      } else if (period.status === 'OPEN') {
        periodOpen = true;
      }
    }
    return { periodOpen, noCoveringPeriod };
  }

  /** Mirrors LedgerPostingService.trialBalance's own aggregation exactly
   * (same Decimal(14,2) handling, same per-account grouping), but filters
   * JournalEntry.effectiveDate to a [start, end] window rather than a
   * single as-of cutoff — trialBalance's cumulative-since-inception
   * semantics are correct for a Balance Sheet, never correct for an
   * Income & Expense Statement, which must be period-bound. */
  private async aggregateJournalLinesInRange(
    organisationId: string,
    propertyId: string,
    startDate: Date,
    endDate: Date,
    financialFundId: string | undefined,
  ) {
    const lines = await this.prisma.journalLine.findMany({
      where: {
        organisationId,
        propertyId,
        financialFundId,
        journalEntry: { effectiveDate: { gte: startDate, lte: endDate } },
      },
      include: { account: { select: { code: true, name: true, classification: true } } },
    });

    const byAccount = new Map<
      string,
      { code: string; name: string; classification: string; debit: Prisma.Decimal; credit: Prisma.Decimal }
    >();
    for (const line of lines) {
      const bucket = byAccount.get(line.accountId) ?? {
        code: line.account.code,
        name: line.account.name,
        classification: line.account.classification,
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(0),
      };
      bucket.debit = bucket.debit.plus(line.debit);
      bucket.credit = bucket.credit.plus(line.credit);
      byAccount.set(line.accountId, bucket);
    }
    return byAccount;
  }

  private accountNet(classification: string, debit: Prisma.Decimal, credit: Prisma.Decimal): Prisma.Decimal {
    return CREDIT_NORMAL.has(classification) ? credit.minus(debit) : debit.minus(credit);
  }

  async getIncomeExpenseStatement(
    organisationId: string,
    propertyId: string,
    startDate: string,
    endDate: string,
    financialFundId: string | undefined,
    actorUserId: string,
  ): Promise<IncomeExpenseStatementView> {
    const property = await this.getOwnedProperty(organisationId, propertyId);
    const configuration = await this.getActiveConfiguration(organisationId, propertyId);
    const start = parseDateOnly(startDate);
    const end = parseDateOnly(endDate);

    const funds = financialFundId
      ? [await this.prisma.financialFund.findFirst({ where: { id: financialFundId, organisationId, propertyId } })]
      : await this.prisma.financialFund.findMany({ where: { organisationId, propertyId }, orderBy: { name: 'asc' } });
    const realFunds = funds.filter((f): f is NonNullable<typeof f> => f !== null);
    if (financialFundId && realFunds.length === 0) throw new NotFoundError('Fund not found');

    const fundSections: IncomeExpenseFundSection[] = [];
    let combinedIncome = new Prisma.Decimal(0);
    let combinedExpense = new Prisma.Decimal(0);

    for (const fund of realFunds) {
      const byAccount = await this.aggregateJournalLinesInRange(organisationId, propertyId, start, end, fund.id);
      const income: ReportAccountLine[] = [];
      const expense: ReportAccountLine[] = [];
      let totalIncome = new Prisma.Decimal(0);
      let totalExpense = new Prisma.Decimal(0);

      for (const [accountId, b] of byAccount) {
        if (b.classification !== 'INCOME' && b.classification !== 'EXPENSE') continue;
        const net = this.accountNet(b.classification, b.debit, b.credit);
        const line: ReportAccountLine = { accountId, accountCode: b.code, accountName: b.name, amount: net.abs().toFixed(2) };
        if (b.classification === 'INCOME') {
          income.push(line);
          totalIncome = totalIncome.plus(net);
        } else {
          expense.push(line);
          totalExpense = totalExpense.plus(net);
        }
      }

      income.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
      expense.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
      combinedIncome = combinedIncome.plus(totalIncome);
      combinedExpense = combinedExpense.plus(totalExpense);

      fundSections.push({
        financialFundId: fund.id,
        fundName: fund.name,
        income,
        expense,
        totalIncome: totalIncome.toFixed(2),
        totalExpense: totalExpense.toFixed(2),
        netSurplusOrDeficit: totalIncome.minus(totalExpense).toFixed(2),
      });
    }

    const periodDisclosure = await this.getPeriodDisclosure(propertyId, [start, end]);

    return {
      propertyId,
      propertyName: property.name,
      strataPlanNumber: property.strataPlanNumber ?? null,
      currencyCode: configuration.currencyCode ?? 'AUD',
      startDate,
      endDate,
      accountingBasis: 'ACCRUAL',
      periodDisclosure,
      funds: fundSections,
      combined:
        fundSections.length > 1
          ? {
              totalIncome: combinedIncome.toFixed(2),
              totalExpense: combinedExpense.toFixed(2),
              netSurplusOrDeficit: combinedIncome.minus(combinedExpense).toFixed(2),
            }
          : null,
      generatedAt: new Date().toISOString(),
      generatedByUserId: actorUserId,
    };
  }

  async getBalanceSheet(
    organisationId: string,
    propertyId: string,
    asOfDate: string,
    financialFundId: string | undefined,
    actorUserId: string,
  ): Promise<BalanceSheetView> {
    const property = await this.getOwnedProperty(organisationId, propertyId);
    const configuration = await this.getActiveConfiguration(organisationId, propertyId);

    // Reuses LedgerPostingService.trialBalance exactly — no new
    // cumulative-aggregation logic for the balance-sheet accounts.
    const rows = await this.ledgerPostingService.trialBalance(organisationId, propertyId, asOfDate, financialFundId);

    const assets: ReportAccountLine[] = [];
    const liabilities: ReportAccountLine[] = [];
    const equity: ReportAccountLine[] = [];
    let totalAssets = new Prisma.Decimal(0);
    let totalLiabilitiesEquity = new Prisma.Decimal(0);

    for (const row of rows) {
      const net = new Prisma.Decimal(row.netBalance); // debit-positive
      const line: ReportAccountLine = {
        accountId: row.accountId,
        accountCode: row.accountCode,
        accountName: row.accountName,
        amount: net.abs().toFixed(2),
      };
      if (row.classification === 'ASSET') {
        assets.push(line);
        totalAssets = totalAssets.plus(net);
      } else if (row.classification === 'LIABILITY') {
        liabilities.push(line);
        totalLiabilitiesEquity = totalLiabilitiesEquity.plus(net.neg());
      } else if (row.classification === 'EQUITY') {
        equity.push(line);
        totalLiabilitiesEquity = totalLiabilitiesEquity.plus(net.neg());
      }
    }

    // Current-period (unclosed) earnings — see currentEarningsUnclosed's
    // doc comment on BalanceSheetView. Income/Expense accounts since the
    // property's financial cutover, up to asOfDate — the same aggregation
    // shape as the Income & Expense Statement, just with no start bound.
    const cutoverDate = configuration.cutoverDate ?? new Date(0);
    const sinceInception = await this.aggregateJournalLinesInRange(
      organisationId,
      propertyId,
      cutoverDate,
      parseDateOnly(asOfDate),
      financialFundId,
    );
    let currentEarnings = new Prisma.Decimal(0);
    for (const b of sinceInception.values()) {
      // accountNet returns each classification's own normal-balance
      // magnitude (credit-debit for INCOME, debit-credit for EXPENSE —
      // both positive for a normal balance, same convention the Income &
      // Expense Statement uses). Earnings is income minus expense, never
      // the sum of both — an expense must reduce current earnings, not
      // inflate it alongside income.
      if (b.classification === 'INCOME') {
        currentEarnings = currentEarnings.plus(this.accountNet(b.classification, b.debit, b.credit));
      } else if (b.classification === 'EXPENSE') {
        currentEarnings = currentEarnings.minus(this.accountNet(b.classification, b.debit, b.credit));
      }
    }
    totalLiabilitiesEquity = totalLiabilitiesEquity.plus(currentEarnings);

    assets.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    liabilities.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    equity.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    const periodDisclosure = await this.getPeriodDisclosure(propertyId, [parseDateOnly(asOfDate)]);

    return {
      propertyId,
      propertyName: property.name,
      strataPlanNumber: property.strataPlanNumber ?? null,
      currencyCode: configuration.currencyCode ?? 'AUD',
      asOfDate,
      accountingBasis: 'ACCRUAL',
      periodDisclosure,
      assets,
      liabilities,
      equity,
      currentEarningsUnclosed: currentEarnings.toFixed(2),
      totalAssets: totalAssets.toFixed(2),
      totalLiabilitiesAndEquity: totalLiabilitiesEquity.toFixed(2),
      balanceCheckDifference: totalAssets.minus(totalLiabilitiesEquity).toFixed(2),
      generatedAt: new Date().toISOString(),
      generatedByUserId: actorUserId,
    };
  }

  async getPropertyFinancialSummary(
    organisationId: string,
    propertyId: string,
    startDate: string,
    endDate: string,
    financialFundId: string | undefined,
    actorUserId: string,
  ): Promise<PropertyFinancialSummaryView> {
    const [incomeExpenseStatement, balanceSheet] = await Promise.all([
      this.getIncomeExpenseStatement(organisationId, propertyId, startDate, endDate, financialFundId, actorUserId),
      this.getBalanceSheet(organisationId, propertyId, endDate, financialFundId, actorUserId),
    ]);
    return { incomeExpenseStatement, balanceSheet };
  }
}
