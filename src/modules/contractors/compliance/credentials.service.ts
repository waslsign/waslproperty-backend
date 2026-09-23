import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { NotFoundError, ValidationError } from '../../../errors/AppError.js';
import { recordActivity } from '../../activity/activity.js';
import { presignGet, presignPut } from '../../../lib/s3.js';
import { env } from '../../../config/env.js';
import { notifyOrgStaff } from '../../notifications/notifications.js';
import { deriveCredentialStatus } from './credentialStatus.js';
import type {
  CreateCredentialInput,
  PresignCredentialDocumentInput,
  RejectCredentialInput,
  UpdateCredentialInput,
  VerifyCredentialInput,
} from './compliance.schemas.js';

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

function documentStorageKeyPrefix(organisationId: string, contractorId: string): string {
  return `organisations/${organisationId}/contractors/${contractorId}/credentials/`;
}

/**
 * Credential CRUD + document evidence upload, reusing the exact
 * presign-PUT / register / presign-GET pattern already established by
 * MaintenanceAttachmentsService (src/modules/maintenance/attachments.service.ts)
 * — the same S3 client, the same "never trust a client-supplied storage
 * key that wasn't issued for this exact contractor" check, the same
 * never-proxy-file-bytes rule. Verification (verify/reject) lives here too
 * since it operates on the same row, gated by a stricter capability at the
 * route level (contractor_compliance.verify vs .manage).
 */
export class ContractorCredentialsService {
  constructor(private readonly prisma: PrismaClient) {}

  private async assertContractorInOrg(organisationId: string, contractorId: string) {
    const contractor = await this.prisma.contractor.findFirst({
      where: { id: contractorId, organisationId },
      select: { id: true, name: true },
    });
    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }
    return contractor;
  }

  private async getOwnedCredential(
    organisationId: string,
    contractorId: string,
    credentialId: string,
  ) {
    const credential = await this.prisma.contractorCredential.findFirst({
      where: { id: credentialId, organisationId, contractorId },
    });
    if (!credential) {
      throw new NotFoundError('Credential not found');
    }
    return credential;
  }

  async presignDocument(
    organisationId: string,
    contractorId: string,
    input: PresignCredentialDocumentInput,
  ) {
    await this.assertContractorInOrg(organisationId, contractorId);

    const maxBytes = env.CREDENTIAL_DOCUMENT_MAX_SIZE_MB * 1024 * 1024;
    if (input.fileSize > maxBytes) {
      throw new ValidationError(
        `The document must be ${env.CREDENTIAL_DOCUMENT_MAX_SIZE_MB} MB or smaller`,
      );
    }

    const extension = EXTENSION_BY_CONTENT_TYPE[input.contentType];
    const storageKey = `${documentStorageKeyPrefix(organisationId, contractorId)}${randomBytes(16).toString('hex')}.${extension}`;
    const uploadUrl = await presignPut(storageKey, input.contentType);
    return { storageKey, uploadUrl, fileName: input.fileName, contentType: input.contentType };
  }

  async list(organisationId: string, contractorId: string) {
    await this.assertContractorInOrg(organisationId, contractorId);
    const credentials = await this.prisma.contractorCredential.findMany({
      where: { organisationId, contractorId },
      orderBy: [{ category: 'asc' }, { type: 'asc' }],
    });
    const now = new Date();
    return Promise.all(
      credentials.map(async (c) => ({
        ...c,
        effectiveStatus: deriveCredentialStatus(c, now),
        documentUrl: c.documentStorageKey ? await presignGet(c.documentStorageKey) : null,
      })),
    );
  }

  async create(
    organisationId: string,
    actorUserId: string,
    contractorId: string,
    input: CreateCredentialInput,
  ) {
    const contractor = await this.assertContractorInOrg(organisationId, contractorId);
    this.assertDocumentKeyOwnership(organisationId, contractorId, input.documentStorageKey);

    return this.prisma.$transaction(async (tx) => {
      const credential = await tx.contractorCredential.create({
        data: {
          organisationId,
          contractorId,
          category: input.category,
          type: input.type,
          credentialNumber: input.credentialNumber,
          issuer: input.issuer,
          issuedAt: input.issuedAt,
          expiresAt: input.expiresAt,
          coverageAmount: input.coverageAmount,
          coverageCurrencyCode: input.coverageCurrencyCode,
          notes: input.notes,
          documentStorageKey: input.documentStorageKey,
          documentFileName: input.documentFileName,
          documentContentType: input.documentContentType,
          documentFileSize: input.documentFileSize,
          createdByUserId: actorUserId,
        },
      });

      await recordActivity(tx, {
        organisationId,
        actorUserId,
        eventType: 'CONTRACTOR_CREDENTIAL_ADDED',
        entityType: 'Contractor',
        entityId: contractorId,
        title: `${input.type} added for ${contractor.name}`,
        metadata: { credentialId: credential.id, category: input.category },
      });

      return credential;
    });
  }

  async update(
    organisationId: string,
    actorUserId: string,
    contractorId: string,
    credentialId: string,
    input: UpdateCredentialInput,
  ) {
    const contractor = await this.assertContractorInOrg(organisationId, contractorId);
    const existing = await this.getOwnedCredential(organisationId, contractorId, credentialId);
    if (input.documentStorageKey) {
      this.assertDocumentKeyOwnership(organisationId, contractorId, input.documentStorageKey);
    }

    // A materially changed expiry (a renewal) means the old expiry-cycle's
    // notification flags no longer describe the future — reset them so the
    // new expiry date gets its own expiring-soon/expired notification when
    // its time comes, rather than staying silent because "we already
    // notified once" against a date that no longer applies.
    const expiryChanged =
      input.expiresAt !== undefined &&
      (input.expiresAt?.getTime() ?? null) !== (existing.expiresAt?.getTime() ?? null);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contractorCredential.update({
        where: { id: credentialId },
        data: {
          ...input,
          // Replacing the document (or any material detail) resets
          // verification — a previously-verified document being swapped is
          // exactly the case that must go back to review, never silently
          // stay VERIFIED against different evidence.
          ...(input.documentStorageKey && existing.verificationStatus === 'VERIFIED'
            ? {
                verificationStatus: 'PENDING',
                verificationSource: null,
                verifiedAt: null,
                verifiedByUserId: null,
              }
            : {}),
          ...(expiryChanged ? { expiringSoonNotifiedAt: null, expiredNotifiedAt: null } : {}),
        },
      });

      await recordActivity(tx, {
        organisationId,
        actorUserId,
        eventType: 'CONTRACTOR_CREDENTIAL_UPDATED',
        entityType: 'Contractor',
        entityId: contractorId,
        title: `${updated.type} updated for ${contractor.name}`,
        metadata: { credentialId: updated.id },
      });

      return updated;
    });
  }

  async remove(
    organisationId: string,
    actorUserId: string,
    contractorId: string,
    credentialId: string,
  ) {
    const contractor = await this.assertContractorInOrg(organisationId, contractorId);
    const existing = await this.getOwnedCredential(organisationId, contractorId, credentialId);

    await this.prisma.$transaction(async (tx) => {
      await tx.contractorCredential.delete({ where: { id: credentialId } });
      await recordActivity(tx, {
        organisationId,
        actorUserId,
        eventType: 'CONTRACTOR_CREDENTIAL_REMOVED',
        entityType: 'Contractor',
        entityId: contractorId,
        title: `${existing.type} removed from ${contractor.name}`,
        metadata: { credentialId },
      });
    });
  }

  async verify(
    organisationId: string,
    actorUserId: string,
    contractorId: string,
    credentialId: string,
    input: VerifyCredentialInput,
  ) {
    const contractor = await this.assertContractorInOrg(organisationId, contractorId);
    const existing = await this.getOwnedCredential(organisationId, contractorId, credentialId);
    if (existing.verificationStatus === 'VERIFIED') {
      return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contractorCredential.update({
        where: { id: credentialId },
        data: {
          verificationStatus: 'VERIFIED',
          verificationSource: 'MANUAL',
          verifiedAt: new Date(),
          verifiedByUserId: actorUserId,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      });

      await recordActivity(tx, {
        organisationId,
        actorUserId,
        eventType: 'CONTRACTOR_CREDENTIAL_VERIFIED',
        entityType: 'Contractor',
        entityId: contractorId,
        title: `${updated.type} verified for ${contractor.name}`,
        metadata: { credentialId: updated.id },
      });

      return updated;
    });
  }

  async reject(
    organisationId: string,
    actorUserId: string,
    contractorId: string,
    credentialId: string,
    input: RejectCredentialInput,
  ) {
    const contractor = await this.assertContractorInOrg(organisationId, contractorId);
    await this.getOwnedCredential(organisationId, contractorId, credentialId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contractorCredential.update({
        where: { id: credentialId },
        data: {
          verificationStatus: 'REJECTED',
          verificationSource: 'MANUAL',
          verifiedAt: new Date(),
          verifiedByUserId: actorUserId,
          notes: input.notes,
        },
      });

      await recordActivity(tx, {
        organisationId,
        actorUserId,
        eventType: 'CONTRACTOR_CREDENTIAL_REJECTED',
        entityType: 'Contractor',
        entityId: contractorId,
        title: `${updated.type} rejected for ${contractor.name}`,
        metadata: { credentialId: updated.id },
      });

      // A discrete, actionable event, not a time-based poll — notify
      // immediately rather than waiting for the expiry scheduler's next
      // tick (rejection isn't an expiry fact at all).
      await notifyOrgStaff(
        tx,
        organisationId,
        {
          title: `${contractor.name}'s ${updated.type} was rejected`,
          body: input.notes,
          entityType: 'Contractor',
          entityId: contractorId,
        },
        { excludeUserId: actorUserId },
      );

      return updated;
    });
  }

  /** A client trying to register/attach a storage key it wasn't issued a
   * presigned PUT for — either another contractor's key or a forged path.
   * Same defensive check as MaintenanceAttachmentsService.register. */
  private assertDocumentKeyOwnership(
    organisationId: string,
    contractorId: string,
    storageKey?: string,
  ) {
    if (!storageKey) return;
    const prefix = documentStorageKeyPrefix(organisationId, contractorId);
    if (!storageKey.startsWith(prefix)) {
      throw new ValidationError('Invalid document reference');
    }
  }
}
