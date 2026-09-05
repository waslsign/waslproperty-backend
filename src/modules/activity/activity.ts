import type { ActivityEventType, Prisma, PrismaClient } from '@prisma/client';

export interface RecordActivityInput {
  organisationId: string;
  propertyId: string;
  spaceId?: string | null;
  actorUserId?: string | null;
  eventType: ActivityEventType;
  entityType?: string | null;
  entityId?: string | null;
  title: string;
  description?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Writes one activity row. Accepts either a plain PrismaClient or an
 * in-flight transaction client so callers can record activity as part of
 * the same transaction as the action that caused it (see PropertiesService,
 * SpacesService, PeopleService) rather than as a separate, possibly
 * inconsistent write.
 */
export async function recordActivity(
  client: PrismaClient | Prisma.TransactionClient,
  input: RecordActivityInput,
) {
  return client.activityEvent.create({ data: input });
}
