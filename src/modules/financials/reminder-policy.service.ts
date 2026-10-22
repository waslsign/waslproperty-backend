import type { PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import { isEmailSendSuppressed } from '../../lib/email.js';
import { withPublicReference } from '../../lib/public-reference.js';
import { recordActivity } from '../activity/activity.js';
import type { UpdateReminderPolicyInput } from './reminder-policy.schemas.js';

/**
 * M16.8 — ReminderPolicy CRUD. One row per property, created lazily on
 * first `get`/`update` — never a seeded default row, so "no policy row
 * exists yet" and "a policy row exists but is disabled" are both real,
 * distinguishable states the frontend can show honestly. Default OFF —
 * see prisma/schema.prisma's section doc comment, point 1.
 */

export interface ReminderPolicyView {
  id: string;
  publicReference: string;
  propertyId: string;
  enabled: boolean;
  deliveryEnabled: boolean;
  initialDelayDays: number;
  followUpIntervalDays: number;
  minimumOutstandingAmount: string;
  maxRemindersPerCase: number | null;
  maxRemindersInRollingWindow: number | null;
  rollingWindowDays: number | null;
  timezone: string;
  version: number;
  lastEvaluatedAt: string | null;
  lastEvaluationNote: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  /** The process-wide EMAIL_SEND_DISABLED kill switch's current effect —
   * a plain boolean the frontend can show as a hard restriction banner,
   * never the env var's own value or any other secret. True whenever a
   * real send would currently be blocked, regardless of this property's
   * own `deliveryEnabled`. */
  emailSendGloballyDisabled: boolean;
}

function toView(p: {
  id: string;
  publicReference: string;
  propertyId: string;
  enabled: boolean;
  deliveryEnabled: boolean;
  initialDelayDays: number;
  followUpIntervalDays: number;
  minimumOutstandingAmount: { toFixed: (n: number) => string };
  maxRemindersPerCase: number | null;
  maxRemindersInRollingWindow: number | null;
  rollingWindowDays: number | null;
  timezone: string;
  version: number;
  lastEvaluatedAt: Date | null;
  lastEvaluationNote: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ReminderPolicyView {
  return {
    id: p.id,
    publicReference: p.publicReference,
    propertyId: p.propertyId,
    enabled: p.enabled,
    deliveryEnabled: p.deliveryEnabled,
    initialDelayDays: p.initialDelayDays,
    followUpIntervalDays: p.followUpIntervalDays,
    minimumOutstandingAmount: p.minimumOutstandingAmount.toFixed(2),
    maxRemindersPerCase: p.maxRemindersPerCase,
    maxRemindersInRollingWindow: p.maxRemindersInRollingWindow,
    rollingWindowDays: p.rollingWindowDays,
    timezone: p.timezone,
    version: p.version,
    lastEvaluatedAt: p.lastEvaluatedAt ? p.lastEvaluatedAt.toISOString() : null,
    lastEvaluationNote: p.lastEvaluationNote,
    updatedByUserId: p.updatedByUserId,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    emailSendGloballyDisabled: isEmailSendSuppressed(),
  };
}

/** Exported so a caller that needs policy-shaped defaults WITHOUT a
 * persisted `ReminderPolicy` row (e.g. `ReminderApprovalService.
 * submitForReview` checking a manual draft against the same minimum-
 * threshold/cap rules eligibility would apply) never invents its own
 * separate "no policy configured" semantics. */
export const DEFAULT_POLICY = {
  enabled: false,
  deliveryEnabled: false,
  initialDelayDays: 14,
  followUpIntervalDays: 14,
  minimumOutstandingAmount: 0,
  timezone: 'Australia/Sydney',
};

export class ReminderPolicyService {
  constructor(private readonly prisma: PrismaClient) {}

  private async getOwnedProperty(organisationId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, organisationId } });
    if (!property) throw new NotFoundError('Property not found');
    return property;
  }

  /** Returns the property's policy, creating the default (disabled) row
   * if none exists yet — a GET must never 404 just because nobody has
   * configured this property's reminder policy, since "not configured" is
   * itself meaningful, displayable state (default OFF). */
  async get(organisationId: string, propertyId: string): Promise<ReminderPolicyView> {
    await this.getOwnedProperty(organisationId, propertyId);
    const existing = await this.prisma.reminderPolicy.findUnique({ where: { propertyId } });
    if (existing) return toView(existing);

    const created = await withPublicReference('RPOL', (publicReference) =>
      this.prisma.reminderPolicy.create({
        data: { publicReference, organisationId, propertyId, ...DEFAULT_POLICY },
      }),
    );
    return toView(created);
  }

  async update(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    input: UpdateReminderPolicyInput,
  ): Promise<ReminderPolicyView> {
    await this.getOwnedProperty(organisationId, propertyId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.reminderPolicy.findUnique({ where: { propertyId } });
      const current =
        existing ??
        (await withPublicReference('RPOL', (publicReference) =>
          tx.reminderPolicy.create({ data: { publicReference, organisationId, propertyId, ...DEFAULT_POLICY } }),
        ));

      if (
        input.maxRemindersPerCase !== undefined &&
        input.maxRemindersPerCase !== null &&
        input.maxRemindersPerCase < 1
      ) {
        throw new ConflictError('maxRemindersPerCase must be at least 1.');
      }

      const row = await tx.reminderPolicy.update({
        where: { propertyId },
        data: {
          enabled: input.enabled ?? undefined,
          deliveryEnabled: input.deliveryEnabled ?? undefined,
          initialDelayDays: input.initialDelayDays ?? undefined,
          followUpIntervalDays: input.followUpIntervalDays ?? undefined,
          minimumOutstandingAmount: input.minimumOutstandingAmount ?? undefined,
          maxRemindersPerCase: input.maxRemindersPerCase === undefined ? undefined : input.maxRemindersPerCase,
          maxRemindersInRollingWindow:
            input.maxRemindersInRollingWindow === undefined ? undefined : input.maxRemindersInRollingWindow,
          rollingWindowDays: input.rollingWindowDays === undefined ? undefined : input.rollingWindowDays,
          timezone: input.timezone ?? undefined,
          version: current.version + 1,
          updatedByUserId: actorUserId,
        },
      });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'REMINDER_POLICY_UPDATED',
        entityType: 'ReminderPolicy',
        entityId: row.id,
        title: `Reminder policy updated (v${row.version}) — evaluation ${row.enabled ? 'ON' : 'OFF'}, delivery ${row.deliveryEnabled ? 'ON' : 'OFF'}`,
        description: null,
      });

      return row;
    });

    return toView(updated);
  }
}
