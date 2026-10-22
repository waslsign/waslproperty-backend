import type {
  BankTransactionMatchStatus,
  BankTransactionReconciliationStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { NotFoundError } from '../../errors/AppError.js';
import { formatDateOnly } from '../../lib/dateOnly.js';
import type { ListBankTransactionsQuery } from './bank-import.schemas.js';

/** M16.7 — read-side of the bank transaction register (listing + detail).
 * Matching/confirmation itself lives in bank-matching.service.ts. */

export interface BankTransactionMatchSummary {
  id: string;
  publicReference: string;
  matchType: 'RECEIPT' | 'JOURNAL_LINE' | 'NEW_RECEIPT';
  status: 'SUGGESTED' | 'CONFIRMED' | 'REVERSED';
  confidence: string;
  explanation: string;
  receiptId: string | null;
  receiptPublicReference: string | null;
  journalLineId: string | null;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
}

export interface BankTransactionView {
  id: string;
  publicReference: string;
  propertyId: string;
  bankAccountId: string;
  importBatchId: string;
  transactionDate: string;
  valueDate: string | null;
  amount: string;
  currencyCode: string;
  description: string;
  bankReference: string | null;
  runningBalance: string | null;
  externalTransactionId: string | null;
  matchStatus: BankTransactionMatchStatus;
  reconciliationStatus: BankTransactionReconciliationStatus;
  reconciliationId: string | null;
  createdAt: string;
  activeMatch: BankTransactionMatchSummary | null;
}

const INCLUDE = {
  matches: {
    where: { status: { in: ['SUGGESTED', 'CONFIRMED'] as const } },
    include: { receipt: { select: { publicReference: true } } },
    orderBy: { suggestedAt: 'desc' as const },
    take: 1,
  },
} satisfies Prisma.BankTransactionInclude;

type TxWithIncludes = Prisma.BankTransactionGetPayload<{ include: typeof INCLUDE }>;

function toView(t: TxWithIncludes): BankTransactionView {
  const activeMatch = t.matches[0] ?? null;
  return {
    id: t.id,
    publicReference: t.publicReference,
    propertyId: t.propertyId,
    bankAccountId: t.bankAccountId,
    importBatchId: t.importBatchId,
    transactionDate: formatDateOnly(t.transactionDate),
    valueDate: t.valueDate ? formatDateOnly(t.valueDate) : null,
    amount: t.amount.toFixed(2),
    currencyCode: t.currencyCode,
    description: t.description,
    bankReference: t.bankReference,
    runningBalance: t.runningBalance ? t.runningBalance.toFixed(2) : null,
    externalTransactionId: t.externalTransactionId,
    matchStatus: t.matchStatus,
    reconciliationStatus: t.reconciliationStatus,
    reconciliationId: t.reconciliationId,
    createdAt: t.createdAt.toISOString(),
    activeMatch: activeMatch
      ? {
          id: activeMatch.id,
          publicReference: activeMatch.publicReference,
          matchType: activeMatch.matchType,
          status: activeMatch.status,
          confidence: activeMatch.confidence,
          explanation: activeMatch.explanation,
          receiptId: activeMatch.receiptId,
          receiptPublicReference: activeMatch.receipt?.publicReference ?? null,
          journalLineId: activeMatch.journalLineId,
          confirmedByUserId: activeMatch.confirmedByUserId,
          confirmedAt: activeMatch.confirmedAt ? activeMatch.confirmedAt.toISOString() : null,
        }
      : null,
  };
}

export class BankTransactionsService {
  constructor(private readonly prisma: PrismaClient) {}

  private async getOwnedProperty(organisationId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, organisationId } });
    if (!property) throw new NotFoundError('Property not found');
    return property;
  }

  async list(
    organisationId: string,
    propertyId: string,
    bankAccountId: string,
    filters: ListBankTransactionsQuery,
  ): Promise<BankTransactionView[]> {
    await this.getOwnedProperty(organisationId, propertyId);
    const account = await this.prisma.bankAccount.findFirst({ where: { id: bankAccountId, organisationId, propertyId } });
    if (!account) throw new NotFoundError('Bank account not found');

    const transactions = await this.prisma.bankTransaction.findMany({
      where: {
        organisationId,
        propertyId,
        bankAccountId,
        matchStatus: filters.matchStatus,
        reconciliationStatus: filters.reconciliationStatus,
        transactionDate: {
          gte: filters.fromDate ? new Date(`${filters.fromDate}T00:00:00.000Z`) : undefined,
          lte: filters.toDate ? new Date(`${filters.toDate}T00:00:00.000Z`) : undefined,
        },
        description: filters.search ? { contains: filters.search, mode: 'insensitive' } : undefined,
      },
      include: INCLUDE,
      orderBy: { transactionDate: 'desc' },
    });
    return transactions.map(toView);
  }

  async get(organisationId: string, propertyId: string, bankTransactionId: string): Promise<BankTransactionView> {
    await this.getOwnedProperty(organisationId, propertyId);
    const transaction = await this.prisma.bankTransaction.findFirst({
      where: { id: bankTransactionId, organisationId, propertyId },
      include: INCLUDE,
    });
    if (!transaction) throw new NotFoundError('Bank transaction not found');
    return toView(transaction);
  }
}
