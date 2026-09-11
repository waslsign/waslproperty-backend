import type { OrgRole, Prisma, PrismaClient } from '@prisma/client';

export interface NotifyUserInput {
  organisationId: string;
  userId: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  sourceCommunicationId?: string | null;
  sourceActivityEventId?: string | null;
}

/**
 * Writes one notification row. Accepts either a plain PrismaClient or an
 * in-flight transaction client, same convention as recordActivity, so a
 * notification is written in the same transaction as the event that caused
 * it rather than as a separate, possibly inconsistent write.
 */
export async function notifyUser(
  client: PrismaClient | Prisma.TransactionClient,
  input: NotifyUserInput,
) {
  return client.notification.create({ data: input });
}

export async function notifyUsers(
  client: PrismaClient | Prisma.TransactionClient,
  inputs: NotifyUserInput[],
) {
  if (inputs.length === 0) return { count: 0 };
  return client.notification.createMany({ data: inputs });
}

const STAFF_NOTIFY_ROLES: OrgRole[] = ['OWNER', 'ADMIN'];

/**
 * Notifies every active OWNER/ADMIN staff member of the organisation —
 * MEMBER is deliberately excluded, matching requireOrgRole(['OWNER','ADMIN'])
 * being the bar for every other staff-write action today. Used for events
 * with no single obvious individual recipient (a new request came in, a
 * quote needs review) rather than a per-property audience.
 */
export async function notifyOrgStaff(
  client: PrismaClient | Prisma.TransactionClient,
  organisationId: string,
  input: Omit<NotifyUserInput, 'organisationId' | 'userId'>,
  options: { excludeUserId?: string } = {},
) {
  const staff = await client.organisationMembership.findMany({
    where: {
      organisationId,
      status: 'ACTIVE',
      role: { in: STAFF_NOTIFY_ROLES },
      ...(options.excludeUserId ? { userId: { not: options.excludeUserId } } : {}),
    },
    select: { userId: true },
  });

  return notifyUsers(
    client,
    staff.map((member) => ({ organisationId, userId: member.userId, ...input })),
  );
}
