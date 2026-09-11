import type { Prisma, PrismaClient } from '@prisma/client';
import { recordActivity } from '../activity/activity.js';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import type { PaginatedResult } from '../../lib/pagination.js';
import { AudienceResolver, type AudienceCriteria } from './communications.audience.js';
import type {
  AudienceCriteriaInput,
  CommunicationsQuery,
  CreateCommunicationInput,
  SendCommunicationInput,
  UpdateCommunicationInput,
} from './communications.schemas.js';

const communicationInclude = {
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  savedAudience: { select: { id: true, name: true } },
  _count: { select: { recipients: true } },
} satisfies Prisma.CommunicationInclude;

/** Once SENT, a communication is an immutable historical record — content
 * is never edited after that point, only ever duplicated into a new draft. */
const EDITABLE_STATUSES = new Set(['DRAFT', 'SCHEDULED']);

export class CommunicationsService {
  private readonly audience: AudienceResolver;

  constructor(private readonly prisma: PrismaClient) {
    this.audience = new AudienceResolver(prisma);
  }

  private toCriteria(input: AudienceCriteriaInput): AudienceCriteria {
    return input as AudienceCriteria;
  }

  private async getOwned(organisationId: string, id: string) {
    const communication = await this.prisma.communication.findFirst({
      where: { id, organisationId },
      include: communicationInclude,
    });
    if (!communication) {
      throw new NotFoundError('Communication not found');
    }
    return communication;
  }

  async create(organisationId: string, actorUserId: string, input: CreateCommunicationInput) {
    const criteria = this.toCriteria(input.audienceCriteria);
    await this.audience.validate(organisationId, criteria);

    return this.prisma.$transaction(async (tx) => {
      const communication = await tx.communication.create({
        data: {
          organisationId,
          title: input.title,
          body: input.body,
          channels: input.channels,
          audienceCriteria: criteria as unknown as Prisma.InputJsonValue,
          savedAudienceId: input.savedAudienceId ?? null,
          createdByUserId: actorUserId,
          status: 'DRAFT',
        },
        include: communicationInclude,
      });

      await recordActivity(tx, {
        organisationId,
        actorUserId,
        eventType: 'ANNOUNCEMENT_CREATED',
        entityType: 'Communication',
        entityId: communication.id,
        title: `Announcement drafted: ${communication.title}`,
      });

      return communication;
    });
  }

  async update(
    organisationId: string,
    id: string,
    input: UpdateCommunicationInput,
  ): Promise<Prisma.CommunicationGetPayload<{ include: typeof communicationInclude }>> {
    const existing = await this.getOwned(organisationId, id);
    if (!EDITABLE_STATUSES.has(existing.status)) {
      throw new ConflictError('A sent or cancelled announcement cannot be edited');
    }

    let criteria: AudienceCriteria | undefined;
    if (input.audienceCriteria) {
      criteria = this.toCriteria(input.audienceCriteria);
      await this.audience.validate(organisationId, criteria);
    }

    return this.prisma.communication.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.channels !== undefined ? { channels: input.channels } : {}),
        ...(criteria !== undefined ? { audienceCriteria: criteria as unknown as Prisma.InputJsonValue } : {}),
        ...(input.savedAudienceId !== undefined ? { savedAudienceId: input.savedAudienceId } : {}),
      },
      include: communicationInclude,
    });
  }

  async list(
    organisationId: string,
    query: CommunicationsQuery,
  ): Promise<PaginatedResult<Prisma.CommunicationGetPayload<{ include: typeof communicationInclude }>>> {
    const where: Prisma.CommunicationWhereInput = {
      organisationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.communication.findMany({
        where,
        orderBy: [{ scheduledAt: 'desc' }, { updatedAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: communicationInclude,
      }),
      this.prisma.communication.count({ where }),
    ]);

    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async getById(organisationId: string, id: string) {
    return this.getOwned(organisationId, id);
  }

  async previewAudience(organisationId: string, criteriaInput: AudienceCriteriaInput) {
    return this.audience.preview(organisationId, this.toCriteria(criteriaInput));
  }

  /** Always schedules — even a "send now" just sets scheduledAt to now, so
   * every send is picked up asynchronously by the delivery worker on its
   * next tick. Nothing ever fans out to recipients inside this request. */
  async send(organisationId: string, actorUserId: string, id: string, input: SendCommunicationInput) {
    const existing = await this.getOwned(organisationId, id);
    if (existing.status !== 'DRAFT' && existing.status !== 'SCHEDULED') {
      throw new ConflictError('This announcement has already been sent or cancelled');
    }

    const criteria = existing.audienceCriteria as unknown as AudienceCriteria;
    await this.audience.validate(organisationId, criteria);

    const scheduledAt = input.scheduledAt ?? new Date();

    return this.prisma.communication.update({
      where: { id },
      data: { status: 'SCHEDULED', scheduledAt },
      include: communicationInclude,
    });
  }

  async cancel(organisationId: string, actorUserId: string, id: string) {
    const existing = await this.getOwned(organisationId, id);
    if (existing.status !== 'SCHEDULED') {
      throw new ConflictError('Only a scheduled announcement can be cancelled');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.communication.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
        include: communicationInclude,
      });

      await recordActivity(tx, {
        organisationId,
        actorUserId,
        eventType: 'ANNOUNCEMENT_CANCELLED',
        entityType: 'Communication',
        entityId: id,
        title: `Scheduled announcement cancelled: ${updated.title}`,
      });

      return updated;
    });
  }

  async duplicateAsDraft(organisationId: string, actorUserId: string, id: string) {
    const existing = await this.getOwned(organisationId, id);
    return this.prisma.communication.create({
      data: {
        organisationId,
        title: existing.title,
        body: existing.body,
        channels: existing.channels,
        audienceCriteria: existing.audienceCriteria as Prisma.InputJsonValue,
        savedAudienceId: existing.savedAudienceId,
        createdByUserId: actorUserId,
        status: 'DRAFT',
      },
      include: communicationInclude,
    });
  }

  /** Recipient + delivery snapshot for the detail view — real per-channel
   * counts, never an engagement/open-rate metric. */
  async getDeliverySummary(organisationId: string, id: string) {
    await this.getOwned(organisationId, id);
    const deliveries = await this.prisma.communicationDelivery.groupBy({
      by: ['channel', 'status'],
      where: { communicationRecipient: { communicationId: id } },
      _count: true,
    });
    return deliveries.map((d) => ({ channel: d.channel, status: d.status, count: d._count }));
  }
}
