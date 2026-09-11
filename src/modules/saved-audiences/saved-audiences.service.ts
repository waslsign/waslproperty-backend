import type { Prisma, PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import { AudienceResolver, type AudienceCriteria } from '../communications/communications.audience.js';
import type { CreateSavedAudienceInput, UpdateSavedAudienceInput } from './saved-audiences.schemas.js';

export class SavedAudiencesService {
  private readonly audience: AudienceResolver;

  constructor(private readonly prisma: PrismaClient) {
    this.audience = new AudienceResolver(prisma);
  }

  private async getOwned(organisationId: string, id: string) {
    const audience = await this.prisma.savedAudience.findFirst({ where: { id, organisationId } });
    if (!audience) {
      throw new NotFoundError('Saved audience not found');
    }
    return audience;
  }

  async list(organisationId: string) {
    const audiences = await this.prisma.savedAudience.findMany({
      where: { organisationId },
      orderBy: { name: 'asc' },
    });

    // Live-resolved count per audience — always reflects current
    // memberships, never a frozen number stored on the row itself.
    return Promise.all(
      audiences.map(async (a) => {
        const preview = await this.audience.preview(
          organisationId,
          a.criteria as unknown as AudienceCriteria,
        );
        return { ...a, resolvedCount: preview.count, summary: preview.summary };
      }),
    );
  }

  async create(organisationId: string, actorUserId: string, input: CreateSavedAudienceInput) {
    await this.audience.validate(organisationId, input.criteria as AudienceCriteria);

    const existing = await this.prisma.savedAudience.findUnique({
      where: { organisationId_name: { organisationId, name: input.name } },
    });
    if (existing) {
      throw new ConflictError('A saved audience with this name already exists');
    }

    return this.prisma.savedAudience.create({
      data: {
        organisationId,
        name: input.name,
        criteria: input.criteria as unknown as Prisma.InputJsonValue,
        createdByUserId: actorUserId,
      },
    });
  }

  async update(organisationId: string, id: string, input: UpdateSavedAudienceInput) {
    await this.getOwned(organisationId, id);
    if (input.criteria) {
      await this.audience.validate(organisationId, input.criteria as AudienceCriteria);
    }

    return this.prisma.savedAudience.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.criteria !== undefined
          ? { criteria: input.criteria as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  async delete(organisationId: string, id: string) {
    await this.getOwned(organisationId, id);
    // A saved audience referenced by past communications stays referenced
    // (Communication.savedAudienceId → SET NULL on delete would be wrong —
    // we keep the row's own audienceCriteria snapshot regardless, so
    // deleting the saved rule is always safe).
    await this.prisma.savedAudience.delete({ where: { id } });
  }
}
