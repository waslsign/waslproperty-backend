import { Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import { withPublicReference } from '../../lib/public-reference.js';
import { recordActivity } from '../activity/activity.js';
import type {
  CreateReceiptFromTransactionInput,
  ManualMatchJournalLineInput,
  ManualMatchReceiptInput,
} from './bank-matching.schemas.js';
import { ReceiptsService } from './receipts.service.js';
import { formatDateOnly } from '../../lib/dateOnly.js';

/**
 * M16.7 — deterministic, rule-based bank transaction matching (no AI, no
 * fuzzy scoring). See prisma/schema.prisma's "Banking & Manual Bank
 * Reconciliation" section doc comment. Default MVP policy throughout:
 * suggest automatically, confirm manually — nothing here changes
 * accounting state on its own; only `confirmSuggestedMatch`,
 * `manualMatchReceipt`, `manualMatchJournalLine` and
 * `createReceiptFromTransaction` do, and every one of them requires an
 * explicit call from an authorized manager (never triggered by
 * `generateSuggestions` itself).
 *
 * Rule priority (highest first; the first rule that yields EXACTLY ONE
 * unambiguous candidate wins — a rule yielding zero or more than one
 * candidate is skipped, never guessed):
 *   1. externalTransactionId == Receipt.externalBankReference (exact)
 *   2. bankReference == Receipt.paymentReference (exact, case-insensitive)
 *   3. description contains an existing Receipt's own publicReference
 *   4. exact amount + a lot reference (space code or "LOT n") identifiable
 *      in the description, unique to one candidate receipt for that lot
 *   5. exact amount + receipt date within a conservative 3-day window of
 *      the transaction date, unique to one candidate receipt
 *
 * Outgoing (negative-amount) transactions match only against existing,
 * unmatched JournalLine credits on the bank account's own GL cash account
 * — rule 6, exact amount + a 3-day date window, unique. This deliberately
 * never creates a new liability/expense — see this module's doc comment
 * on "no accounts-payable subsystem".
 */

export interface MatchSuggestionView {
  id: string;
  publicReference: string;
  matchType: 'RECEIPT' | 'JOURNAL_LINE';
  confidence: string;
  explanation: string;
  receiptId: string | null;
  receiptPublicReference: string | null;
  receiptAmount: string | null;
  journalLineId: string | null;
}

const DATE_WINDOW_DAYS = 3;

function withinDateWindow(a: Date, b: Date, days: number): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= days * 24 * 60 * 60 * 1000;
}

export class BankMatchingService {
  private readonly receipts: ReceiptsService;

  constructor(private readonly prisma: PrismaClient) {
    this.receipts = new ReceiptsService(prisma);
  }

  private async getOwnedTransaction(organisationId: string, propertyId: string, bankTransactionId: string) {
    const transaction = await this.prisma.bankTransaction.findFirst({
      where: { id: bankTransactionId, organisationId, propertyId },
      include: { bankAccount: true },
    });
    if (!transaction) throw new NotFoundError('Bank transaction not found');
    return transaction;
  }

  /** Candidate receipts for an incoming (positive) transaction: RECORDED,
   * same currency, exact amount match, same organisation/property, and —
   * if the bank account is fund-restricted — the same fund. A receipt
   * already carrying a CONFIRMED match is never a candidate ("do not
   * allocate the same receipt twice"). */
  private async candidateReceipts(
    organisationId: string,
    propertyId: string,
    amount: Prisma.Decimal,
    currencyCode: string,
    financialFundId: string | null,
  ) {
    const alreadyMatchedReceiptIds = (
      await this.prisma.bankTransactionMatch.findMany({
        where: { organisationId, propertyId, status: 'CONFIRMED', receiptId: { not: null } },
        select: { receiptId: true },
      })
    ).map((m) => m.receiptId as string);

    return this.prisma.receipt.findMany({
      where: {
        organisationId,
        propertyId,
        status: 'RECORDED',
        currencyCode,
        amount,
        financialFundId: financialFundId ?? undefined,
        id: { notIn: alreadyMatchedReceiptIds },
      },
      include: { space: { select: { code: true, lotNumber: true, name: true } } },
    });
  }

  private async candidateJournalLines(
    organisationId: string,
    propertyId: string,
    glCashAccountId: string,
    amount: Prisma.Decimal,
  ) {
    const alreadyMatchedLineIds = (
      await this.prisma.bankTransactionMatch.findMany({
        where: { organisationId, propertyId, status: 'CONFIRMED', journalLineId: { not: null } },
        select: { journalLineId: true },
      })
    ).map((m) => m.journalLineId as string);

    return this.prisma.journalLine.findMany({
      where: {
        organisationId,
        propertyId,
        accountId: glCashAccountId,
        credit: amount,
        id: { notIn: alreadyMatchedLineIds },
      },
      include: { journalEntry: { select: { effectiveDate: true, narration: true, sourceType: true } } },
    });
  }

  /** Read-only — proposes, never confirms. Returns the single best
   * suggestion if one unambiguous rule match was found, else null (the
   * transaction stays an exception for manual review). Does not persist
   * anything by itself; call `confirmSuggestedMatch`/`manualMatch*` to
   * actually change accounting-visible state. A fresh call always
   * replaces any prior SUGGESTED row for this transaction (superseded,
   * never left stale) — a CONFIRMED match is left completely alone. */
  async generateSuggestion(organisationId: string, propertyId: string, bankTransactionId: string): Promise<MatchSuggestionView | null> {
    const transaction = await this.getOwnedTransaction(organisationId, propertyId, bankTransactionId);
    if (transaction.matchStatus === 'MATCHED' || transaction.matchStatus === 'IGNORED') return null;

    let picked: { receiptId?: string; journalLineId?: string; confidence: string; explanation: string } | null = null;

    if (transaction.amount.greaterThan(0)) {
      const candidates = await this.candidateReceipts(
        organisationId,
        propertyId,
        transaction.amount,
        transaction.currencyCode,
        transaction.bankAccount.financialFundId,
      );

      // Rule 1: external reference.
      if (!picked && transaction.externalTransactionId) {
        const matches = candidates.filter((r) => r.externalBankReference === transaction.externalTransactionId);
        if (matches.length === 1) {
          const m = matches[0]!;
          picked = {
            receiptId: m.id,
            confidence: 'EXTERNAL_REFERENCE',
            explanation: `The bank's own transaction reference matches receipt ${m.publicReference}'s recorded bank reference exactly.`,
          };
        }
      }
      // Rule 2: bank/payment reference.
      if (!picked && transaction.bankReference) {
        const ref = transaction.bankReference.trim().toLowerCase();
        const matches = candidates.filter((r) => (r.paymentReference ?? '').trim().toLowerCase() === ref && ref !== '');
        if (matches.length === 1) {
          const m = matches[0]!;
          picked = {
            receiptId: m.id,
            confidence: 'UNIQUE_REFERENCE',
            explanation: `Unique payment reference and exact amount match with receipt ${m.publicReference}.`,
          };
        }
      }
      // Rule 3: receipt publicReference mentioned in the description.
      if (!picked) {
        const matches = candidates.filter((r) => transaction.description.toUpperCase().includes(r.publicReference));
        if (matches.length === 1) {
          const m = matches[0]!;
          picked = {
            receiptId: m.id,
            confidence: 'RECEIPT_REFERENCE_IN_DESCRIPTION',
            explanation: `Receipt ${m.publicReference} is referenced directly in the transaction description.`,
          };
        }
      }
      // Rule 4: exact amount + identifiable lot reference.
      if (!picked) {
        const desc = transaction.description.toUpperCase();
        const matches = candidates.filter((r) => {
          const code = r.space.code?.toUpperCase();
          const lotTag = r.space.lotNumber ? `LOT${r.space.lotNumber}`.toUpperCase() : null;
          const lotTagSpaced = r.space.lotNumber ? `LOT ${r.space.lotNumber}`.toUpperCase() : null;
          return (
            (code && desc.includes(code)) ||
            (lotTag && desc.replace(/\s+/g, '').includes(lotTag)) ||
            (lotTagSpaced && desc.includes(lotTagSpaced))
          );
        });
        if (matches.length === 1) {
          const m = matches[0]!;
          picked = {
            receiptId: m.id,
            confidence: 'EXACT_AMOUNT_LOT',
            explanation: `Exact amount match and a lot reference identifiable in the description (receipt ${m.publicReference}).`,
          };
        }
      }
      // Rule 5: exact amount + compatible date window.
      if (!picked) {
        const matches = candidates.filter((r) => withinDateWindow(r.receiptDate, transaction.transactionDate, DATE_WINDOW_DAYS));
        if (matches.length === 1) {
          const m = matches[0]!;
          picked = {
            receiptId: m.id,
            confidence: 'EXACT_AMOUNT_DATE',
            explanation: `Exact amount match and receipt date within ${DATE_WINDOW_DAYS} days of the transaction date (receipt ${m.publicReference}).`,
          };
        }
      }
    } else if (transaction.amount.lessThan(0)) {
      // Rule 6: outgoing — exact amount + date window against an existing,
      // unmatched GL cash credit on this bank account's own account.
      const candidates = await this.candidateJournalLines(
        organisationId,
        propertyId,
        transaction.bankAccount.glCashAccountId,
        transaction.amount.abs(),
      );
      const matches = candidates.filter((l) =>
        withinDateWindow(l.journalEntry.effectiveDate, transaction.transactionDate, DATE_WINDOW_DAYS),
      );
      if (matches.length === 1) {
        const m = matches[0]!;
        picked = {
          journalLineId: m.id,
          confidence: 'EXACT_AMOUNT_DATE_JOURNAL',
          explanation: `Exact amount match against an existing ledger cash movement ("${m.journalEntry.narration}") within ${DATE_WINDOW_DAYS} days.`,
        };
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Supersede any prior SUGGESTED row (never leave a stale one).
      await tx.bankTransactionMatch.updateMany({
        where: { bankTransactionId: transaction.id, status: 'SUGGESTED' },
        data: { status: 'REVERSED', reversalReason: 'Superseded by a fresh suggestion.' },
      });

      if (!picked) {
        if (transaction.matchStatus !== 'UNMATCHED') {
          await tx.bankTransaction.update({ where: { id: transaction.id }, data: { matchStatus: 'UNMATCHED' } });
        }
        return null;
      }

      const match = await withPublicReference('BMTCH', (publicReference) =>
        tx.bankTransactionMatch.create({
          data: {
            publicReference,
            organisationId,
            propertyId,
            bankTransactionId: transaction.id,
            matchType: picked!.receiptId ? 'RECEIPT' : 'JOURNAL_LINE',
            receiptId: picked!.receiptId ?? null,
            journalLineId: picked!.journalLineId ?? null,
            confidence: picked!.confidence,
            explanation: picked!.explanation,
            status: 'SUGGESTED',
          },
          include: { receipt: { select: { publicReference: true, amount: true } } },
        }),
      );

      await tx.bankTransaction.update({ where: { id: transaction.id }, data: { matchStatus: 'SUGGESTED' } });

      return {
        id: match.id,
        publicReference: match.publicReference,
        matchType: match.matchType as 'RECEIPT' | 'JOURNAL_LINE',
        confidence: match.confidence,
        explanation: match.explanation,
        receiptId: match.receiptId,
        receiptPublicReference: match.receipt?.publicReference ?? null,
        receiptAmount: match.receipt ? match.receipt.amount.toFixed(2) : null,
        journalLineId: match.journalLineId,
      };
    });
  }

  /** Confirms a previously generated SUGGESTED match — re-validates
   * everything (amount, currency, not-already-matched) at confirm time
   * rather than trusting the suggestion is still valid, since time may
   * have passed. Never posts a GL journal — RECEIPT/JOURNAL_LINE matches
   * only link to records that already exist. */
  async confirmSuggestedMatch(organisationId: string, actorUserId: string, propertyId: string, matchId: string) {
    return this.prisma.$transaction(async (tx) => {
      const match = await tx.bankTransactionMatch.findFirst({
        where: { id: matchId, organisationId, propertyId },
        include: { bankTransaction: true },
      });
      if (!match) throw new NotFoundError('Match suggestion not found');
      if (match.status !== 'SUGGESTED') throw new ConflictError('This match has already been confirmed or reversed.');

      await this.assertStillValid(tx, match);

      const confirmed = await tx.bankTransactionMatch.update({
        where: { id: matchId },
        data: { status: 'CONFIRMED', confirmedByUserId: actorUserId, confirmedAt: new Date() },
      });
      await tx.bankTransaction.update({ where: { id: match.bankTransactionId }, data: { matchStatus: 'MATCHED' } });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'BANK_TRANSACTION_MATCH_CONFIRMED',
        entityType: 'BankTransactionMatch',
        entityId: confirmed.id,
        title: `Bank match confirmed: ${match.bankTransaction.publicReference}`,
        description: match.explanation,
      });

      return confirmed;
    });
  }

  private async assertStillValid(
    tx: Prisma.TransactionClient,
    match: { receiptId: string | null; journalLineId: string | null; bankTransaction: { amount: Prisma.Decimal; currencyCode: string } },
  ) {
    if (match.receiptId) {
      const receipt = await tx.receipt.findUniqueOrThrow({ where: { id: match.receiptId } });
      if (receipt.status !== 'RECORDED') throw new ConflictError('The matched receipt has since been reversed.');
      if (!receipt.amount.equals(match.bankTransaction.amount)) {
        throw new ConflictError('The matched receipt amount no longer matches this transaction.');
      }
      if (receipt.currencyCode !== match.bankTransaction.currencyCode) {
        throw new ConflictError('Currency mismatch between the transaction and the matched receipt.');
      }
      const alreadyConfirmed = await tx.bankTransactionMatch.findFirst({
        where: { receiptId: match.receiptId, status: 'CONFIRMED' },
      });
      if (alreadyConfirmed) throw new ConflictError('This receipt is already matched to another bank transaction.');
    }
    if (match.journalLineId) {
      const line = await tx.journalLine.findUniqueOrThrow({ where: { id: match.journalLineId } });
      if (!line.credit.equals(match.bankTransaction.amount.abs())) {
        throw new ConflictError('The matched ledger line amount no longer matches this transaction.');
      }
      const alreadyConfirmed = await tx.bankTransactionMatch.findFirst({
        where: { journalLineId: match.journalLineId, status: 'CONFIRMED' },
      });
      if (alreadyConfirmed) throw new ConflictError('This ledger line is already matched to another bank transaction.');
    }
  }

  /** Manual match — the manager picks a specific receipt rather than
   * accepting (or in the absence of) a generated suggestion. Same
   * validation as confirming a suggestion; "do not match the same bank
   * transaction twice" is enforced by requiring the transaction currently
   * have no CONFIRMED match. */
  async manualMatchReceipt(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    bankTransactionId: string,
    input: ManualMatchReceiptInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.bankTransaction.findFirst({ where: { id: bankTransactionId, organisationId, propertyId } });
      if (!transaction) throw new NotFoundError('Bank transaction not found');
      if (transaction.matchStatus === 'MATCHED') throw new ConflictError('This bank transaction is already matched.');

      const receipt = await tx.receipt.findFirst({ where: { id: input.receiptId, organisationId, propertyId } });
      if (!receipt) throw new NotFoundError('Receipt not found');

      await tx.bankTransactionMatch.updateMany({
        where: { bankTransactionId, status: 'SUGGESTED' },
        data: { status: 'REVERSED', reversalReason: 'Superseded by a manual match.' },
      });

      const match = await withPublicReference('BMTCH', (publicReference) =>
        tx.bankTransactionMatch.create({
          data: {
            publicReference,
            organisationId,
            propertyId,
            bankTransactionId,
            matchType: 'RECEIPT',
            receiptId: receipt.id,
            confidence: 'MANUAL',
            explanation: `Manually matched to receipt ${receipt.publicReference} by the reviewing manager.`,
            status: 'SUGGESTED',
          },
        }),
      );

      await this.assertStillValid(tx, { receiptId: receipt.id, journalLineId: null, bankTransaction: transaction });

      const confirmed = await tx.bankTransactionMatch.update({
        where: { id: match.id },
        data: { status: 'CONFIRMED', confirmedByUserId: actorUserId, confirmedAt: new Date() },
      });
      await tx.bankTransaction.update({ where: { id: bankTransactionId }, data: { matchStatus: 'MATCHED' } });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'BANK_TRANSACTION_MATCH_CONFIRMED',
        entityType: 'BankTransactionMatch',
        entityId: confirmed.id,
        title: `Bank match confirmed (manual): ${transaction.publicReference} ↔ ${receipt.publicReference}`,
        description: null,
      });

      return confirmed;
    });
  }

  async manualMatchJournalLine(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    bankTransactionId: string,
    input: ManualMatchJournalLineInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.bankTransaction.findFirst({ where: { id: bankTransactionId, organisationId, propertyId } });
      if (!transaction) throw new NotFoundError('Bank transaction not found');
      if (transaction.matchStatus === 'MATCHED') throw new ConflictError('This bank transaction is already matched.');

      const line = await tx.journalLine.findFirst({ where: { id: input.journalLineId, organisationId, propertyId } });
      if (!line) throw new NotFoundError('Ledger line not found');

      await tx.bankTransactionMatch.updateMany({
        where: { bankTransactionId, status: 'SUGGESTED' },
        data: { status: 'REVERSED', reversalReason: 'Superseded by a manual match.' },
      });

      const match = await withPublicReference('BMTCH', (publicReference) =>
        tx.bankTransactionMatch.create({
          data: {
            publicReference,
            organisationId,
            propertyId,
            bankTransactionId,
            matchType: 'JOURNAL_LINE',
            journalLineId: line.id,
            confidence: 'MANUAL',
            explanation: 'Manually matched to an existing ledger cash movement by the reviewing manager.',
            status: 'SUGGESTED',
          },
        }),
      );

      await this.assertStillValid(tx, { receiptId: null, journalLineId: line.id, bankTransaction: transaction });

      const confirmed = await tx.bankTransactionMatch.update({
        where: { id: match.id },
        data: { status: 'CONFIRMED', confirmedByUserId: actorUserId, confirmedAt: new Date() },
      });
      await tx.bankTransaction.update({ where: { id: bankTransactionId }, data: { matchStatus: 'MATCHED' } });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'BANK_TRANSACTION_MATCH_CONFIRMED',
        entityType: 'BankTransactionMatch',
        entityId: confirmed.id,
        title: `Bank match confirmed (manual, ledger line): ${transaction.publicReference}`,
        description: null,
      });

      return confirmed;
    });
  }

  /** Reverses a CONFIRMED match — unlinks only; never touches the
   * underlying Receipt/JournalEntry itself (reversing THOSE, if ever
   * needed, is the existing ReceiptsService.reverseReceipt /
   * LedgerPostingService.reverse — out of scope for a match unlink). */
  async reverseMatch(organisationId: string, actorUserId: string, propertyId: string, matchId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const match = await tx.bankTransactionMatch.findFirst({
        where: { id: matchId, organisationId, propertyId },
        include: { bankTransaction: true },
      });
      if (!match) throw new NotFoundError('Match not found');
      if (match.status !== 'CONFIRMED') throw new ConflictError('Only a confirmed match can be reversed.');
      if (match.bankTransaction.reconciliationStatus === 'RECONCILED') {
        throw new ConflictError('This transaction is part of a completed reconciliation — reopen the reconciliation first.');
      }

      const reversed = await tx.bankTransactionMatch.update({
        where: { id: matchId },
        data: { status: 'REVERSED', reversedByUserId: actorUserId, reversedAt: new Date(), reversalReason: reason },
      });
      await tx.bankTransaction.update({ where: { id: match.bankTransactionId }, data: { matchStatus: 'UNMATCHED' } });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'BANK_TRANSACTION_MATCH_REVERSED',
        entityType: 'BankTransactionMatch',
        entityId: reversed.id,
        title: `Bank match reversed: ${match.bankTransaction.publicReference}`,
        description: reason,
      });

      return reversed;
    });
  }

  async ignoreTransaction(organisationId: string, actorUserId: string, propertyId: string, bankTransactionId: string, reason: string) {
    const transaction = await this.getOwnedTransaction(organisationId, propertyId, bankTransactionId);
    if (transaction.matchStatus === 'MATCHED') throw new ConflictError('A matched transaction cannot be ignored — reverse the match first.');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.bankTransaction.update({ where: { id: transaction.id }, data: { matchStatus: 'IGNORED' } });
      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'BANK_TRANSACTION_MATCH_REVERSED',
        entityType: 'BankTransaction',
        entityId: updated.id,
        title: `Bank transaction marked as will-never-match: ${updated.publicReference}`,
        description: reason,
      });
      return updated;
    });
  }

  /** The one controlled path to create a NEW Receipt from an unmatched
   * deposit — delegates entirely to the existing ReceiptsService
   * (never a second posting implementation), using the bank
   * transaction's own date/amount/currency, then links the two.
   * financials.approve only (this posts real GL entries), distinct from
   * confirmSuggestedMatch/manualMatch* (financials.manage, which never
   * post anything). */
  async createReceiptFromTransaction(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    bankTransactionId: string,
    input: CreateReceiptFromTransactionInput,
  ) {
    const transaction = await this.getOwnedTransaction(organisationId, propertyId, bankTransactionId);
    if (transaction.matchStatus === 'MATCHED') throw new ConflictError('This bank transaction is already matched.');
    if (!transaction.amount.greaterThan(0)) {
      throw new ConflictError('Only an incoming (positive) bank transaction can become a receipt.');
    }

    const receiptView = await this.receipts.recordReceipt(organisationId, actorUserId, propertyId, {
      spaceId: input.spaceId,
      financialFundId: input.financialFundId,
      amount: transaction.amount.toNumber(),
      paymentMethod: input.paymentMethod,
      paymentReference: input.paymentReference,
      description: input.description,
      receiptDate: formatDateOnly(transaction.transactionDate),
      postingDate: formatDateOnly(transaction.transactionDate),
      externalBankReference: transaction.externalTransactionId ?? transaction.bankReference ?? undefined,
      autoAllocate: input.autoAllocate,
      idempotencyKey: `BANKTX-${transaction.id}`,
    });

    return this.prisma.$transaction(async (tx) => {
      await tx.bankTransactionMatch.updateMany({
        where: { bankTransactionId, status: 'SUGGESTED' },
        data: { status: 'REVERSED', reversalReason: 'Superseded by a new receipt.' },
      });

      const match = await withPublicReference('BMTCH', (publicReference) =>
        tx.bankTransactionMatch.create({
          data: {
            publicReference,
            organisationId,
            propertyId,
            bankTransactionId,
            matchType: 'NEW_RECEIPT',
            receiptId: receiptView.id,
            confidence: 'NEW_RECEIPT',
            explanation: `A new receipt (${receiptView.publicReference}) was created from this previously unmatched deposit.`,
            status: 'CONFIRMED',
            confirmedByUserId: actorUserId,
            confirmedAt: new Date(),
          },
        }),
      );
      await tx.bankTransaction.update({ where: { id: bankTransactionId }, data: { matchStatus: 'MATCHED' } });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'BANK_TRANSACTION_MATCH_CONFIRMED',
        entityType: 'BankTransactionMatch',
        entityId: match.id,
        title: `New receipt created from bank transaction: ${receiptView.publicReference}`,
        description: null,
      });

      return { match, receipt: receiptView };
    });
  }
}
