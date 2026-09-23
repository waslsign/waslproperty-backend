import type { Prisma, PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import { ContractorEligibilityService } from './compliance/eligibility.service.js';
import type {
  ContractorQuery,
  CreateContractorInput,
  UpdateContractorInput,
} from './contractors.schemas.js';

export class ContractorsService {
  private readonly eligibility: ContractorEligibilityService;

  constructor(private readonly prisma: PrismaClient) {
    this.eligibility = new ContractorEligibilityService(prisma);
  }

  async create(organisationId: string, input: CreateContractorInput) {
    const existing = await this.prisma.contractor.findFirst({
      where: { organisationId, email: input.email },
    });
    if (existing) {
      throw new ConflictError('A contractor with this email already exists');
    }

    return this.prisma.contractor.create({
      data: { organisationId, ...input },
    });
  }

  async list(organisationId: string, query: ContractorQuery) {
    const where: Prisma.ContractorWhereInput = { organisationId };
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { companyName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.contractor.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.contractor.count({ where }),
    ]);

    // Two queries total for the whole page, regardless of contractor or
    // trade-category count — never itself an authorization decision, only
    // ever informational (a list badge + concise reason).
    const summaries = await this.eligibility.getComplianceSummaries(
      organisationId,
      items.map((item) => ({ id: item.id, tradeCategories: item.tradeCategories })),
    );
    const withCompliance = items.map((item) => {
      const summary = summaries.get(item.id);
      return {
        ...item,
        complianceStatus: summary?.status ?? 'COMPLIANT',
        complianceIssueCount: summary?.issueCount ?? 0,
        complianceTopIssues: summary?.topIssues ?? [],
      };
    });

    return { items: withCompliance, page: query.page, pageSize: query.pageSize, total };
  }

  async getById(organisationId: string, contractorId: string) {
    const contractor = await this.prisma.contractor.findFirst({
      where: { id: contractorId, organisationId },
      include: {
        workOrders: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, title: true, status: true, priority: true, createdAt: true },
        },
        quotes: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            workOrderId: true,
            amount: true,
            currencyCode: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });
    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }
    const compliance = await this.eligibility.getComplianceOverview(organisationId, contractorId);
    return { ...contractor, complianceStatus: compliance.status };
  }

  async update(organisationId: string, contractorId: string, input: UpdateContractorInput) {
    const contractor = await this.prisma.contractor.findFirst({
      where: { id: contractorId, organisationId },
    });
    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }
    return this.prisma.contractor.update({ where: { id: contractorId }, data: input });
  }

  /** Used by WorkOrdersService.assignContractor — kept here so the org-scoped existence check lives with the model it checks. */
  async assertActiveInOrg(organisationId: string, contractorId: string) {
    const contractor = await this.prisma.contractor.findFirst({
      where: { id: contractorId, organisationId, status: 'ACTIVE' },
    });
    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }
    return contractor;
  }
}
