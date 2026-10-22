import type { Prisma, PrismaClient } from '@prisma/client';
import { parseDateOnly } from '../../lib/dateOnly.js';

/**
 * M16.8 — recipient resolution. The ONE place a reminder's "who do we
 * email" question is answered, called identically at candidate-creation,
 * approval and dispatch time (never resolved once and trusted forever —
 * see ReminderApprovalService/ReminderDispatchService's own revalidation
 * doc comments). Resolves against `PropertyMembership`
 * (role=OWNER, effective-dated via startDate/endDate) joined to
 * `PropertyContact` — the SAME ownership model ADR-029 requires be
 * inspected, never a lot label, a username, or an unrelated organisation
 * user.
 *
 * Deliberately conservative: a lot with zero active owners, or an owner
 * whose contact is not ACTIVE, or a missing/malformed email, resolves to
 * `NONE`/`INVALID` rather than guessing. Two or more simultaneous active
 * owners is NOT ambiguous — joint ownership is a real, legitimate
 * relationship the existing model can determine unambiguously — so every
 * active co-owner's contact is returned and the caller addresses all of
 * them.
 */

export type RecipientResolutionStatus = 'RESOLVED' | 'NO_OWNER' | 'INVALID_CONTACT';

export interface ResolvedRecipient {
  contactId: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface RecipientResolution {
  status: RecipientResolutionStatus;
  /** The primary (first) resolved recipient, if any — what
   * PaymentReminder.recipientContactId/recipientEmail snapshot. */
  primary: ResolvedRecipient | null;
  /** Every resolved recipient (co-owners included). */
  all: ResolvedRecipient[];
  /** Human-readable reason when status is not RESOLVED — never a source
   * of truth, display/audit only. */
  note: string | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function resolveRecipient(
  prisma: PrismaClient | Prisma.TransactionClient,
  organisationId: string,
  propertyId: string,
  spaceId: string,
  asOfDate: string,
): Promise<RecipientResolution> {
  const asOf = parseDateOnly(asOfDate);
  // startDate/endDate are full DateTime columns (a membership can start
  // mid-day), while `asOf` is always a calendar date at UTC midnight — a
  // membership created at, say, 21:00 UTC today must still count as
  // "active as of today", so the upper comparison is exclusive against
  // the START of the day AFTER asOfDate rather than `lte: asOf` (which
  // would wrongly exclude anything created later than midnight on the
  // very day it started).
  const endOfAsOfDay = new Date(asOf.getTime() + 24 * 60 * 60 * 1000);

  const memberships = await prisma.propertyMembership.findMany({
    where: {
      organisationId,
      propertyId,
      spaceId,
      role: 'OWNER',
      status: 'ACTIVE',
      startDate: { lt: endOfAsOfDay },
      OR: [{ endDate: null }, { endDate: { gte: asOf } }],
    },
    include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, status: true } } },
  });

  if (memberships.length === 0) {
    return { status: 'NO_OWNER', primary: null, all: [], note: 'No active owner membership found for this lot as of the requested date.' };
  }

  const resolved: ResolvedRecipient[] = [];
  const problems: string[] = [];
  for (const m of memberships) {
    if (m.contact.status !== 'ACTIVE') {
      problems.push(`Owner contact ${m.contact.firstName} ${m.contact.lastName} is ${m.contact.status}, not ACTIVE.`);
      continue;
    }
    if (!EMAIL_PATTERN.test(m.contact.email)) {
      problems.push(`Owner contact ${m.contact.firstName} ${m.contact.lastName} has no valid email on file.`);
      continue;
    }
    resolved.push({
      contactId: m.contact.id,
      email: m.contact.email,
      firstName: m.contact.firstName,
      lastName: m.contact.lastName,
    });
  }

  if (resolved.length === 0) {
    return {
      status: 'INVALID_CONTACT',
      primary: null,
      all: [],
      note: problems.join(' ') || 'No active owner contact with a valid email address could be resolved.',
    };
  }

  return {
    status: 'RESOLVED',
    primary: resolved[0]!,
    all: resolved,
    note: problems.length > 0 ? `${problems.join(' ')} (sending to the remaining valid owner(s) only.)` : null,
  };
}
