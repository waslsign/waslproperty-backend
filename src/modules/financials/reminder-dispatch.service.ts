import { Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import { env } from '../../config/env.js';
import { emailService, isEmailSendSuppressed } from '../../lib/email.js';
import { EmailProviderError } from '../../lib/email/types.js';
import { formatDateOnly } from '../../lib/dateOnly.js';
import { logger } from '../../lib/logger.js';
import { withPublicReference } from '../../lib/public-reference.js';
import { recordActivity } from '../activity/activity.js';
import { ArrearsService } from './arrears.service.js';
import { renderReminderEmail, TEMPLATE_VERSION } from './reminder-email.js';
import { resolveRecipient } from './reminder-recipient.js';

/**
 * M16.8 — the dispatch worker. See prisma/schema.prisma's "Arrears
 * Reminder Delivery & Scheduling" section doc comment, points 2 and 3.
 *
 * Every send goes through the SAME emailService.send() every other
 * domain module uses (src/lib/email.ts) — EMAIL_SEND_DISABLED is checked
 * explicitly BEFORE that call (not left to EmailService's own internal
 * suppression) so a suppressed run can be told apart from a real SENT
 * outcome at the reminder's own status level, never silently reporting
 * SENT when nothing was actually attempted (see dispatchOne's own
 * comment on the `isEmailSendSuppressed()` guard).
 */

export class ReminderDispatchService {
  private readonly arrears: ArrearsService;

  constructor(private readonly prisma: PrismaClient) {
    this.arrears = new ArrearsService(prisma);
  }

  /** Claims up to `batchSize` APPROVED reminders whose property has
   * delivery explicitly enabled, atomically (APPROVED -> QUEUED via
   * updateMany, same compare-and-swap pattern as
   * CommunicationDeliveryService.processDue) so two concurrent worker
   * instances can never both claim the same reminder. */
  async processDue(now = new Date(), batchSize = 10): Promise<{ processed: number }> {
    const enabledPropertyIds = (
      await this.prisma.reminderPolicy.findMany({ where: { deliveryEnabled: true }, select: { propertyId: true } })
    ).map((p) => p.propertyId);
    if (enabledPropertyIds.length === 0) return { processed: 0 };

    const due = await this.prisma.paymentReminder.findMany({
      where: { status: 'APPROVED', propertyId: { in: enabledPropertyIds } },
      take: batchSize,
      select: { id: true },
    });

    let processed = 0;
    for (const { id } of due) {
      const claim = await this.prisma.paymentReminder.updateMany({
        where: { id, status: 'APPROVED' },
        data: { status: 'QUEUED' },
      });
      if (claim.count === 0) continue; // already claimed elsewhere
      await this.dispatchOne(id, now);
      processed++;
    }
    return { processed };
  }

  /** The one place a reminder actually attempts a real send. Must only
   * ever be called on a reminder already in QUEUED (claimed via
   * processDue's atomic updateMany, or the manual single-dispatch
   * controller action, which performs the same claim). */
  async dispatchOne(reminderId: string, now = new Date()): Promise<void> {
    const reminder = await this.prisma.paymentReminder.findUnique({ where: { id: reminderId } });
    if (!reminder || reminder.status !== 'QUEUED') return;

    const policy = await this.prisma.reminderPolicy.findUnique({ where: { propertyId: reminder.propertyId } });
    if (!policy?.deliveryEnabled) {
      await this.revertToApproved(reminder.id, 'Delivery is not enabled for this property.');
      return;
    }

    // Revalidate live debt/recipient/case-state one more time,
    // immediately before the real provider call — ADR-029's second
    // independent check (approve() already ran the first).
    const todayStr = formatDateOnly(now);
    const live = await this.arrears.getLotDetail(reminder.organisationId, reminder.propertyId, reminder.spaceId, todayStr, false);
    const liveOverdue = live.charges.filter((c) => c.isOverdue);
    const liveTotalOverdue = liveOverdue.reduce((sum, c) => sum.plus(c.outstandingAmount), new Prisma.Decimal(0));
    const recipient = await resolveRecipient(this.prisma, reminder.organisationId, reminder.propertyId, reminder.spaceId, todayStr);

    const stillValid =
      liveTotalOverdue.greaterThan(0) &&
      liveTotalOverdue.equals(reminder.totalAmountOwing) &&
      recipient.status === 'RESOLVED' &&
      recipient.primary?.email === reminder.recipientEmail;

    if (!stillValid) {
      await this.prisma.$transaction(async (tx) => {
        await tx.paymentReminder.update({ where: { id: reminder.id }, data: { status: 'READY_FOR_REVIEW' } });
        await recordActivity(tx, {
          organisationId: reminder.organisationId,
          propertyId: reminder.propertyId,
          spaceId: reminder.spaceId,
          actorUserId: null,
          eventType: 'REMINDER_APPROVAL_INVALIDATED',
          entityType: 'PaymentReminder',
          entityId: reminder.id,
          title: 'Approved reminder invalidated at dispatch time — debt, case state or recipient changed',
          description: 'Returned to review; nothing was sent.',
        });
      });
      return;
    }

    // The explicit, hard EMAIL_SEND_DISABLED guard — checked here, not
    // left implicit inside emailService.send(), so a suppressed run can
    // never be confused with a real SENT outcome at the reminder's own
    // status level. Reverts to APPROVED (not SENT, not FAILED) — this
    // was never attempted at all.
    if (isEmailSendSuppressed()) {
      await this.revertToApproved(reminder.id, 'EMAIL_SEND_DISABLED — delivery suppressed, nothing was sent.');
      await recordActivity(this.prisma, {
        organisationId: reminder.organisationId,
        propertyId: reminder.propertyId,
        spaceId: reminder.spaceId,
        actorUserId: null,
        eventType: 'REMINDER_DISPATCH_SUPPRESSED_BY_KILL_SWITCH',
        entityType: 'PaymentReminder',
        entityId: reminder.id,
        title: 'Reminder dispatch suppressed — EMAIL_SEND_DISABLED is set',
        description: null,
      });
      return;
    }

    await this.prisma.paymentReminder.update({ where: { id: reminder.id }, data: { status: 'SENDING' } });

    const attemptNumber = reminder.dispatchAttempts + 1;
    const attempt = await withPublicReference('PRDA', (publicReference) =>
      this.prisma.paymentReminderDeliveryAttempt.create({
        data: {
          publicReference,
          organisationId: reminder.organisationId,
          propertyId: reminder.propertyId,
          paymentReminderId: reminder.id,
          attemptNumber,
          idempotencyKey: `${reminder.id}:${attemptNumber}`,
          startedAt: now,
        },
      }),
    );

    try {
      const property = await this.prisma.property.findUniqueOrThrow({
        where: { id: reminder.propertyId },
        select: { name: true, strataSchemeName: true, strataPlanNumber: true },
      });
      const content = reminder.content as {
        lotLabel: string;
        charges: Array<{ publicReference: string; levyScheduleName: string; dueDate: string; fundName: string; outstandingAmount: string }>;
      };
      const rendered = renderReminderEmail({
        schemeName: property.strataSchemeName ?? property.name,
        strataPlanNumber: property.strataPlanNumber,
        lotLabel: content.lotLabel,
        recipientFirstName: recipient.primary!.firstName,
        asOfDate: todayStr,
        currencyCode: reminder.currencyCode,
        totalAmountOwing: reminder.totalAmountOwing.toFixed(2),
        charges: content.charges,
      });

      const result = await emailService.send({
        to: recipient.primary!.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.paymentReminderDeliveryAttempt.update({
          where: { id: attempt.id },
          data: { outcome: 'SENT', completedAt: new Date(), providerMessageId: result.providerMessageId ?? null },
        });
        await tx.paymentReminder.update({
          where: { id: reminder.id },
          data: {
            status: 'SENT',
            submittedAt: new Date(),
            providerMessageId: result.providerMessageId ?? null,
            dispatchAttempts: attemptNumber,
            lastAttemptedAt: now,
            lastErrorCategory: null,
            templateVersion: TEMPLATE_VERSION,
          },
        });
        await recordActivity(tx, {
          organisationId: reminder.organisationId,
          propertyId: reminder.propertyId,
          spaceId: reminder.spaceId,
          actorUserId: null,
          eventType: 'REMINDER_SENT',
          entityType: 'PaymentReminder',
          entityId: reminder.id,
          title: `Reminder sent — ${reminder.totalAmountOwing.toFixed(2)} ${reminder.currencyCode}`,
          description: null,
        });
      });
    } catch (err) {
      await this.handleDispatchFailure(reminder.id, attempt.id, attemptNumber, err);
    }
  }

  private async revertToApproved(reminderId: string, note: string): Promise<void> {
    await this.prisma.paymentReminder.updateMany({
      where: { id: reminderId, status: { in: ['QUEUED', 'SENDING'] } },
      data: { status: 'APPROVED' },
    });
    logger.info({ reminderId, note }, 'Reminder dispatch reverted to APPROVED without sending');
  }

  /** The ambiguous-outcome case gets its own, explicit, never-auto-retried
   * path — see this module's doc comment and the QUARANTINED status's
   * own schema doc comment. A TIMEOUT from the provider means "we don't
   * know if this sent" — retrying automatically risks a real duplicate
   * email, so it is left for a human to resolve
   * (ReminderDispatchService.resolveQuarantine). */
  private async handleDispatchFailure(
    reminderId: string,
    attemptId: string,
    attemptNumber: number,
    err: unknown,
  ): Promise<void> {
    const isTimeout = err instanceof EmailProviderError && err.code === 'TIMEOUT';
    const category = isTimeout ? 'TIMEOUT' : err instanceof EmailProviderError ? 'TRANSIENT' : 'PERMANENT';
    const message = err instanceof Error ? err.message : String(err);

    logger.error({ err, reminderId, attemptNumber }, 'Reminder dispatch attempt failed');

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentReminderDeliveryAttempt.update({
        where: { id: attemptId },
        data: {
          outcome: isTimeout ? 'AMBIGUOUS' : 'FAILED',
          completedAt: new Date(),
          errorCategory: category,
          errorMessage: message,
        },
      });

      const reminder = await tx.paymentReminder.findUniqueOrThrow({ where: { id: reminderId } });

      if (isTimeout) {
        await tx.paymentReminder.update({
          where: { id: reminderId },
          data: { status: 'QUARANTINED', dispatchAttempts: attemptNumber, lastAttemptedAt: new Date(), lastErrorCategory: category },
        });
        await recordActivity(tx, {
          organisationId: reminder.organisationId,
          propertyId: reminder.propertyId,
          spaceId: reminder.spaceId,
          actorUserId: null,
          eventType: 'REMINDER_DELIVERY_QUARANTINED',
          entityType: 'PaymentReminder',
          entityId: reminderId,
          title: 'Reminder dispatch outcome unknown — quarantined for manual resolution',
          description: 'The provider call timed out; it may or may not have been accepted. Never auto-retried.',
        });
        return;
      }

      const canRetry = category === 'TRANSIENT' && attemptNumber < env.REMINDER_DISPATCH_MAX_ATTEMPTS;
      await tx.paymentReminder.update({
        where: { id: reminderId },
        data: {
          status: canRetry ? 'APPROVED' : 'FAILED',
          dispatchAttempts: attemptNumber,
          lastAttemptedAt: new Date(),
          lastErrorCategory: category,
        },
      });
      await recordActivity(tx, {
        organisationId: reminder.organisationId,
        propertyId: reminder.propertyId,
        spaceId: reminder.spaceId,
        actorUserId: null,
        eventType: 'REMINDER_DELIVERY_FAILED',
        entityType: 'PaymentReminder',
        entityId: reminderId,
        title: canRetry
          ? `Reminder dispatch failed (attempt ${attemptNumber}/${env.REMINDER_DISPATCH_MAX_ATTEMPTS}) — will retry`
          : `Reminder dispatch failed permanently (attempt ${attemptNumber}) — no further automatic retry`,
        description: message,
      });
    });
  }

  private async getOwnedProperty(organisationId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, organisationId } });
    if (!property) throw new NotFoundError('Property not found');
    return property;
  }

  /** Manual, explicit single-reminder dispatch trigger (financials.approve
   * — the same claim/revalidate/send path processDue uses, just entered
   * from the API instead of the scheduler). */
  async dispatchNow(organisationId: string, propertyId: string, reminderId: string): Promise<void> {
    await this.getOwnedProperty(organisationId, propertyId);
    const reminder = await this.prisma.paymentReminder.findFirst({ where: { id: reminderId, organisationId, propertyId } });
    if (!reminder) throw new NotFoundError('Reminder not found');
    if (reminder.status !== 'APPROVED') {
      throw new ConflictError(`Only an APPROVED reminder can be dispatched (current status: ${reminder.status}).`);
    }
    const claim = await this.prisma.paymentReminder.updateMany({
      where: { id: reminderId, status: 'APPROVED' },
      data: { status: 'QUEUED' },
    });
    if (claim.count === 0) {
      throw new ConflictError('This reminder was already claimed for dispatch (e.g. by a concurrent request or the scheduler).');
    }
    await this.dispatchOne(reminderId);
  }

  /** Manual retry — only from FAILED, an explicit human override of the
   * automatic-retry cap (REMINDER_DISPATCH_MAX_ATTEMPTS). Never applies
   * to QUARANTINED — see resolveQuarantine. */
  async retry(organisationId: string, actorUserId: string, propertyId: string, reminderId: string): Promise<void> {
    await this.getOwnedProperty(organisationId, propertyId);
    const reminder = await this.prisma.paymentReminder.findFirst({ where: { id: reminderId, organisationId, propertyId } });
    if (!reminder) throw new NotFoundError('Reminder not found');
    if (reminder.status !== 'FAILED') {
      throw new ConflictError('Only a FAILED reminder can be retried.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentReminder.update({ where: { id: reminderId }, data: { status: 'APPROVED' } });
      await recordActivity(tx, {
        organisationId,
        propertyId,
        spaceId: reminder.spaceId,
        actorUserId,
        eventType: 'REMINDER_DELIVERY_RETRIED',
        entityType: 'PaymentReminder',
        entityId: reminderId,
        title: `Reminder dispatch manually retried (previously failed after ${reminder.dispatchAttempts} attempt(s))`,
        description: null,
      });
    });
  }

  /** The only way a QUARANTINED reminder ever leaves that state — always
   * an explicit human decision, never automatic. */
  async resolveQuarantine(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    reminderId: string,
    resolution: 'CONFIRMED_SENT' | 'CONFIRMED_NOT_SENT',
    note: string,
  ): Promise<void> {
    await this.getOwnedProperty(organisationId, propertyId);
    const reminder = await this.prisma.paymentReminder.findFirst({ where: { id: reminderId, organisationId, propertyId } });
    if (!reminder) throw new NotFoundError('Reminder not found');
    if (reminder.status !== 'QUARANTINED') {
      throw new ConflictError('Only a QUARANTINED reminder can be resolved this way.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentReminder.update({
        where: { id: reminderId },
        data:
          resolution === 'CONFIRMED_SENT'
            ? { status: 'SENT', submittedAt: reminder.submittedAt ?? new Date() }
            : { status: 'APPROVED' },
      });
      await recordActivity(tx, {
        organisationId,
        propertyId,
        spaceId: reminder.spaceId,
        actorUserId,
        eventType: 'REMINDER_DELIVERY_QUARANTINE_RESOLVED',
        entityType: 'PaymentReminder',
        entityId: reminderId,
        title: `Quarantined reminder resolved: ${resolution === 'CONFIRMED_SENT' ? 'confirmed sent' : 'confirmed not sent, re-queued for approval'}`,
        description: note,
      });
    });
  }

  /** Verified webhook delivery confirmation — SENT -> DELIVERED only, via
   * an atomic compare-and-swap (updateMany on status='SENT') so a
   * redelivered/duplicated webhook event is naturally a no-op the second
   * time, never a second activity record or a double-counted
   * confirmation. */
  async recordDeliveryConfirmation(providerMessageId: string, deliveredAt: Date): Promise<{ applied: boolean }> {
    const reminder = await this.prisma.paymentReminder.findFirst({ where: { providerMessageId, status: 'SENT' } });
    if (!reminder) return { applied: false };

    const claim = await this.prisma.paymentReminder.updateMany({
      where: { id: reminder.id, status: 'SENT' },
      data: { status: 'DELIVERED', deliveredAt },
    });
    if (claim.count === 0) return { applied: false };

    await recordActivity(this.prisma, {
      organisationId: reminder.organisationId,
      propertyId: reminder.propertyId,
      spaceId: reminder.spaceId,
      actorUserId: null,
      eventType: 'REMINDER_DELIVERY_CONFIRMED',
      entityType: 'PaymentReminder',
      entityId: reminder.id,
      title: 'Reminder delivery confirmed by provider webhook',
      description: null,
    });
    return { applied: true };
  }
}
