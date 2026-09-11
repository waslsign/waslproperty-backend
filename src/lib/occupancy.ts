import type { PrismaClient } from '@prisma/client';

export type Occupancy = 'VACANT' | 'OCCUPIED';

/**
 * A space is OCCUPIED when it has at least one ACTIVE TENANT or RESIDENT
 * membership. This is deliberately kept separate from Space.status, which
 * covers operational states (under maintenance, reserved) rather than
 * vacancy — vacancy is derived, not manually set.
 */
export async function getOccupiedSpaceIds(
  prisma: PrismaClient,
  spaceIds: string[],
): Promise<Set<string>> {
  if (spaceIds.length === 0) {
    return new Set();
  }

  const active = await prisma.propertyMembership.findMany({
    where: {
      spaceId: { in: spaceIds },
      role: { in: ['TENANT', 'RESIDENT'] },
      status: 'ACTIVE',
    },
    select: { spaceId: true },
    distinct: ['spaceId'],
  });

  return new Set(active.map((m) => m.spaceId).filter((id): id is string => id !== null));
}

export async function getOccupancyForSpace(
  prisma: PrismaClient,
  spaceId: string,
): Promise<Occupancy> {
  const occupied = await getOccupiedSpaceIds(prisma, [spaceId]);
  return occupied.has(spaceId) ? 'OCCUPIED' : 'VACANT';
}
