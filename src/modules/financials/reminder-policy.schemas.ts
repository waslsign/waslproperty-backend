import { z } from 'zod';

/**
 * M16.8 — Arrears Reminder Delivery & Scheduling. ReminderPolicy
 * configuration — see prisma/schema.prisma's "Arrears Reminder Delivery &
 * Scheduling" section doc comment, point 1, for why `enabled` and
 * `deliveryEnabled` are two separate switches.
 */

export const updateReminderPolicySchema = z
  .object({
    enabled: z.boolean().optional(),
    deliveryEnabled: z.boolean().optional(),
    initialDelayDays: z.coerce.number().int().min(0).max(365).optional(),
    followUpIntervalDays: z.coerce.number().int().min(1).max(365).optional(),
    minimumOutstandingAmount: z.coerce.number().min(0).optional(),
    maxRemindersPerCase: z.coerce.number().int().min(1).max(100).nullable().optional(),
    maxRemindersInRollingWindow: z.coerce.number().int().min(1).max(100).nullable().optional(),
    rollingWindowDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
  })
  .refine(
    (v) =>
      (v.maxRemindersInRollingWindow === undefined || v.maxRemindersInRollingWindow === null) ===
      (v.rollingWindowDays === undefined || v.rollingWindowDays === null),
    { message: 'maxRemindersInRollingWindow and rollingWindowDays must be set or cleared together.' },
  );
export type UpdateReminderPolicyInput = z.infer<typeof updateReminderPolicySchema>;

export const evaluateRemindersSchema = z.object({
  /** Overrides the real clock for this one evaluation run — manual/test
   * use only; the scheduled worker never supplies this. */
  asOfDate: z.string().trim().min(1).optional(),
});
export type EvaluateRemindersInput = z.infer<typeof evaluateRemindersSchema>;
