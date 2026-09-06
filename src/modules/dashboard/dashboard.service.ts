import {
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceRequestStatus,
  ContractorQuoteStatus,
  type Prisma,
  type PrismaClient,
  WorkOrderStatus,
} from '@prisma/client';
import { ActivityService } from '../activity/activity.service.js';
import { getOccupiedSpaceIds } from '../../lib/occupancy.js';
import { deriveWorkflowResult, type WorkflowResult } from '../quotes/workflow-result.js';
import type { DashboardPeriod, DashboardQuery } from './dashboard.schemas.js';

/**
 * Precise semantics — these are deliberate choices, not incidental:
 *
 * - openRequests / activeWorkOrders / pendingSignature / portfolio /
 *   categoryBreakdown / priorityBreakdown / attention are all POINT-IN-TIME
 *   snapshots. An open request doesn't stop being open because it falls
 *   outside a 7-day window, so `period` never affects these.
 * - `period` affects exactly three things: completedThisPeriod, trend, and
 *   averageResolutionHours.
 * - OPEN REQUEST = MaintenanceRequest.status IN (NEW, UNDER_REVIEW, IN_PROGRESS).
 * - ACTIVE WORK ORDER = WorkOrder.status IN (READY, SCHEDULED, IN_PROGRESS).
 * - COMPLETED THIS PERIOD = WorkOrder.status = COMPLETED with completedAt
 *   inside [periodStart, periodEnd]. Deliberately work-orders-only, not a
 *   blended requests+work-orders figure — that would be a synthetic number.
 *   Request completions remain visible via requestsSnapshot + average
 *   resolution.
 * - PENDING SIGNATURE = ContractorQuote.workflowMode IN (SIGNATURE_ONLY,
 *   APPROVAL_THEN_SIGNATURE) AND signatureStatus IN (PENDING, PARTIALLY_SIGNED).
 * - AVERAGE RESOLUTION = mean(resolvedAt - reportedAt) in hours, over
 *   requests resolved within the period. Null when nothing resolved in the
 *   period (never 0 — 0 would falsely read as "instant").
 * - categoryBreakdown / priorityBreakdown are scoped to currently-open
 *   requests (not period-bound, not all-time) — the operationally useful cut.
 * - quotesSnapshot.byWorkflowResult reuses the existing pure
 *   deriveWorkflowResult() rather than reimplementing its logic.
 * - Every query below filters by organisationId directly — every relevant
 *   model already carries it denormalized, so no joins are needed for
 *   scoping. This is the single most safety-critical property of this file.
 */

const OPEN_REQUEST_STATUSES: MaintenanceRequestStatus[] = ['NEW', 'UNDER_REVIEW', 'IN_PROGRESS'];
const ACTIVE_WORK_ORDER_STATUSES: WorkOrderStatus[] = ['READY', 'SCHEDULED', 'IN_PROGRESS'];

const ATTENTION_HARD_CAP = 50;
const ATTENTION_DISPLAY_LIMIT = 8;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type AttentionSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export type AttentionItemType =
  | 'URGENT_REQUEST_OPEN'
  | 'WORK_ORDER_OVERDUE_SCHEDULE'
  | 'QUOTE_SIGNATURE_STALLED'
  | 'QUOTE_PENDING_APPROVAL_TOO_LONG'
  | 'WORK_ORDER_STUCK_IN_DRAFT'
  | 'STALE_OPEN_REQUEST'
  | 'QUOTE_REJECTED_NEEDS_FOLLOWUP';

export interface AttentionItem {
  id: string;
  type: AttentionItemType;
  severity: AttentionSeverity;
  title: string;
  description: string;
  entityType: 'MaintenanceRequest' | 'WorkOrder' | 'ContractorQuote';
  entityId: string;
  propertyId: string;
  spaceId: string | null;
  occurredAt: string;
  actionLabel: string;
  actionUrl: string;
}

export interface DashboardResponse {
  period: DashboardPeriod;
  periodStart: string;
  periodEnd: string;
  organisation: { id: string; name: string };
  attention: { items: AttentionItem[]; totalCount: number; displayLimit: number };
  metrics: {
    openRequests: number;
    activeWorkOrders: number;
    completedThisPeriod: number;
    pendingSignature: number;
  };
  portfolio: {
    totalProperties: number;
    totalSpaces: number;
    occupiedSpaces: number;
    vacantSpaces: number;
    occupancyRatePct: number;
  };
  requestsSnapshot: { byStatus: Array<{ status: MaintenanceRequestStatus; count: number }> };
  workOrdersSnapshot: { byStatus: Array<{ status: WorkOrderStatus; count: number }> };
  quotesSnapshot: {
    byStatus: Array<{ status: ContractorQuoteStatus; count: number }>;
    byWorkflowResult: Array<{ result: WorkflowResult; count: number }>;
  };
  trend: { points: Array<{ date: string; created: number; completed: number }> };
  categoryBreakdown: Array<{ category: MaintenanceCategory; count: number }>;
  priorityBreakdown: Array<{ priority: MaintenancePriority; count: number }>;
  averageResolutionHours: number | null;
  recentActivity: Prisma.ActivityEventGetPayload<object>[];
}

function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / HOUR_MS;
}

function formatAge(hours: number): string {
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function getPeriodRange(
  period: DashboardPeriod,
  now: Date,
): { periodStart: Date; periodEnd: Date } {
  const days = period === '7d' ? 7 : 30;
  return { periodStart: new Date(now.getTime() - days * DAY_MS), periodEnd: now };
}

/** UTC calendar-day boundaries for the trend chart — a one-day-boundary
 * simplification vs. the exact rolling `periodStart`/`periodEnd` used
 * elsewhere, purely so the chart has clean, whole-day buckets. */
function utcDayRange(days: number, now: Date): { start: Date; end: Date } {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999),
  );
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)),
  );
  return { start, end };
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class DashboardService {
  private readonly activityService: ActivityService;

  constructor(private readonly prisma: PrismaClient) {
    this.activityService = new ActivityService(prisma);
  }

  async getDashboard(organisationId: string, query: DashboardQuery): Promise<DashboardResponse> {
    const now = new Date();
    const { periodStart, periodEnd } = getPeriodRange(query.period, now);

    const organisation = await this.prisma.organisation.findUniqueOrThrow({
      where: { id: organisationId },
      select: { id: true, name: true },
    });

    const [
      metrics,
      portfolio,
      requestsSnapshot,
      workOrdersSnapshot,
      quotesSnapshot,
      trend,
      breakdowns,
      averageResolutionHours,
      attention,
      recentActivityResult,
    ] = await Promise.all([
      this.getMetrics(organisationId, periodStart, periodEnd),
      this.getPortfolio(organisationId),
      this.getRequestsSnapshot(organisationId),
      this.getWorkOrdersSnapshot(organisationId),
      this.getQuotesSnapshot(organisationId),
      this.getTrend(organisationId, query.period, now),
      this.getCategoryAndPriorityBreakdown(organisationId),
      this.getAverageResolutionHours(organisationId, periodStart, periodEnd),
      this.getAttentionItems(organisationId, now),
      this.activityService.listForOrganisation(organisationId, { page: 1, pageSize: 10 }),
    ]);

    return {
      period: query.period,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      organisation,
      attention,
      metrics,
      portfolio,
      requestsSnapshot,
      workOrdersSnapshot,
      quotesSnapshot,
      trend,
      categoryBreakdown: breakdowns.categoryBreakdown,
      priorityBreakdown: breakdowns.priorityBreakdown,
      averageResolutionHours,
      recentActivity: recentActivityResult.items,
    };
  }

  private async getMetrics(organisationId: string, periodStart: Date, periodEnd: Date) {
    const [openRequests, activeWorkOrders, completedThisPeriod, pendingSignature] =
      await Promise.all([
        this.prisma.maintenanceRequest.count({
          where: { organisationId, status: { in: OPEN_REQUEST_STATUSES } },
        }),
        this.prisma.workOrder.count({
          where: { organisationId, status: { in: ACTIVE_WORK_ORDER_STATUSES } },
        }),
        this.prisma.workOrder.count({
          where: {
            organisationId,
            status: 'COMPLETED',
            completedAt: { gte: periodStart, lte: periodEnd },
          },
        }),
        this.prisma.contractorQuote.count({
          where: {
            organisationId,
            workflowMode: { in: ['SIGNATURE_ONLY', 'APPROVAL_THEN_SIGNATURE'] },
            signatureStatus: { in: ['PENDING', 'PARTIALLY_SIGNED'] },
          },
        }),
      ]);
    return { openRequests, activeWorkOrders, completedThisPeriod, pendingSignature };
  }

  // Occupancy is derived from active TENANT/RESIDENT memberships — never
  // from Space.status, which covers unrelated operational states
  // (under maintenance, reserved). See src/lib/occupancy.ts, the single
  // source of truth for this already used elsewhere (e.g. property/space
  // detail pages) — reused here rather than reimplemented.
  private async getPortfolio(organisationId: string) {
    const [totalProperties, spaceRows] = await Promise.all([
      this.prisma.property.count({ where: { organisationId } }),
      this.prisma.space.findMany({ where: { organisationId }, select: { id: true } }),
    ]);
    const totalSpaces = spaceRows.length;
    const occupiedIds = await getOccupiedSpaceIds(
      this.prisma,
      spaceRows.map((s) => s.id),
    );
    const occupiedSpaces = occupiedIds.size;
    const vacantSpaces = totalSpaces - occupiedSpaces;
    const occupancyRatePct =
      totalSpaces === 0 ? 0 : Math.round((occupiedSpaces / totalSpaces) * 1000) / 10;
    return { totalProperties, totalSpaces, occupiedSpaces, vacantSpaces, occupancyRatePct };
  }

  private async getRequestsSnapshot(organisationId: string) {
    const grouped = await this.prisma.maintenanceRequest.groupBy({
      by: ['status'],
      where: { organisationId },
      _count: { _all: true },
    });
    const counts = new Map(grouped.map((g) => [g.status, g._count._all]));
    const byStatus = Object.values(MaintenanceRequestStatus).map((status) => ({
      status,
      count: counts.get(status) ?? 0,
    }));
    return { byStatus };
  }

  private async getWorkOrdersSnapshot(organisationId: string) {
    const grouped = await this.prisma.workOrder.groupBy({
      by: ['status'],
      where: { organisationId },
      _count: { _all: true },
    });
    const counts = new Map(grouped.map((g) => [g.status, g._count._all]));
    const byStatus = Object.values(WorkOrderStatus).map((status) => ({
      status,
      count: counts.get(status) ?? 0,
    }));
    return { byStatus };
  }

  private async getQuotesSnapshot(organisationId: string) {
    const [grouped, forWorkflowResult] = await Promise.all([
      this.prisma.contractorQuote.groupBy({
        by: ['status'],
        where: { organisationId },
        _count: { _all: true },
      }),
      this.prisma.contractorQuote.findMany({
        where: { organisationId },
        select: { workflowMode: true, approvalStatus: true, signatureStatus: true },
      }),
    ]);

    const statusCounts = new Map(grouped.map((g) => [g.status, g._count._all]));
    const byStatus = Object.values(ContractorQuoteStatus).map((status) => ({
      status,
      count: statusCounts.get(status) ?? 0,
    }));

    const resultCounts = new Map<WorkflowResult, number>();
    for (const q of forWorkflowResult) {
      const result = deriveWorkflowResult(q.workflowMode, q.approvalStatus, q.signatureStatus);
      resultCounts.set(result, (resultCounts.get(result) ?? 0) + 1);
    }
    const ALL_RESULTS: WorkflowResult[] = [
      'NOT_REQUIRED',
      'PENDING',
      'COMPLETED',
      'REJECTED',
      'FAILED',
      'CANCELLED',
    ];
    const byWorkflowResult = ALL_RESULTS.map((result) => ({
      result,
      count: resultCounts.get(result) ?? 0,
    }));

    return { byStatus, byWorkflowResult };
  }

  private async getTrend(organisationId: string, period: DashboardPeriod, now: Date) {
    const days = period === '7d' ? 7 : 30;
    const { start, end } = utcDayRange(days, now);

    const [created, resolved] = await Promise.all([
      this.prisma.maintenanceRequest.findMany({
        where: { organisationId, reportedAt: { gte: start, lte: end } },
        select: { reportedAt: true },
      }),
      this.prisma.maintenanceRequest.findMany({
        where: { organisationId, resolvedAt: { gte: start, lte: end } },
        select: { resolvedAt: true },
      }),
    ]);

    const buckets = new Map<string, { created: number; completed: number }>();
    for (let i = 0; i < days; i++) {
      buckets.set(dayKey(new Date(start.getTime() + i * DAY_MS)), { created: 0, completed: 0 });
    }
    for (const r of created) {
      const bucket = buckets.get(dayKey(r.reportedAt));
      if (bucket) bucket.created += 1;
    }
    for (const r of resolved) {
      if (!r.resolvedAt) continue;
      const bucket = buckets.get(dayKey(r.resolvedAt));
      if (bucket) bucket.completed += 1;
    }

    const points = [...buckets.entries()].map(([date, counts]) => ({ date, ...counts }));
    return { points };
  }

  private async getCategoryAndPriorityBreakdown(organisationId: string) {
    const openWhere: Prisma.MaintenanceRequestWhereInput = {
      organisationId,
      status: { in: OPEN_REQUEST_STATUSES },
    };
    const [byCategoryRaw, byPriorityRaw] = await Promise.all([
      this.prisma.maintenanceRequest.groupBy({
        by: ['category'],
        where: openWhere,
        _count: { _all: true },
      }),
      this.prisma.maintenanceRequest.groupBy({
        by: ['priority'],
        where: openWhere,
        _count: { _all: true },
      }),
    ]);

    const categoryCounts = new Map(byCategoryRaw.map((c) => [c.category, c._count._all]));
    const categoryBreakdown = Object.values(MaintenanceCategory).map((category) => ({
      category,
      count: categoryCounts.get(category) ?? 0,
    }));

    const priorityCounts = new Map(byPriorityRaw.map((p) => [p.priority, p._count._all]));
    const priorityBreakdown = Object.values(MaintenancePriority).map((priority) => ({
      priority,
      count: priorityCounts.get(priority) ?? 0,
    }));

    return { categoryBreakdown, priorityBreakdown };
  }

  /** No native Prisma avg-of-date-diff exists, and this codebase has no raw
   * SQL precedent — a narrow select of just the two timestamp columns +
   * a JS reduce matches the existing PropertySummary precedent of computing
   * derived numbers in application code. */
  private async getAverageResolutionHours(
    organisationId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<number | null> {
    const rows = await this.prisma.maintenanceRequest.findMany({
      where: {
        organisationId,
        status: { in: ['RESOLVED', 'CLOSED'] },
        resolvedAt: { gte: periodStart, lte: periodEnd },
      },
      select: { reportedAt: true, resolvedAt: true },
    });
    if (rows.length === 0) return null;

    const totalHours = rows.reduce(
      (sum, r) => sum + hoursBetween(r.reportedAt, r.resolvedAt as Date),
      0,
    );
    return Math.round((totalHours / rows.length) * 10) / 10;
  }

  private async getAttentionItems(organisationId: string, now: Date) {
    const results = await Promise.all([
      this.findUrgentRequestsOpen(organisationId, now),
      this.findWorkOrderOverdueSchedule(organisationId, now),
      this.findQuoteSignatureStalled(organisationId, now),
      this.findQuotePendingApprovalTooLong(organisationId, now),
      this.findWorkOrderStuckInDraft(organisationId, now),
      this.findStaleOpenRequests(organisationId, now),
      this.findQuoteRejectedNeedsFollowup(organisationId, now),
    ]);

    const severityRank: Record<AttentionSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    const typeRank: Record<AttentionItemType, number> = {
      URGENT_REQUEST_OPEN: 0,
      WORK_ORDER_OVERDUE_SCHEDULE: 1,
      QUOTE_SIGNATURE_STALLED: 2,
      QUOTE_PENDING_APPROVAL_TOO_LONG: 3,
      WORK_ORDER_STUCK_IN_DRAFT: 4,
      STALE_OPEN_REQUEST: 5,
      QUOTE_REJECTED_NEEDS_FOLLOWUP: 6,
    };

    const all = results.flat();
    all.sort(
      (a, b) =>
        severityRank[a.severity] - severityRank[b.severity] ||
        typeRank[a.type] - typeRank[b.type] ||
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );

    return {
      items: all.slice(0, ATTENTION_HARD_CAP),
      totalCount: all.length,
      displayLimit: ATTENTION_DISPLAY_LIMIT,
    };
  }

  private async findUrgentRequestsOpen(
    organisationId: string,
    now: Date,
  ): Promise<AttentionItem[]> {
    const rows = await this.prisma.maintenanceRequest.findMany({
      where: { organisationId, priority: 'URGENT', status: { in: OPEN_REQUEST_STATUSES } },
      select: { id: true, title: true, propertyId: true, spaceId: true, reportedAt: true },
    });

    const items: AttentionItem[] = [];
    for (const r of rows) {
      const ageHours = hoursBetween(r.reportedAt, now);
      if (ageHours <= 4) continue;
      items.push({
        id: `URGENT_REQUEST_OPEN:${r.id}`,
        type: 'URGENT_REQUEST_OPEN',
        severity: ageHours > 24 ? 'CRITICAL' : 'WARNING',
        title: `Urgent request still open: ${r.title}`,
        description: `Reported ${formatAge(ageHours)} ago and still not resolved.`,
        entityType: 'MaintenanceRequest',
        entityId: r.id,
        propertyId: r.propertyId,
        spaceId: r.spaceId,
        occurredAt: r.reportedAt.toISOString(),
        actionLabel: 'View request',
        actionUrl: `/operations/requests/${r.id}`,
      });
    }
    return items;
  }

  private async findStaleOpenRequests(organisationId: string, now: Date): Promise<AttentionItem[]> {
    const rows = await this.prisma.maintenanceRequest.findMany({
      where: {
        organisationId,
        priority: { not: 'URGENT' },
        status: { in: OPEN_REQUEST_STATUSES },
      },
      select: { id: true, title: true, propertyId: true, spaceId: true, reportedAt: true },
    });

    const items: AttentionItem[] = [];
    for (const r of rows) {
      const ageHours = hoursBetween(r.reportedAt, now);
      if (ageHours <= 7 * 24) continue;
      items.push({
        id: `STALE_OPEN_REQUEST:${r.id}`,
        type: 'STALE_OPEN_REQUEST',
        severity: 'WARNING',
        title: `Open for over a week: ${r.title}`,
        description: `Reported ${formatAge(ageHours)} ago and still open.`,
        entityType: 'MaintenanceRequest',
        entityId: r.id,
        propertyId: r.propertyId,
        spaceId: r.spaceId,
        occurredAt: r.reportedAt.toISOString(),
        actionLabel: 'View request',
        actionUrl: `/operations/requests/${r.id}`,
      });
    }
    return items;
  }

  private async findWorkOrderStuckInDraft(
    organisationId: string,
    now: Date,
  ): Promise<AttentionItem[]> {
    const rows = await this.prisma.workOrder.findMany({
      where: { organisationId, status: 'DRAFT' },
      select: { id: true, title: true, propertyId: true, spaceId: true, createdAt: true },
    });

    const items: AttentionItem[] = [];
    for (const r of rows) {
      const ageHours = hoursBetween(r.createdAt, now);
      if (ageHours <= 3 * 24) continue;
      items.push({
        id: `WORK_ORDER_STUCK_IN_DRAFT:${r.id}`,
        type: 'WORK_ORDER_STUCK_IN_DRAFT',
        severity: ageHours > 7 * 24 ? 'CRITICAL' : 'WARNING',
        title: `Work order stuck in Draft: ${r.title}`,
        description: `Created ${formatAge(ageHours)} ago and not yet released.`,
        entityType: 'WorkOrder',
        entityId: r.id,
        propertyId: r.propertyId,
        spaceId: r.spaceId,
        occurredAt: r.createdAt.toISOString(),
        actionLabel: 'View work order',
        actionUrl: `/operations/work-orders/${r.id}`,
      });
    }
    return items;
  }

  private async findWorkOrderOverdueSchedule(
    organisationId: string,
    now: Date,
  ): Promise<AttentionItem[]> {
    const rows = await this.prisma.workOrder.findMany({
      where: { organisationId, status: 'SCHEDULED', scheduledAt: { lt: now } },
      select: { id: true, title: true, propertyId: true, spaceId: true, scheduledAt: true },
    });

    return rows.map((r) => {
      const overdueHours = hoursBetween(r.scheduledAt as Date, now);
      return {
        id: `WORK_ORDER_OVERDUE_SCHEDULE:${r.id}`,
        type: 'WORK_ORDER_OVERDUE_SCHEDULE' as const,
        severity: overdueHours >= 48 ? ('CRITICAL' as const) : ('WARNING' as const),
        title: `Scheduled work overdue: ${r.title}`,
        description: `Was scheduled ${formatAge(overdueHours)} ago and hasn't started.`,
        entityType: 'WorkOrder' as const,
        entityId: r.id,
        propertyId: r.propertyId,
        spaceId: r.spaceId,
        occurredAt: (r.scheduledAt as Date).toISOString(),
        actionLabel: 'View work order',
        actionUrl: `/operations/work-orders/${r.id}`,
      };
    });
  }

  private async findQuotePendingApprovalTooLong(
    organisationId: string,
    now: Date,
  ): Promise<AttentionItem[]> {
    const rows = await this.prisma.contractorQuote.findMany({
      where: {
        organisationId,
        approvalStatus: 'PENDING',
        workflowMode: { in: ['APPROVAL_ONLY', 'APPROVAL_THEN_SIGNATURE'] },
      },
      select: {
        id: true,
        submittedAt: true,
        createdAt: true,
        workOrder: { select: { id: true, title: true, propertyId: true, spaceId: true } },
      },
    });

    const items: AttentionItem[] = [];
    for (const r of rows) {
      const since = r.submittedAt ?? r.createdAt;
      const ageHours = hoursBetween(since, now);
      if (ageHours <= 3 * 24) continue;
      items.push({
        id: `QUOTE_PENDING_APPROVAL_TOO_LONG:${r.id}`,
        type: 'QUOTE_PENDING_APPROVAL_TOO_LONG',
        severity: ageHours > 7 * 24 ? 'CRITICAL' : 'WARNING',
        title: `Quote awaiting approval: ${r.workOrder.title}`,
        description: `Submitted for approval ${formatAge(ageHours)} ago.`,
        entityType: 'ContractorQuote',
        entityId: r.id,
        propertyId: r.workOrder.propertyId,
        spaceId: r.workOrder.spaceId,
        occurredAt: since.toISOString(),
        actionLabel: 'View work order',
        actionUrl: `/operations/work-orders/${r.workOrder.id}`,
      });
    }
    return items;
  }

  private async findQuoteSignatureStalled(
    organisationId: string,
    now: Date,
  ): Promise<AttentionItem[]> {
    const rows = await this.prisma.contractorQuote.findMany({
      where: {
        organisationId,
        signatureStatus: { in: ['PENDING', 'PARTIALLY_SIGNED'] },
        OR: [
          { workflowMode: 'SIGNATURE_ONLY' },
          { workflowMode: 'APPROVAL_THEN_SIGNATURE', approvalStatus: 'APPROVED' },
        ],
      },
      select: {
        id: true,
        submittedAt: true,
        createdAt: true,
        signatureStatus: true,
        workOrder: { select: { id: true, title: true, propertyId: true, spaceId: true } },
      },
    });

    const items: AttentionItem[] = [];
    for (const r of rows) {
      const since = r.submittedAt ?? r.createdAt;
      const ageHours = hoursBetween(since, now);
      // Someone is actively waiting on a co-signer once one side has already
      // signed — that deserves a tighter threshold than a signature nobody
      // has touched yet.
      const isPartial = r.signatureStatus === 'PARTIALLY_SIGNED';
      const warnAtDays = isPartial ? 1 : 3;
      const critAtDays = isPartial ? 5 : 7;
      const ageDays = ageHours / 24;
      if (ageDays <= warnAtDays) continue;
      items.push({
        id: `QUOTE_SIGNATURE_STALLED:${r.id}`,
        type: 'QUOTE_SIGNATURE_STALLED',
        severity: ageDays > critAtDays ? 'CRITICAL' : 'WARNING',
        title: `Signature stalled: ${r.workOrder.title}`,
        description: isPartial
          ? `Partially signed ${formatAge(ageHours)} ago — still waiting on the other signer.`
          : `Sent for signature ${formatAge(ageHours)} ago with no signatures yet.`,
        entityType: 'ContractorQuote',
        entityId: r.id,
        propertyId: r.workOrder.propertyId,
        spaceId: r.workOrder.spaceId,
        occurredAt: since.toISOString(),
        actionLabel: 'View work order',
        actionUrl: `/operations/work-orders/${r.workOrder.id}`,
      });
    }
    return items;
  }

  private async findQuoteRejectedNeedsFollowup(
    organisationId: string,
    now: Date,
  ): Promise<AttentionItem[]> {
    const cutoff = new Date(now.getTime() - 14 * DAY_MS);
    const rejected = await this.prisma.contractorQuote.findMany({
      where: { organisationId, status: 'REJECTED', rejectedAt: { gte: cutoff } },
      select: {
        id: true,
        rejectedAt: true,
        createdAt: true,
        workOrderId: true,
        workOrder: { select: { id: true, title: true, propertyId: true, spaceId: true } },
      },
    });
    if (rejected.length === 0) return [];

    // Only flag it if no newer quote has since been requested for the same
    // work order — a superseded rejection doesn't need a nudge.
    const workOrderIds = [...new Set(rejected.map((r) => r.workOrderId))];
    const allQuotesForThoseWorkOrders = await this.prisma.contractorQuote.findMany({
      where: { workOrderId: { in: workOrderIds } },
      select: { workOrderId: true, createdAt: true },
    });
    const latestCreatedAtByWorkOrder = new Map<string, number>();
    for (const q of allQuotesForThoseWorkOrders) {
      const t = q.createdAt.getTime();
      const current = latestCreatedAtByWorkOrder.get(q.workOrderId) ?? -Infinity;
      if (t > current) latestCreatedAtByWorkOrder.set(q.workOrderId, t);
    }

    const items: AttentionItem[] = [];
    for (const r of rejected) {
      if (latestCreatedAtByWorkOrder.get(r.workOrderId) !== r.createdAt.getTime()) continue;
      items.push({
        id: `QUOTE_REJECTED_NEEDS_FOLLOWUP:${r.id}`,
        type: 'QUOTE_REJECTED_NEEDS_FOLLOWUP',
        severity: 'WARNING',
        title: `Quote rejected: ${r.workOrder.title}`,
        description: 'This quote was rejected and no replacement quote has been requested yet.',
        entityType: 'ContractorQuote',
        entityId: r.id,
        propertyId: r.workOrder.propertyId,
        spaceId: r.workOrder.spaceId,
        occurredAt: (r.rejectedAt as Date).toISOString(),
        actionLabel: 'View work order',
        actionUrl: `/operations/work-orders/${r.workOrder.id}`,
      });
    }
    return items;
  }
}
