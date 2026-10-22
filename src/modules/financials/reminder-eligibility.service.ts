import { Prisma, type PrismaClient } from '@prisma/client';
import { parseDateOnly } from '../../lib/dateOnly.js';
import { withPublicReference } from '../../lib/public-reference.js';
import { recordActivity } from '../activity/activity.js';
import { ArrearsService } from './arrears.service.js';
import { resolveRecipient } from './reminder-recipient.js';
import { formatDateInTimeZone } from './reminder-timezone.js';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** CollectionCaseStatus values that put reminder eligibility on hold for
 * a lot — see prisma/schema.prisma's CollectionCaseStatus doc comment
 * (point: AWAITING_PAYMENT stands in for "an active payment
 * arrangement", since this schema has no separate PaymentArrangement
 * model) and ADR-029's "suppress when... according to existing case
 * state semantics" requirement. RESOLVED/CLOSED are deliberately NOT
 * here — a closed case means that collection episode is over, not that
 * the lot can never be reminded again for a genuinely new debt.
 * Exported because M16.8.1 (manual-draft submission, ADR-029 Addendum 2)
 * applies the exact same rule, never a second copy of it. */
export const CASE_SUPPRESSING_STATUSES = new Set(['AWAITING_PAYMENT', 'DISPUTED', 'PAUSED', 'ESCALATED']);

export interface EvaluationSummary {
  asOfDate: string;
  lotsConsidered: number;
  candidatesCreated: number;
  suppressedCreated: number;
  skipped: number;
}

export interface SuppressionPolicyInputs {
  version: number;
  maxRemindersPerCase: number | null;
  maxRemindersInRollingWindow: number | null;
  rollingWindowDays: number | null;
}

/** The ONE place "should this reminder be suppressed instead of sent to
 * review" is decided — case-status hold, then per-case cap, then
 * rolling-window cap, first match wins. Called identically by the
 * automated evaluator (`evaluate`, below) and by
 * `ReminderApprovalService.submitForReview` (manual-draft submission) so
 * a manually-submitted reminder can never bypass a restriction an
 * automated one would have been stopped by (ADR-029 Addendum 2). */
export async function computeSuppressionReason(
  prisma: PrismaClient | Prisma.TransactionClient,
  organisationId: string,
  propertyId: string,
  spaceId: string,
  activeCollectionCaseStatus: string | null,
  collectionCaseId: string | null,
  policy: SuppressionPolicyInputs,
  now: Date,
): Promise<string | null> {
  if (activeCollectionCaseStatus && CASE_SUPPRESSING_STATUSES.has(activeCollectionCaseStatus)) {
    return `Collection case is ${activeCollectionCaseStatus} — reminders are on hold.`;
  }
  if (policy.maxRemindersPerCase && collectionCaseId) {
    const caseSentCount = await prisma.paymentReminder.count({
      where: { organisationId, propertyId, collectionCaseId, status: { in: ['SENT', 'DELIVERED'] } },
    });
    if (caseSentCount >= policy.maxRemindersPerCase) {
      return `Maximum reminders per collection case (${policy.maxRemindersPerCase}) already reached.`;
    }
  }
  if (policy.maxRemindersInRollingWindow && policy.rollingWindowDays) {
    const windowStart = new Date(now.getTime() - policy.rollingWindowDays * DAY_MS);
    const windowCount = await prisma.paymentReminder.count({
      where: {
        organisationId,
        propertyId,
        spaceId,
        status: { in: ['SENT', 'DELIVERED'] },
        OR: [{ submittedAt: { gte: windowStart } }, { submittedAt: null, generatedAt: { gte: windowStart } }],
      },
    });
    if (windowCount >= policy.maxRemindersInRollingWindow) {
      return `Maximum reminders in the trailing ${policy.rollingWindowDays}-day window (${policy.maxRemindersInRollingWindow}) already reached.`;
    }
  }
  return null;
}

/** True if a non-terminal (or already-suppressed) reminder already
 * exists for this exact (lot, stage) pair — the shared dedup rule both
 * the automated evaluator and manual submission apply, so the two entry
 * points can never both leave an active reminder in play for the same
 * debt episode. `excludeReminderId` lets a manual submission check
 * against every OTHER reminder without tripping over itself. */
export async function hasActiveReminderForStage(
  prisma: PrismaClient | Prisma.TransactionClient,
  organisationId: string,
  propertyId: string,
  spaceId: string,
  stage: number,
  excludeReminderId?: string,
): Promise<boolean> {
  const existing = await prisma.paymentReminder.findFirst({
    where: {
      organisationId,
      propertyId,
      spaceId,
      reminderStage: stage,
      status: { in: ['READY_FOR_REVIEW', 'APPROVED', 'QUEUED', 'SENDING', 'SUPPRESSED'] },
      ...(excludeReminderId ? { id: { not: excludeReminderId } } : {}),
    },
  });
  return existing !== null;
}

/**
 * M16.8 — the daily eligibility evaluator. Reuses
 * ArrearsService.getOverdueLotsForReminders for every arrears figure
 * (ADR-029: never a second, independently-maintained overdue
 * calculation) and resolveRecipient for every recipient question. Never
 * sends anything — its only effect is creating READY_FOR_REVIEW or
 * SUPPRESSED PaymentReminder rows for a manager to see. Idempotent
 * across repeated runs the same day via the per-(lot, stage) dedup check
 * before any write — service-level, not a DB constraint, same
 * "service-level dedup" precedent as PostingProfileRule/FinancialFund's
 * own duplicate checks elsewhere in this codebase.
 *
 * Does NOT auto-create a CollectionCase. If a non-CLOSED/RESOLVED case
 * already exists for the lot, a new candidate is linked to it (so the
 * Collection Timeline shows the reminder alongside other activity); if
 * none exists, the candidate is created with `collectionCaseId: null` —
 * opening a case remains a deliberate human action via the existing
 * M16.6 `createCollectionCase` endpoint.
 */
export class ReminderEligibilityService {
  private readonly arrears: ArrearsService;

  constructor(private readonly prisma: PrismaClient) {
    this.arrears = new ArrearsService(prisma);
  }

  async evaluate(organisationId: string, propertyId: string, now = new Date()): Promise<EvaluationSummary> {
    const policy = await this.prisma.reminderPolicy.findUnique({ where: { propertyId } });
    const asOfDate = formatDateInTimeZone(now, policy?.timezone ?? 'Australia/Sydney');

    if (!policy || !policy.enabled) {
      return { asOfDate, lotsConsidered: 0, candidatesCreated: 0, suppressedCreated: 0, skipped: 0 };
    }

    const configuration = await this.prisma.financialConfiguration.findUnique({ where: { propertyId } });
    if (!configuration || !configuration.currencyCode) {
      // Financial management isn't fully set up — nothing to evaluate,
      // never an error (the same "quietly nothing to do" posture as
      // every other arrears read against an unconfigured property).
      return { asOfDate, lotsConsidered: 0, candidatesCreated: 0, suppressedCreated: 0, skipped: 0 };
    }

    const currencyCode = configuration.currencyCode;
    const lots = await this.arrears.getOverdueLotsForReminders(organisationId, propertyId, asOfDate);
    let candidatesCreated = 0;
    let suppressedCreated = 0;
    let skipped = 0;

    for (const lot of lots) {
      const totalOverdue = new Prisma.Decimal(lot.totalOverdue);
      if (totalOverdue.lessThanOrEqualTo(0)) continue;
      if (totalOverdue.lessThan(policy.minimumOutstandingAmount)) {
        skipped++;
        continue;
      }

      const overdueCharges = lot.charges.filter((c) => c.isOverdue);
      if (overdueCharges.length === 0) continue;

      const priorSent = await this.prisma.paymentReminder.findMany({
        where: { organisationId, propertyId, spaceId: lot.spaceId, status: { in: ['SENT', 'DELIVERED'] } },
        orderBy: { generatedAt: 'desc' },
        select: { submittedAt: true, generatedAt: true },
      });
      const stage = priorSent.length + 1;

      // Timing eligibility.
      const daysSinceOldestDue = overdueCharges.reduce(
        (max, c) => Math.max(max, c.daysOverdue),
        0,
      );
      let due: boolean;
      if (stage === 1) {
        due = daysSinceOldestDue >= policy.initialDelayDays;
      } else {
        const last = priorSent[0]!;
        const lastSentAt = last.submittedAt ?? last.generatedAt;
        const daysSinceLastSent = Math.floor((now.getTime() - lastSentAt.getTime()) / DAY_MS);
        due = daysSinceLastSent >= policy.followUpIntervalDays;
      }
      if (!due) {
        skipped++;
        continue;
      }

      // Dedup — never a second non-terminal (or already-suppressed)
      // candidate for the same (lot, stage).
      if (await hasActiveReminderForStage(this.prisma, organisationId, propertyId, lot.spaceId, stage)) {
        skipped++;
        continue;
      }

      const activeCollectionCaseStatus = lot.collectionStatus !== 'NONE' ? lot.collectionStatus : null;
      const suppressionReason = await computeSuppressionReason(
        this.prisma,
        organisationId,
        propertyId,
        lot.spaceId,
        activeCollectionCaseStatus,
        lot.collectionCaseId,
        policy,
        now,
      );

      const content = {
        lotLabel: lot.lotLabel,
        asOfDate,
        totalAmountOwing: totalOverdue.toFixed(2),
        currencyCode,
        charges: overdueCharges.map((c) => ({
          publicReference: c.publicReference,
          levyScheduleName: c.levyScheduleName,
          dueDate: c.dueDate,
          fundName: c.fundName,
          outstandingAmount: c.outstandingAmount,
          daysOverdue: c.daysOverdue,
        })),
      };

      if (suppressionReason) {
        const reminder = await withPublicReference('PRM', (publicReference) =>
          this.prisma.paymentReminder.create({
            data: {
              publicReference,
              organisationId,
              propertyId,
              spaceId: lot.spaceId,
              collectionCaseId: lot.collectionCaseId,
              status: 'SUPPRESSED',
              asOfDate: parseDateOnly(asOfDate),
              totalAmountOwing: totalOverdue.toFixed(2),
              currencyCode,
              content,
              reminderStage: stage,
              policyVersion: policy.version,
              eligibilityReason: suppressionReason,
              generatedByUserId: null,
            },
          }),
        );
        await recordActivity(this.prisma, {
          organisationId,
          propertyId,
          spaceId: lot.spaceId,
          actorUserId: null,
          eventType: 'REMINDER_CANDIDATE_SUPPRESSED',
          entityType: 'PaymentReminder',
          entityId: reminder.id,
          title: `Reminder suppressed for ${lot.lotLabel} (stage ${stage})`,
          description: suppressionReason,
        });
        suppressedCreated++;
        continue;
      }

      const recipient = await resolveRecipient(this.prisma, organisationId, propertyId, lot.spaceId, asOfDate);

      const reminder = await withPublicReference('PRM', (publicReference) =>
        this.prisma.paymentReminder.create({
          data: {
            publicReference,
            organisationId,
            propertyId,
            spaceId: lot.spaceId,
            collectionCaseId: lot.collectionCaseId,
            status: 'READY_FOR_REVIEW',
            asOfDate: parseDateOnly(asOfDate),
            totalAmountOwing: totalOverdue.toFixed(2),
            currencyCode,
            content,
            reminderStage: stage,
            policyVersion: policy.version,
            eligibilityReason: `${daysSinceOldestDue} day(s) overdue, stage ${stage}.`,
            recipientContactId: recipient.primary?.contactId ?? null,
            recipientEmail: recipient.primary?.email ?? null,
            recipientResolutionNote: recipient.note,
            generatedByUserId: null,
          },
        }),
      );
      await recordActivity(this.prisma, {
        organisationId,
        propertyId,
        spaceId: lot.spaceId,
        actorUserId: null,
        eventType: 'REMINDER_CANDIDATE_CREATED',
        entityType: 'PaymentReminder',
        entityId: reminder.id,
        title: `Reminder candidate created for ${lot.lotLabel} (stage ${stage})`,
        description: recipient.status === 'RESOLVED' ? `Recipient resolved: ${recipient.primary!.email}` : recipient.note,
      });
      candidatesCreated++;
    }

    await this.prisma.reminderPolicy.update({
      where: { propertyId },
      data: {
        lastEvaluatedAt: now,
        lastEvaluationNote: `${lots.length} lot(s) considered — ${candidatesCreated} candidate(s), ${suppressedCreated} suppressed, ${skipped} skipped.`,
      },
    });

    return { asOfDate, lotsConsidered: lots.length, candidatesCreated, suppressedCreated, skipped };
  }

  /** The scheduler's own entry point — loops every property with a
   * reminder policy explicitly enabled (tenant/property isolation is
   * structural here: each property is evaluated independently, in its
   * own organisation scope, never a cross-property batch query). A
   * single property's failure is logged and does not stop the rest —
   * same "one bad row never blocks the whole run" posture as
   * ContractorComplianceNotificationService. */
  async evaluateAllEnabledProperties(now = new Date()): Promise<{ properties: number; summaries: EvaluationSummary[] }> {
    const policies = await this.prisma.reminderPolicy.findMany({
      where: { enabled: true },
      select: { organisationId: true, propertyId: true },
    });
    const summaries: EvaluationSummary[] = [];
    for (const policy of policies) {
      const summary = await this.evaluate(policy.organisationId, policy.propertyId, now);
      summaries.push(summary);
    }
    return { properties: policies.length, summaries };
  }
}
