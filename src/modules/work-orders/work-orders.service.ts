import type { Prisma, PrismaClient, WorkOrderStatus } from '@prisma/client';
import { recordActivity } from '../activity/activity.js';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import type { PaginatedResult } from '../../lib/pagination.js';
import { ContractorsService } from '../contractors/contractors.service.js';
import { canReleaseWorkOrder, deriveWorkflowResult } from '../quotes/workflow-result.js';
import type {
  AssignContractorInput,
  CreateWorkOrderInput,
  UpdateCostInput,
  UpdateWorkOrderStatusInput,
  WorkOrderQuery,
} from './work-orders.schemas.js';

const workOrderInclude = {
  property: { select: { id: true, name: true, code: true } },
  space: { select: { id: true, name: true, code: true } },
  maintenanceRequest: { select: { id: true, title: true, category: true } },
  contractor: { select: { id: true, name: true, companyName: true, status: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  quotes: {
    orderBy: { createdAt: 'desc' },
    include: { contractor: { select: { id: true, name: true, companyName: true, email: true } } },
  },
} satisfies Prisma.WorkOrderInclude;

/** Same shape as MaintenanceService's transition table — see that file's comment. */
const VALID_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  DRAFT: ['READY', 'CANCELLED'],
  READY: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * The only work-order information a resident is ever allowed to see —
 * plain operational progress, never a status name, cost, or contractor.
 * CANCELLED deliberately maps to null: a resident sees the underlying
 * maintenance request's own status in that case, not an internal decision.
 */
export const residentWorkOrderStatusLabel: Record<WorkOrderStatus, string | null> = {
  DRAFT: 'Being reviewed',
  READY: 'Work being arranged',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: null,
};

function formatStatusLabel(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export class WorkOrdersService {
  private readonly contractorsService: ContractorsService;

  constructor(private readonly prisma: PrismaClient) {
    this.contractorsService = new ContractorsService(prisma);
  }

  private async getOwned(organisationId: string, workOrderId: string) {
    const workOrder = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, organisationId },
      include: workOrderInclude,
    });
    if (!workOrder) {
      throw new NotFoundError('Work order not found');
    }
    return workOrder;
  }

  /**
   * The quote that currently governs whether this work order may leave
   * DRAFT — the most recent quote that hasn't been rejected/expired. A work
   * order with no such quote (or one still on NONE) has nothing to wait for.
   */
  private governingQuote(
    workOrder: Prisma.WorkOrderGetPayload<{ include: typeof workOrderInclude }>,
  ) {
    return workOrder.quotes.find((q) => q.status !== 'REJECTED' && q.status !== 'EXPIRED') ?? null;
  }

  async create(organisationId: string, actorUserId: string, input: CreateWorkOrderInput) {
    const request = await this.prisma.maintenanceRequest.findFirst({
      where: { id: input.maintenanceRequestId, organisationId },
    });
    if (!request) {
      throw new NotFoundError('Maintenance request not found');
    }

    const existing = await this.prisma.workOrder.findFirst({
      where: { maintenanceRequestId: input.maintenanceRequestId, status: { not: 'CANCELLED' } },
    });
    if (existing) {
      throw new ConflictError('This maintenance request already has a work order');
    }

    return this.prisma.$transaction(async (tx) => {
      const workOrder = await tx.workOrder.create({
        data: {
          organisationId,
          propertyId: request.propertyId,
          spaceId: request.spaceId,
          maintenanceRequestId: request.id,
          title: input.title,
          description: input.description,
          priority: input.priority,
          status: 'DRAFT',
          createdByUserId: actorUserId,
        },
        include: workOrderInclude,
      });

      await recordActivity(tx, {
        organisationId,
        propertyId: request.propertyId,
        spaceId: request.spaceId,
        actorUserId,
        eventType: 'WORK_ORDER_CREATED',
        entityType: 'WorkOrder',
        entityId: workOrder.id,
        title: `Work order created: ${workOrder.title}`,
        description: `${formatStatusLabel(input.priority)} priority`,
      });

      return workOrder;
    });
  }

  async list(
    organisationId: string,
    query: WorkOrderQuery,
  ): Promise<PaginatedResult<Prisma.WorkOrderGetPayload<{ include: typeof workOrderInclude }>>> {
    const where: Prisma.WorkOrderWhereInput = { organisationId };
    if (query.propertyId) where.propertyId = query.propertyId;
    if (query.status) where.status = { in: query.status };
    if (query.priority) where.priority = query.priority;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.workOrder.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: workOrderInclude,
      }),
      this.prisma.workOrder.count({ where }),
    ]);

    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async getById(organisationId: string, workOrderId: string) {
    return this.getOwned(organisationId, workOrderId);
  }

  async findByMaintenanceRequestId(organisationId: string, maintenanceRequestId: string) {
    return this.prisma.workOrder.findFirst({
      where: { organisationId, maintenanceRequestId, status: { not: 'CANCELLED' } },
      include: workOrderInclude,
    });
  }

  async updateStatus(
    organisationId: string,
    // Null for a system-triggered transition (e.g. auto-release once a
    // quote's workflow completes) — there is no human actor for that event.
    actorUserId: string | null,
    workOrderId: string,
    input: UpdateWorkOrderStatusInput,
  ) {
    const workOrder = await this.getOwned(organisationId, workOrderId);

    const allowed = VALID_TRANSITIONS[workOrder.status];
    if (!allowed.includes(input.status)) {
      throw new ConflictError(
        `Cannot move a work order from ${formatStatusLabel(workOrder.status)} to ${formatStatusLabel(input.status)}`,
      );
    }

    if (input.status === 'READY') {
      const governingQuote = this.governingQuote(workOrder);
      const result = deriveWorkflowResult(
        governingQuote?.workflowMode ?? null,
        governingQuote?.approvalStatus ?? null,
        governingQuote?.signatureStatus ?? null,
      );
      if (!canReleaseWorkOrder(result)) {
        throw new ConflictError(
          `Cannot release this work order: its quote's workflow is ${result.toLowerCase().replace('_', ' ')}`,
        );
      }
    }

    if (input.status === 'SCHEDULED' && !input.scheduledAt) {
      throw new ConflictError('A scheduled date is required to move a work order to Scheduled');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.workOrder.update({
        where: { id: workOrderId },
        data: {
          status: input.status,
          scheduledAt: input.status === 'SCHEDULED' ? input.scheduledAt : workOrder.scheduledAt,
          startedAt: input.status === 'IN_PROGRESS' ? new Date() : workOrder.startedAt,
          completedAt: input.status === 'COMPLETED' ? new Date() : workOrder.completedAt,
        },
        include: workOrderInclude,
      });

      await recordActivity(tx, {
        organisationId,
        propertyId: workOrder.propertyId,
        spaceId: workOrder.spaceId,
        actorUserId,
        eventType: 'WORK_ORDER_STATUS_CHANGED',
        entityType: 'WorkOrder',
        entityId: workOrder.id,
        title: `Work order moved to ${formatStatusLabel(input.status)}`,
        description: actorUserId
          ? workOrder.title
          : `${workOrder.title} · released automatically once its workflow completed`,
      });

      return updated;
    });
  }

  async assignContractor(
    organisationId: string,
    actorUserId: string,
    workOrderId: string,
    input: AssignContractorInput,
  ) {
    const workOrder = await this.getOwned(organisationId, workOrderId);
    const contractor = await this.contractorsService.assertActiveInOrg(
      organisationId,
      input.contractorId,
    );

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.workOrder.update({
        where: { id: workOrderId },
        data: { contractorId: contractor.id },
        include: workOrderInclude,
      });

      await recordActivity(tx, {
        organisationId,
        propertyId: workOrder.propertyId,
        spaceId: workOrder.spaceId,
        actorUserId,
        eventType: 'CONTRACTOR_ASSIGNED',
        entityType: 'WorkOrder',
        entityId: workOrder.id,
        title: `${contractor.name} assigned`,
        description: workOrder.title,
      });

      return updated;
    });
  }

  async updateCost(organisationId: string, workOrderId: string, input: UpdateCostInput) {
    await this.getOwned(organisationId, workOrderId);
    return this.prisma.workOrder.update({
      where: { id: workOrderId },
      data: input,
      include: workOrderInclude,
    });
  }
}
