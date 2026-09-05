import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';
import { ValidationError } from '../../errors/AppError.js';
import { recordActivity } from '../activity/activity.js';
import { presignGet, presignPut } from '../../lib/s3.js';
import type { AuthContext } from '../../middlewares/auth.middleware.js';
import type { MaintenanceService } from './maintenance.service.js';
import type { PresignAttachmentsInput, RegisterAttachmentsInput } from './attachments.schemas.js';

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function storageKeyPrefix(organisationId: string, requestId: string): string {
  return `organisations/${organisationId}/maintenance-requests/${requestId}/`;
}

export class MaintenanceAttachmentsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly maintenanceService: MaintenanceService,
  ) {}

  private assertWithinLimits(fileCount: number, sizes: number[]) {
    if (fileCount > env.MAINTENANCE_ATTACHMENT_MAX_FILES) {
      throw new ValidationError(
        `You can attach up to ${env.MAINTENANCE_ATTACHMENT_MAX_FILES} photos per request`,
      );
    }
    const maxBytes = env.MAINTENANCE_ATTACHMENT_MAX_SIZE_MB * 1024 * 1024;
    if (sizes.some((size) => size > maxBytes)) {
      throw new ValidationError(
        `Each photo must be ${env.MAINTENANCE_ATTACHMENT_MAX_SIZE_MB} MB or smaller`,
      );
    }
  }

  /** Also enforces that the caller (resident or staff) is authorised to see
   * this request at all — same rule as MaintenanceService.getById. */
  private async assertRequestAccess(organisationId: string, auth: AuthContext, requestId: string) {
    return this.maintenanceService.getById(organisationId, auth, requestId);
  }

  async presign(
    organisationId: string,
    auth: AuthContext,
    requestId: string,
    input: PresignAttachmentsInput,
  ) {
    await this.assertRequestAccess(organisationId, auth, requestId);

    const existingCount = await this.prisma.maintenanceRequestAttachment.count({
      where: { maintenanceRequestId: requestId },
    });
    this.assertWithinLimits(
      existingCount + input.files.length,
      input.files.map((f) => f.fileSize),
    );

    const prefix = storageKeyPrefix(organisationId, requestId);
    const uploads = await Promise.all(
      input.files.map(async (file) => {
        const extension = EXTENSION_BY_CONTENT_TYPE[file.contentType];
        const storageKey = `${prefix}${randomBytes(16).toString('hex')}.${extension}`;
        const uploadUrl = await presignPut(storageKey, file.contentType);
        return { storageKey, uploadUrl, fileName: file.fileName, contentType: file.contentType };
      }),
    );

    return { uploads };
  }

  async register(
    organisationId: string,
    auth: AuthContext,
    requestId: string,
    input: RegisterAttachmentsInput,
  ) {
    const request = await this.assertRequestAccess(organisationId, auth, requestId);

    const existingCount = await this.prisma.maintenanceRequestAttachment.count({
      where: { maintenanceRequestId: requestId },
    });
    this.assertWithinLimits(
      existingCount + input.attachments.length,
      input.attachments.map((a) => a.fileSize),
    );

    const prefix = storageKeyPrefix(organisationId, requestId);
    for (const attachment of input.attachments) {
      if (!attachment.storageKey.startsWith(prefix)) {
        // A client trying to register a key it wasn't issued a presigned
        // PUT for — either another request's key or a forged path. Reject
        // outright rather than trusting client-supplied storage locations.
        throw new ValidationError('Invalid attachment reference');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await Promise.all(
        input.attachments.map((attachment) =>
          tx.maintenanceRequestAttachment.create({
            data: {
              organisationId,
              maintenanceRequestId: requestId,
              uploadedByUserId: auth.userId,
              storageKey: attachment.storageKey,
              fileName: attachment.fileName,
              contentType: attachment.contentType,
              fileSize: attachment.fileSize,
              width: attachment.width,
              height: attachment.height,
            },
          }),
        ),
      );

      await recordActivity(tx, {
        organisationId,
        propertyId: request.propertyId,
        spaceId: request.spaceId,
        actorUserId: auth.userId,
        eventType: 'MAINTENANCE_REQUEST_ATTACHMENTS_ADDED',
        entityType: 'MaintenanceRequest',
        entityId: request.id,
        title: `${created.length} photo${created.length === 1 ? '' : 's'} added to ${request.title}`,
        metadata: { count: created.length },
      });

      return created;
    });
  }

  async list(organisationId: string, auth: AuthContext, requestId: string) {
    await this.assertRequestAccess(organisationId, auth, requestId);

    const attachments = await this.prisma.maintenanceRequestAttachment.findMany({
      where: { organisationId, maintenanceRequestId: requestId },
      orderBy: { createdAt: 'asc' },
    });

    return Promise.all(
      attachments.map(async (attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        fileSize: attachment.fileSize,
        width: attachment.width,
        height: attachment.height,
        createdAt: attachment.createdAt,
        url: await presignGet(attachment.storageKey),
      })),
    );
  }
}
