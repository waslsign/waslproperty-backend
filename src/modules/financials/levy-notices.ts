import type { Prisma, PrismaClient } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { withPublicReference } from '../../lib/public-reference.js';
import type { AudienceCriteria } from '../communications/communications.audience.js';
import { recordActivity } from '../activity/activity.js';

/**
 * M16.3 — levy notices, integrated with the existing Communications
 * module (reusing its Communication/CommunicationRecipient model and
 * delivery pipeline — never a second notification system).
 *
 * This deliberately does NOT go through CommunicationsService.create()/
 * send(): those methods authorize against the ACTING USER's own
 * `communications.manage`/`communications.send` capability
 * (assertAudienceWithinScope), which would wrongly require a manager who
 * holds `financials.approve` to ALSO separately hold communications
 * capabilities just to issue a levy. The authorization for a levy notice
 * is "this user was allowed to issue this levy" — already checked by the
 * caller — not a separate communications permission. This writes the same
 * Communication row the existing `CommunicationDeliveryService` already
 * knows how to process (status SCHEDULED, scheduledAt = now), so delivery,
 * audit, and per-recipient tracking are all the existing infrastructure —
 * only the creation path's authorization differs.
 *
 * ONE Communication PER CHARGED LOT (revised during the M16.3 refinement
 * pass — the original design sent a single shared Communication to every
 * charged lot with a deliberately generic body, since Communication.body
 * is one field shared by every recipient and has no per-recipient
 * merge-field templating). Personalising the notice (lot, fund, amount,
 * due date — the brief's explicit requirement) without adding a
 * merge-field system to the Communications module means each lot gets its
 * own Communication row, SPACE-scoped to just that one spaceId. This is
 * `O(lots)` Communication rows per instalment issuance rather than one —
 * an accepted, documented cost (ADR-024) for genuinely personalised
 * content on the existing model, not a second notification system.
 */
export async function sendLevyIssuanceNotice(
  client: PrismaClient | Prisma.TransactionClient,
  input: {
    organisationId: string;
    propertyId: string;
    scheduleName: string;
    fundName: string;
    currencyCode: string;
    issuedByUserId: string;
    instalmentNumber: number;
    dueDate: string;
    perLot: { spaceId: string; spaceName: string; lotNumber: string | null; amount: string }[];
  },
): Promise<{ communicationIds: string[] }> {
  const communicationIds: string[] = [];

  for (const lot of input.perLot) {
    try {
      const criteria: AudienceCriteria = { scope: 'SPACE', spaceIds: [lot.spaceId] };
      const lotLabel = lot.lotNumber ? `Lot ${lot.lotNumber}` : lot.spaceName;
      const communication = await withPublicReference('COM', (publicReference) =>
        client.communication.create({
          data: {
            organisationId: input.organisationId,
            publicReference,
            title: `Levy notice — ${input.scheduleName}, instalment #${input.instalmentNumber}`,
            body:
              `${lotLabel}: your ${input.fundName} levy instalment #${input.instalmentNumber} ` +
              `(${input.scheduleName}) is ${input.currencyCode} ${lot.amount}, due ${input.dueDate}. ` +
              `Log in to WaslProp to view your full lot ledger.`,
            channels: ['IN_APP', 'EMAIL'],
            audienceCriteria: criteria as unknown as Prisma.InputJsonValue,
            createdByUserId: input.issuedByUserId,
            status: 'SCHEDULED',
            scheduledAt: new Date(),
          },
        }),
      );
      communicationIds.push(communication.id);

      await recordActivity(client, {
        organisationId: input.organisationId,
        propertyId: input.propertyId,
        actorUserId: input.issuedByUserId,
        eventType: 'LEVY_NOTICE_SENT',
        entityType: 'Communication',
        entityId: communication.id,
        title: `Levy notice scheduled for ${lotLabel}: ${input.scheduleName} #${input.instalmentNumber}`,
      });
    } catch (err) {
      // Notice failure must never affect the already-posted levy — see
      // the "notification failure without duplicate financial postings"
      // safeguard. This function is always called AFTER the issuance
      // transaction has committed, so there is nothing to roll back here;
      // the worst case is one lot's notice not being scheduled (every
      // OTHER lot's notice still goes out), logged for operator
      // follow-up.
      logger.error(
        { err, propertyId: input.propertyId, spaceId: lot.spaceId },
        'Failed to schedule levy issuance notice for one lot',
      );
    }
  }

  return { communicationIds };
}
