import { Prisma, type PaymentReminderStatus, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import { formatDateOnly } from '../../lib/dateOnly.js';
import { recordActivity } from '../activity/activity.js';
import { ArrearsService } from './arrears.service.js';
import { computeSuppressionReason, hasActiveReminderForStage } from './reminder-eligibility.service.js';
import { renderReminderEmail } from './reminder-email.js';
import { DEFAULT_POLICY } from './reminder-policy.service.js';
import { resolveRecipient } from './reminder-recipient.js';

/**
 * M16.8 — review/approval. ADR-029's core safety rule lives here:
 * `approve` ALWAYS recomputes live debt/recipient/case-state against the
 * existing M16.6 arrears/recipient logic immediately before writing
 * anything, and refuses to approve on any mismatch — refreshing the
 * candidate's own content in place and requiring a fresh, explicit
 * approve call on the updated figures rather than ever silently sending
 * stale content. The SAME revalidation runs again in
 * ReminderDispatchService immediately before the real provider call —
 * two independent checks, not one trusted twice.
 */

const NON_TERMINAL_FOR_APPROVAL: PaymentReminderStatus[] = ['READY_FOR_REVIEW'];

export interface ReminderQueueFilters {
  status?: PaymentReminderStatus;
  spaceId?: string;
}

function toQueueView(r: {
  id: string;
  publicReference: string;
  spaceId: string;
  collectionCaseId: string | null;
  status: PaymentReminderStatus;
  asOfDate: Date;
  totalAmountOwing: Prisma.Decimal;
  currencyCode: string;
  content: unknown;
  reminderStage: number;
  eligibilityReason: string | null;
  recipientEmail: string | null;
  recipientResolutionNote: string | null;
  dispatchAttempts: number;
  lastErrorCategory: string | null;
  submittedAt: Date | null;
  deliveredAt: Date | null;
  generatedAt: Date;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  templateVersion: number;
  policyVersion: number | null;
  providerMessageId: string | null;
  space: { name: string; code: string; lotNumber: string | null };
}) {
  return {
    id: r.id,
    publicReference: r.publicReference,
    spaceId: r.spaceId,
    lotLabel: r.space.lotNumber ? `Lot ${r.space.lotNumber}` : r.space.code || r.space.name,
    collectionCaseId: r.collectionCaseId,
    status: r.status,
    asOfDate: formatDateOnly(r.asOfDate),
    totalAmountOwing: r.totalAmountOwing.toFixed(2),
    currencyCode: r.currencyCode,
    content: r.content,
    reminderStage: r.reminderStage,
    eligibilityReason: r.eligibilityReason,
    recipientEmail: r.recipientEmail,
    recipientResolutionNote: r.recipientResolutionNote,
    dispatchAttempts: r.dispatchAttempts,
    lastErrorCategory: r.lastErrorCategory,
    submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
    deliveredAt: r.deliveredAt ? r.deliveredAt.toISOString() : null,
    generatedAt: r.generatedAt.toISOString(),
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    approvedByUserId: r.approvedByUserId,
    templateVersion: r.templateVersion,
    policyVersion: r.policyVersion,
    providerMessageId: r.providerMessageId,
  };
}

export class ReminderApprovalService {
  private readonly arrears: ArrearsService;

  constructor(private readonly prisma: PrismaClient) {
    this.arrears = new ArrearsService(prisma);
  }

  private async getOwnedProperty(organisationId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, organisationId } });
    if (!property) throw new NotFoundError('Property not found');
    return property;
  }

  async listQueue(organisationId: string, propertyId: string, filters: ReminderQueueFilters) {
    await this.getOwnedProperty(organisationId, propertyId);
    const rows = await this.prisma.paymentReminder.findMany({
      where: { organisationId, propertyId, status: filters.status, spaceId: filters.spaceId },
      include: { space: { select: { name: true, code: true, lotNumber: true } } },
      orderBy: { generatedAt: 'desc' },
      take: 200,
    });
    return rows.map(toQueueView);
  }

  /** Live detail — ALWAYS recomputes current arrears/recipient so the
   * review screen never shows stale content, whether or not the
   * underlying candidate has actually been refreshed yet. Also renders
   * the EXACT email the dispatch worker would send (same
   * `renderReminderEmail` call `ReminderDispatchService.dispatchOne`
   * uses) so a manager reviews real content, never a frontend
   * approximation — `emailPreview` is null (with a reason) whenever no
   * resolved recipient exists yet, since there is nothing truthful to
   * render a "to" line for. */
  async getDetail(organisationId: string, propertyId: string, reminderId: string) {
    const property = await this.getOwnedProperty(organisationId, propertyId);
    const reminder = await this.prisma.paymentReminder.findFirst({
      where: { id: reminderId, organisationId, propertyId },
      include: { space: { select: { name: true, code: true, lotNumber: true } } },
    });
    if (!reminder) throw new NotFoundError('Reminder not found');

    const todayStr = formatDateOnly(new Date());
    const live = await this.arrears.getLotDetail(organisationId, propertyId, reminder.spaceId, todayStr, false);
    const liveOverdue = live.charges.filter((c) => c.isOverdue);
    const liveTotalOverdue = liveOverdue.reduce((sum, c) => sum.plus(c.outstandingAmount), new Prisma.Decimal(0));
    const recipient = await resolveRecipient(this.prisma, organisationId, propertyId, reminder.spaceId, todayStr);

    const stale =
      !liveTotalOverdue.equals(reminder.totalAmountOwing) ||
      (recipient.primary?.email ?? null) !== reminder.recipientEmail;

    let emailPreview: { subject: string; html: string; text: string; to: string } | null = null;
    let emailPreviewUnavailableReason: string | null = null;
    if (recipient.status === 'RESOLVED' && recipient.primary) {
      const rendered = renderReminderEmail({
        schemeName: property.strataSchemeName ?? property.name,
        strataPlanNumber: property.strataPlanNumber,
        lotLabel: live.lotLabel,
        recipientFirstName: recipient.primary.firstName,
        asOfDate: todayStr,
        currencyCode: reminder.currencyCode,
        totalAmountOwing: liveTotalOverdue.toFixed(2),
        charges: liveOverdue,
      });
      emailPreview = { ...rendered, to: recipient.primary.email };
    } else {
      emailPreviewUnavailableReason = recipient.note ?? 'No resolved recipient — nothing to preview a "to" address for.';
    }

    return {
      reminder: toQueueView(reminder),
      live: {
        asOfDate: todayStr,
        totalOverdue: liveTotalOverdue.toFixed(2),
        charges: liveOverdue,
        recipientStatus: recipient.status,
        recipientEmail: recipient.primary?.email ?? null,
        recipientNote: recipient.note,
      },
      emailPreview,
      emailPreviewUnavailableReason,
      stale,
    };
  }

  /** DRAFT -> READY_FOR_REVIEW|SUPPRESSED|CANCELLED — the explicit,
   * authorized bridge from a manually drafted M16.6 reminder into the
   * unified M16.8 review/approval/dispatch pipeline (ADR-029 Addendum
   * 2). Applies the EXACT SAME restrictions the automated evaluator
   * applies — minimum-outstanding threshold, case-status suppression,
   * per-case/rolling-window caps (via the shared `computeSuppressionReason`),
   * and the (lot, stage) duplicate-active-reminder dedup (via the shared
   * `hasActiveReminderForStage`) — never a second, looser copy of those
   * rules. A manual submission can never bypass a restriction an
   * automated candidate would have been stopped by.
   *
   * Deliberately does NOT require `ReminderPolicy.enabled` (a manager
   * submitting right now is itself the authorization event the daily
   * automatic check exists to substitute for) and does NOT apply the
   * `initialDelayDays`/`followUpIntervalDays` TIMING rule — that rule
   * paces AUTOMATED reminders against a clock; it has no meaning against
   * a human who has already decided, right now, that this lot needs a
   * reminder. Every other restriction still applies in full.
   *
   * The settled-debt and duplicate/suppression checks below follow the
   * same "write via `this.prisma`, not inside the transaction you're
   * about to throw from" discipline as `approve()` for the settled-debt
   * branch (a throw inside an interactive transaction rolls back
   * whatever that transaction wrote). The duplicate-check +
   * status-transition itself DOES run inside one `Serializable`
   * transaction — stronger than the eligibility evaluator's own
   * check-then-create dedup (ADR-029 D8), because here the race is
   * between two requests touching a small, specific set of rows rather
   * than a scheduler sweeping every lot, and Postgres's serializable
   * isolation will abort one side of a genuine conflict rather than
   * silently letting both through. */
  async submitForReview(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    reminderId: string,
    now = new Date(),
  ) {
    await this.getOwnedProperty(organisationId, propertyId);

    const draft = await this.prisma.paymentReminder.findFirst({ where: { id: reminderId, organisationId, propertyId } });
    if (!draft) throw new NotFoundError('Reminder not found');
    if (draft.status !== 'DRAFT') {
      throw new ConflictError(`Only a DRAFT reminder can be submitted for review (current status: ${draft.status}).`);
    }

    const configuration = await this.prisma.financialConfiguration.findUnique({ where: { propertyId } });
    if (!configuration || !configuration.currencyCode) {
      throw new ConflictError('Financial management has not been fully configured for this property.');
    }

    const todayStr = formatDateOnly(now);
    const live = await this.arrears.getLotDetail(organisationId, propertyId, draft.spaceId, todayStr, false);
    const liveOverdue = live.charges.filter((c) => c.isOverdue);
    const liveTotalOverdue = liveOverdue.reduce((sum, c) => sum.plus(c.outstandingAmount), new Prisma.Decimal(0));

    if (liveTotalOverdue.lessThanOrEqualTo(0)) {
      await this.prisma.paymentReminder.update({
        where: { id: reminderId },
        data: { status: 'CANCELLED', cancelledByUserId: actorUserId, cancelledAt: now },
      });
      await recordActivity(this.prisma, {
        organisationId,
        propertyId,
        spaceId: draft.spaceId,
        actorUserId,
        eventType: 'PAYMENT_REMINDER_CANCELLED',
        entityType: 'PaymentReminder',
        entityId: draft.id,
        title: 'Draft reminder cancelled before submission — debt settled',
        description: null,
      });
      throw new ConflictError(
        'This debt has been settled since the reminder was drafted — the reminder was cancelled, not submitted.',
      );
    }

    const policyRow = await this.prisma.reminderPolicy.findUnique({ where: { propertyId } });
    const minimumOutstandingAmount = policyRow?.minimumOutstandingAmount ?? new Prisma.Decimal(DEFAULT_POLICY.minimumOutstandingAmount);
    if (liveTotalOverdue.lessThan(minimumOutstandingAmount)) {
      throw new ConflictError(
        `This lot's current outstanding balance (${liveTotalOverdue.toFixed(2)}) is below the configured minimum reminder threshold (${minimumOutstandingAmount.toFixed(2)}).`,
      );
    }

    const priorSentCount = await this.prisma.paymentReminder.count({
      where: { organisationId, propertyId, spaceId: draft.spaceId, status: { in: ['SENT', 'DELIVERED'] } },
    });
    const stage = priorSentCount + 1;

    const activeCase = live.collectionCases.find((c) => c.status !== 'CLOSED' && c.status !== 'RESOLVED') ?? null;
    const collectionCaseId = activeCase?.id ?? draft.collectionCaseId ?? null;

    const recipient = await resolveRecipient(this.prisma, organisationId, propertyId, draft.spaceId, todayStr);

    const content = {
      lotLabel: live.lotLabel,
      asOfDate: todayStr,
      totalAmountOwing: liveTotalOverdue.toFixed(2),
      currencyCode: draft.currencyCode,
      charges: liveOverdue.map((c) => ({
        publicReference: c.publicReference,
        levyScheduleName: c.levyScheduleName,
        dueDate: c.dueDate,
        fundName: c.fundName,
        outstandingAmount: c.outstandingAmount,
        daysOverdue: c.daysOverdue,
      })),
    };

    try {
      const updated = await this.prisma.$transaction(
        async (tx) => {
          if (await hasActiveReminderForStage(tx, organisationId, propertyId, draft.spaceId, stage, reminderId)) {
            throw new ConflictError(
              `Another reminder already exists for this lot at stage ${stage}. Resolve or cancel it before submitting this draft.`,
            );
          }

          const suppressionReason = await computeSuppressionReason(
            tx,
            organisationId,
            propertyId,
            draft.spaceId,
            activeCase?.status ?? null,
            collectionCaseId,
            policyRow ?? { version: 0, maxRemindersPerCase: null, maxRemindersInRollingWindow: null, rollingWindowDays: null },
            now,
          );

          const claim = await tx.paymentReminder.updateMany({
            where: { id: reminderId, status: 'DRAFT' },
            data: suppressionReason
              ? {
                  status: 'SUPPRESSED',
                  collectionCaseId,
                  reminderStage: stage,
                  totalAmountOwing: liveTotalOverdue.toFixed(2),
                  content,
                  eligibilityReason: suppressionReason,
                  policyVersion: policyRow?.version ?? null,
                }
              : {
                  status: 'READY_FOR_REVIEW',
                  collectionCaseId,
                  reminderStage: stage,
                  totalAmountOwing: liveTotalOverdue.toFixed(2),
                  content,
                  eligibilityReason: `Submitted for review by manager — stage ${stage}.`,
                  recipientContactId: recipient.primary?.contactId ?? null,
                  recipientEmail: recipient.primary?.email ?? null,
                  recipientResolutionNote: recipient.note,
                  policyVersion: policyRow?.version ?? null,
                },
          });
          if (claim.count === 0) {
            throw new ConflictError('This reminder was already submitted, cancelled, or changed by someone else.');
          }

          const fresh = await tx.paymentReminder.findUniqueOrThrow({ where: { id: reminderId } });

          await recordActivity(tx, {
            organisationId,
            propertyId,
            spaceId: draft.spaceId,
            actorUserId,
            eventType: suppressionReason ? 'REMINDER_SUBMISSION_SUPPRESSED' : 'REMINDER_SUBMITTED_FOR_REVIEW',
            entityType: 'PaymentReminder',
            entityId: fresh.id,
            title: suppressionReason
              ? `Manual reminder suppressed for ${live.lotLabel} (stage ${stage})`
              : `Manual reminder submitted for review: ${live.lotLabel} (stage ${stage})`,
            description:
              suppressionReason ?? (recipient.status === 'RESOLVED' ? `Recipient resolved: ${recipient.primary!.email}` : recipient.note),
          });

          return fresh;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return toQueueView({ ...updated, space: await this.spaceLabel(draft.spaceId) });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
        throw new ConflictError('This reminder was submitted concurrently by another request — please retry.');
      }
      throw err;
    }
  }

  /** Refreshes a candidate's own snapshot (content/amount/recipient) to
   * CURRENT live figures, without approving it — the one write `approve`
   * makes when it finds stale content, also callable directly so a
   * manager can refresh a candidate from the review screen before
   * re-attempting approval. */
  private async refreshCandidate(
    organisationId: string,
    propertyId: string,
    reminderId: string,
    now: Date,
  ): Promise<{ refreshed: boolean; totalOverdue: Prisma.Decimal; recipientStatus: string }> {
    const reminder = await this.prisma.paymentReminder.findFirstOrThrow({
      where: { id: reminderId, organisationId, propertyId },
    });
    const todayStr = formatDateOnly(now);
    const live = await this.arrears.getLotDetail(organisationId, propertyId, reminder.spaceId, todayStr, false);
    const liveOverdue = live.charges.filter((c) => c.isOverdue);
    const liveTotalOverdue = liveOverdue.reduce((sum, c) => sum.plus(c.outstandingAmount), new Prisma.Decimal(0));
    const recipient = await resolveRecipient(this.prisma, organisationId, propertyId, reminder.spaceId, todayStr);

    const matches =
      liveTotalOverdue.equals(reminder.totalAmountOwing) &&
      (recipient.primary?.email ?? null) === reminder.recipientEmail;

    if (!matches) {
      const content = {
        lotLabel: live.lotLabel,
        asOfDate: todayStr,
        totalAmountOwing: liveTotalOverdue.toFixed(2),
        currencyCode: reminder.currencyCode,
        charges: liveOverdue.map((c) => ({
          publicReference: c.publicReference,
          levyScheduleName: c.levyScheduleName,
          dueDate: c.dueDate,
          fundName: c.fundName,
          outstandingAmount: c.outstandingAmount,
          daysOverdue: c.daysOverdue,
        })),
      };
      await this.prisma.paymentReminder.update({
        where: { id: reminderId },
        data: {
          asOfDate: new Date(`${todayStr}T00:00:00.000Z`),
          totalAmountOwing: liveTotalOverdue.toFixed(2),
          content,
          recipientContactId: recipient.primary?.contactId ?? null,
          recipientEmail: recipient.primary?.email ?? null,
          recipientResolutionNote: recipient.note,
        },
      });
    }

    return { refreshed: !matches, totalOverdue: liveTotalOverdue, recipientStatus: recipient.status };
  }

  /** Deliberately NOT one single $transaction end to end: the
   * settled-debt/refreshed-content early exits below must PERSIST their
   * write (CANCELLED status, or the refreshed snapshot) even though the
   * call itself still reports failure to the caller — a ConflictError
   * thrown inside an interactive transaction rolls the whole transaction
   * back, which would silently discard that write. Only the final,
   * all-or-nothing approval write is wrapped in its own transaction. */
  async approve(organisationId: string, actorUserId: string, propertyId: string, reminderId: string, now = new Date()) {
    await this.getOwnedProperty(organisationId, propertyId);

    const reminder = await this.prisma.paymentReminder.findFirst({ where: { id: reminderId, organisationId, propertyId } });
    if (!reminder) throw new NotFoundError('Reminder not found');
    if (!NON_TERMINAL_FOR_APPROVAL.includes(reminder.status)) {
      throw new ConflictError(`Only a READY_FOR_REVIEW reminder can be approved (current status: ${reminder.status}).`);
    }

    const { refreshed, totalOverdue, recipientStatus } = await this.refreshCandidate(
      organisationId,
      propertyId,
      reminderId,
      now,
    );

    if (totalOverdue.lessThanOrEqualTo(0)) {
      await this.prisma.paymentReminder.update({
        where: { id: reminderId },
        data: { status: 'CANCELLED', cancelledByUserId: actorUserId, cancelledAt: now },
      });
      await recordActivity(this.prisma, {
        organisationId,
        propertyId,
        spaceId: reminder.spaceId,
        actorUserId,
        eventType: 'REMINDER_APPROVAL_INVALIDATED',
        entityType: 'PaymentReminder',
        entityId: reminder.id,
        title: `Reminder cancelled before approval — debt settled`,
        description: null,
      });
      throw new ConflictError('This debt has been settled since the reminder was generated — the reminder was cancelled, not approved.');
    }

    if (refreshed) {
      await recordActivity(this.prisma, {
        organisationId,
        propertyId,
        spaceId: reminder.spaceId,
        actorUserId,
        eventType: 'REMINDER_APPROVAL_INVALIDATED',
        entityType: 'PaymentReminder',
        entityId: reminder.id,
        title: 'Reminder content refreshed — debt or recipient changed since generation',
        description: 'Re-review and approve again with the updated figures.',
      });
      throw new ConflictError(
        'The outstanding amount or recipient has changed since this reminder was generated. Its content has been refreshed — please review the updated figures and approve again.',
      );
    }

    if (recipientStatus !== 'RESOLVED') {
      throw new ConflictError('No valid recipient could be resolved for this lot — resolve the recipient before approving.');
    }

    return this.prisma.$transaction(async (tx) => {
      const fresh = await tx.paymentReminder.findUniqueOrThrow({ where: { id: reminderId } });
      const policy = await tx.reminderPolicy.findUnique({ where: { propertyId } });

      const approvalSnapshot = {
        approvedByUserId: actorUserId,
        approvedAt: now.toISOString(),
        recipientContactId: fresh.recipientContactId,
        recipientEmail: fresh.recipientEmail,
        totalAmountOwing: fresh.totalAmountOwing.toFixed(2),
        currencyCode: fresh.currencyCode,
        charges: (fresh.content as { charges?: unknown[] }).charges ?? [],
        templateVersion: fresh.templateVersion,
        policyVersion: policy?.version ?? fresh.policyVersion ?? null,
      };

      const approved = await tx.paymentReminder.update({
        where: { id: reminderId },
        data: {
          status: 'APPROVED',
          approvedByUserId: actorUserId,
          approvedAt: now,
          approvalSnapshot: approvalSnapshot as Prisma.InputJsonValue,
          policyVersion: policy?.version ?? fresh.policyVersion,
        },
      });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        spaceId: reminder.spaceId,
        actorUserId,
        eventType: 'REMINDER_APPROVED',
        entityType: 'PaymentReminder',
        entityId: approved.id,
        title: `Reminder approved for ${fresh.totalAmountOwing.toFixed(2)} ${fresh.currencyCode}`,
        description: `Recipient: ${fresh.recipientEmail}`,
      });

      return approved;
    });
  }

  /** Controlled batch approval — approves each id independently (one
   * failure never aborts the rest), returning a clear per-id outcome so
   * the frontend can show exact counts before/after confirmation. */
  async batchApprove(organisationId: string, actorUserId: string, propertyId: string, reminderIds: string[]) {
    const results: Array<{ reminderId: string; approved: boolean; reason?: string }> = [];
    for (const reminderId of reminderIds) {
      try {
        await this.approve(organisationId, actorUserId, propertyId, reminderId);
        results.push({ reminderId, approved: true });
      } catch (err) {
        results.push({ reminderId, approved: false, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    return {
      approvedCount: results.filter((r) => r.approved).length,
      skippedCount: results.filter((r) => !r.approved).length,
      results,
    };
  }

  /** Extends M16.6's cancelReminder to the full M16.8 lifecycle — any
   * non-terminal, non-in-flight status can be cancelled by a human
   * decision. QUEUED/SENDING are deliberately excluded (a dispatch is
   * actually in progress); SENT/DELIVERED/FAILED/QUARANTINED are
   * terminal or require their own resolution path. */
  async cancel(organisationId: string, actorUserId: string, propertyId: string, reminderId: string, reason?: string) {
    await this.getOwnedProperty(organisationId, propertyId);
    const reminder = await this.prisma.paymentReminder.findFirst({ where: { id: reminderId, organisationId, propertyId } });
    if (!reminder) throw new NotFoundError('Reminder not found');
    const cancellable: PaymentReminderStatus[] = ['DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'SUPPRESSED'];
    if (!cancellable.includes(reminder.status)) {
      throw new ConflictError(`A reminder with status ${reminder.status} cannot be cancelled.`);
    }

    const updated = await this.prisma.paymentReminder.update({
      where: { id: reminderId },
      data: { status: 'CANCELLED', cancelledByUserId: actorUserId, cancelledAt: new Date() },
    });

    await recordActivity(this.prisma, {
      organisationId,
      propertyId,
      spaceId: reminder.spaceId,
      actorUserId,
      eventType: 'PAYMENT_REMINDER_CANCELLED',
      entityType: 'PaymentReminder',
      entityId: updated.id,
      title: `Reminder cancelled: ${updated.publicReference}`,
      description: reason ?? null,
    });

    return toQueueView({ ...updated, space: await this.spaceLabel(reminder.spaceId) });
  }

  private async spaceLabel(spaceId: string) {
    const space = await this.prisma.space.findUniqueOrThrow({
      where: { id: spaceId },
      select: { name: true, code: true, lotNumber: true },
    });
    return space;
  }
}
