import { getPrismaClient } from '../../src/lib/prisma.js';

export const testPrisma = getPrismaClient();

export async function resetDb() {
  await testPrisma.$transaction([
    testPrisma.session.deleteMany(),
    testPrisma.organisationMembership.deleteMany(),
    testPrisma.user.deleteMany(),
    testPrisma.organisation.deleteMany(),
  ]);
}
