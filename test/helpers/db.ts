import { getPrismaClient } from '../../src/lib/prisma.js';

export const testPrisma = getPrismaClient();

export async function resetDb() {
  await testPrisma.$transaction([
    testPrisma.activityEvent.deleteMany(),
    testPrisma.maintenanceRequestAttachment.deleteMany(),
    testPrisma.maintenanceRequest.deleteMany(),
    testPrisma.contactInvite.deleteMany(),
    testPrisma.propertyMembership.deleteMany(),
    testPrisma.propertyContact.deleteMany(),
    testPrisma.space.deleteMany(),
    testPrisma.property.deleteMany(),
    testPrisma.session.deleteMany(),
    testPrisma.organisationMembership.deleteMany(),
    testPrisma.user.deleteMany(),
    testPrisma.organisation.deleteMany(),
  ]);
}
