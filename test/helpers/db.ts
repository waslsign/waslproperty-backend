import { getPrismaClient } from '../../src/lib/prisma.js';

export const testPrisma = getPrismaClient();

export async function resetDb() {
  await testPrisma.$transaction([
    testPrisma.activityEvent.deleteMany(),
    testPrisma.waslSignWebhookEvent.deleteMany(),
    testPrisma.notification.deleteMany(),
    testPrisma.communicationDelivery.deleteMany(),
    testPrisma.communicationRecipient.deleteMany(),
    testPrisma.communication.deleteMany(),
    testPrisma.savedAudience.deleteMany(),
    testPrisma.contractorQuote.deleteMany(),
    testPrisma.workOrder.deleteMany(),
    testPrisma.contractor.deleteMany(),
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
