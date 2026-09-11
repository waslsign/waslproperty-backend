import type { Prisma, PlatformRole, PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

export interface RecordPlatformActivityInput {
  actorUserId: string;
  platformRole: PlatformRole;
  action: string;
  entityType: string;
  entityId?: string | null;
  organisationId?: string | null;
  reason?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  correlationId?: string | null;
}

/** Mirrors recordActivity's transaction-client-compatible shape — every
 * Backoffice mutation records one of these, in the same transaction as the
 * mutation itself. No update/delete endpoint is ever built for this model:
 * immutability comes from that absence, not from a flag. */
export async function recordPlatformActivity(
  client: PrismaClient | Prisma.TransactionClient,
  input: RecordPlatformActivityInput,
) {
  return client.platformAuditEvent.create({
    data: {
      ...input,
      environment: env.NODE_ENV,
    },
  });
}
