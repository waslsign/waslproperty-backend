import type {
  ComplianceEnforcement,
  ContractorComplianceRequirement,
  ContractorCredential,
  CredentialCategory,
  MaintenanceCategory,
  PrismaClient,
} from '@prisma/client';
import { NotFoundError } from '../../../errors/AppError.js';
import { deriveCredentialStatus } from './credentialStatus.js';

function formatMaintenanceCategoryLabel(category: string): string {
  return category
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export type ComplianceIssueReason =
  | 'TRADE_MISMATCH'
  | 'MISSING'
  | 'EXPIRED'
  | 'EXPIRING_SOON'
  | 'NOT_VERIFIED'
  | 'REJECTED'
  | 'INSUFFICIENT_COVERAGE';

/** Lower = more severe. Used both to pick the overview status and to rank
 * which issues surface first in a compact list-row summary. A blocking vs
 * warning issue can carry any of these reasons (bucket placement follows
 * the requirement's own `enforcement`, not the reason) — this ranking is
 * only ever a tie-breaker within/across that already-real bucketing. */
const REASON_SEVERITY: Record<ComplianceIssueReason, number> = {
  EXPIRED: 0,
  REJECTED: 0,
  MISSING: 1,
  TRADE_MISMATCH: 1,
  INSUFFICIENT_COVERAGE: 1,
  NOT_VERIFIED: 2,
  EXPIRING_SOON: 3,
};

export interface ComplianceIssue {
  /** Null for TRADE_MISMATCH — a structural check, not a configured
   * requirement row. */
  requirementId: string | null;
  credentialType: string;
  credentialCategory: CredentialCategory | null;
  reason: ComplianceIssueReason;
  message: string;
  enforcement: ComplianceEnforcement;
  expiresAt: string | null;
  credentialId: string | null;
}

export interface SatisfiedRequirement {
  requirementId: string;
  credentialType: string;
  credentialId: string;
}

export interface EligibilityResult {
  contractorId: string;
  category: MaintenanceCategory | null;
  /** True iff blockingIssues is empty — the actual gate WorkOrdersService
   * enforces. `warnings` never affect this. */
  eligible: boolean;
  blockingIssues: ComplianceIssue[];
  warnings: ComplianceIssue[];
  satisfiedRequirements: SatisfiedRequirement[];
}

export type ContractorComplianceOverviewStatus =
  | 'COMPLIANT'
  | 'EXPIRING_SOON'
  | 'ACTION_REQUIRED'
  | 'EXPIRED_CREDENTIALS'
  | 'PENDING_VERIFICATION';

/** A single requirement's state, distilled to exactly one value — unlike
 * `ComplianceIssue` (which can, by design, place the same underlying fact
 * in both `warnings` and `satisfiedRequirements` for an expiring-soon
 * credential), the Contractor Detail compliance view needs one canonical
 * answer per requirement row. Every value here is a real, already-derived
 * fact — never invented. */
export type RequirementStatus =
  | 'SATISFIED'
  | 'MISSING'
  | 'EXPIRED'
  | 'EXPIRING_SOON'
  | 'PENDING_VERIFICATION'
  | 'REJECTED'
  | 'INSUFFICIENT_COVERAGE';

const REQUIREMENT_STATUS_RANK: Record<RequirementStatus, number> = {
  EXPIRED: 0,
  REJECTED: 0,
  MISSING: 1,
  INSUFFICIENT_COVERAGE: 1,
  PENDING_VERIFICATION: 2,
  EXPIRING_SOON: 3,
  SATISFIED: 4,
};

/** One row the Contractor Detail compliance view can render directly —
 * the requirement itself (deduplicated: the same credential requirement
 * configured for more than one of the contractor's trades is represented
 * once, with every applicable trade listed) plus its single evaluated
 * status against this contractor's actual credentials. */
export interface ApplicableRequirement {
  requirementIds: string[];
  credentialCategory: CredentialCategory;
  credentialType: string;
  categories: MaintenanceCategory[];
  enforcement: ComplianceEnforcement;
  mustBeVerified: boolean;
  mustNotBeExpired: boolean;
  minimumCoverageAmount: string | null;
  minimumCoverageCurrencyCode: string | null;
  status: RequirementStatus;
  message: string;
  matchedCredentialId: string | null;
  matchedCredentialExpiresAt: string | null;
}

export interface ContractorComplianceOverview {
  status: ContractorComplianceOverviewStatus;
  byCategory: Array<{ category: MaintenanceCategory; result: EligibilityResult }>;
  /** Every requirement applicable to this contractor's trades, each with
   * its own real evaluated status — the Credentials/Compliance tab's
   * source of truth for "what's required, what's missing, what's already
   * satisfied." Never capped (unlike the list row's `topIssues`). */
  applicableRequirements: ApplicableRequirement[];
}

export interface ContractorComplianceIssueSummary {
  message: string;
  reason: ComplianceIssueReason;
}

/** Compact, list-row-friendly shape — real derived data only (no scores,
 * no invented statuses beyond ContractorComplianceOverviewStatus itself).
 * `topIssues` is capped so a row never turns into an error dump; the full
 * picture is always one click away via the Contractor Detail compliance
 * tab. */
export interface ContractorComplianceSummary {
  status: ContractorComplianceOverviewStatus;
  issueCount: number;
  topIssues: ContractorComplianceIssueSummary[];
}

const LIST_TOP_ISSUES_LIMIT = 2;

/** Combined blocking+warning issues, worst-first: blocking-bucket
 * membership matters more than reason severity (an actual assignment
 * blocker always outranks an advisory one), reason severity breaks ties
 * within each bucket. */
function rankIssues(
  blockingIssues: ComplianceIssue[],
  warnings: ComplianceIssue[],
): ComplianceIssue[] {
  const bySeverity = (issues: ComplianceIssue[]) =>
    [...issues].sort((a, b) => REASON_SEVERITY[a.reason] - REASON_SEVERITY[b.reason]);
  return [...bySeverity(blockingIssues), ...bySeverity(warnings)];
}

function deriveOverviewStatus(allIssues: ComplianceIssue[]): ContractorComplianceOverviewStatus {
  if (allIssues.length === 0) return 'COMPLIANT';
  const minSeverity = Math.min(...allIssues.map((i) => REASON_SEVERITY[i.reason]));
  switch (minSeverity) {
    case 0:
      return 'EXPIRED_CREDENTIALS';
    case 1:
      return 'ACTION_REQUIRED';
    case 2:
      return 'PENDING_VERIFICATION';
    default:
      return 'EXPIRING_SOON';
  }
}

/** Among credentials matching a requirement's (category, type), the one
 * whose current state is most favourable to the contractor — e.g. a
 * contractor who uploaded an expired policy and then a renewed one should
 * be judged on the renewal, not whichever row happens to sort first.
 * VERIFIED-and-not-expired wins; otherwise the most recently added row. */
function pickBestCredential(
  candidates: ContractorCredential[],
  now: Date,
): ContractorCredential | null {
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort((a, b) => {
    const statusA = deriveCredentialStatus(a, now);
    const statusB = deriveCredentialStatus(b, now);
    const rank = (s: string) =>
      s === 'CURRENT' || s === 'EXPIRING_SOON' ? 0 : s === 'PENDING' ? 1 : 2;
    const diff = rank(statusA) - rank(statusB);
    if (diff !== 0) return diff;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  return ranked[0] ?? null;
}

interface RequirementEvaluation {
  status: RequirementStatus;
  message: string;
  matchedCredentialId: string | null;
  matchedCredentialExpiresAt: string | null;
}

/** Pure, single-status evaluation of one requirement against a
 * contractor's credentials — mirrors the exact same rule priority as the
 * per-requirement branch inside `evaluateAgainstData` (REJECTED >
 * not-yet-verified > EXPIRED > insufficient coverage > EXPIRING_SOON >
 * SATISFIED), but collapses it to one canonical answer instead of that
 * function's dual blocking/warning + satisfied bucketing. Deliberately
 * kept separate from `evaluateAgainstData` rather than derived from it:
 * that function's exact bucket semantics are what Work Order assignment
 * enforcement depends on, and are not touched here. */
function evaluateRequirement(
  req: ContractorComplianceRequirement,
  matchingCredentials: ContractorCredential[],
  now: Date,
): RequirementEvaluation {
  const best = pickBestCredential(matchingCredentials, now);

  if (!best) {
    return req.required
      ? {
          status: 'MISSING',
          message: `${req.credentialType} has not been provided.`,
          matchedCredentialId: null,
          matchedCredentialExpiresAt: null,
        }
      : {
          status: 'SATISFIED',
          message: `${req.credentialType} is not required.`,
          matchedCredentialId: null,
          matchedCredentialExpiresAt: null,
        };
  }

  const credentialStatus = deriveCredentialStatus(best, now);
  const expiresAtIso = best.expiresAt?.toISOString() ?? null;

  if (credentialStatus === 'REJECTED') {
    return req.required
      ? {
          status: 'REJECTED',
          message: `${req.credentialType} was rejected during review.`,
          matchedCredentialId: best.id,
          matchedCredentialExpiresAt: expiresAtIso,
        }
      : {
          status: 'SATISFIED',
          message: `${req.credentialType} is on file.`,
          matchedCredentialId: best.id,
          matchedCredentialExpiresAt: expiresAtIso,
        };
  }

  if (credentialStatus === 'PENDING') {
    return req.required && req.mustBeVerified
      ? {
          status: 'PENDING_VERIFICATION',
          message: `${req.credentialType} is awaiting verification.`,
          matchedCredentialId: best.id,
          matchedCredentialExpiresAt: expiresAtIso,
        }
      : {
          status: 'SATISFIED',
          message: `${req.credentialType} is on file.`,
          matchedCredentialId: best.id,
          matchedCredentialExpiresAt: expiresAtIso,
        };
  }

  if (credentialStatus === 'EXPIRED') {
    return req.required && req.mustNotBeExpired
      ? {
          status: 'EXPIRED',
          message: `${req.credentialType} expired${expiresAtIso ? ` on ${expiresAtIso.slice(0, 10)}` : ''}.`,
          matchedCredentialId: best.id,
          matchedCredentialExpiresAt: expiresAtIso,
        }
      : {
          status: 'SATISFIED',
          message: `${req.credentialType} is on file.`,
          matchedCredentialId: best.id,
          matchedCredentialExpiresAt: expiresAtIso,
        };
  }

  // CURRENT or EXPIRING_SOON.
  if (req.credentialCategory === 'INSURANCE' && req.minimumCoverageAmount != null && req.required) {
    const hasSufficientCoverage =
      best.coverageAmount != null &&
      Number(best.coverageAmount) >= Number(req.minimumCoverageAmount);
    if (!hasSufficientCoverage) {
      return {
        status: 'INSUFFICIENT_COVERAGE',
        message: `${req.credentialType} coverage does not meet the required minimum.`,
        matchedCredentialId: best.id,
        matchedCredentialExpiresAt: expiresAtIso,
      };
    }
  }

  if (credentialStatus === 'EXPIRING_SOON') {
    return {
      status: 'EXPIRING_SOON',
      message: `${req.credentialType} expires soon${expiresAtIso ? ` (${expiresAtIso.slice(0, 10)})` : ''}.`,
      matchedCredentialId: best.id,
      matchedCredentialExpiresAt: expiresAtIso,
    };
  }

  return {
    status: 'SATISFIED',
    message: `${req.credentialType} is current.`,
    matchedCredentialId: best.id,
    matchedCredentialExpiresAt: expiresAtIso,
  };
}

/** Deduplicates requirement rows sharing an identical evaluated outcome
 * for this contractor (same credential category/type, same resulting
 * status/message/matched credential) into one row listing every
 * applicable trade — an organisation that configured "Public Liability
 * Insurance" for both Electrical and Plumbing should read as one
 * requirement applicable to both, not two confusingly identical rows.
 * Requirements whose outcome genuinely differs per trade (different
 * enforcement/verification/expiry rules) are kept separate. */
function buildApplicableRequirements(
  requirements: ContractorComplianceRequirement[],
  credentials: ContractorCredential[],
  now: Date,
): ApplicableRequirement[] {
  const merged = new Map<string, ApplicableRequirement>();

  for (const req of requirements) {
    const matching = credentials.filter(
      (c) =>
        c.category === req.credentialCategory &&
        c.type.trim().toLowerCase() === req.credentialType.trim().toLowerCase(),
    );
    const evaluation = evaluateRequirement(req, matching, now);
    const key = [
      req.credentialCategory,
      req.credentialType.trim().toLowerCase(),
      evaluation.status,
      evaluation.message,
      evaluation.matchedCredentialId ?? '',
    ].join('|');

    const existing = merged.get(key);
    if (existing) {
      existing.requirementIds.push(req.id);
      if (!existing.categories.includes(req.category)) {
        existing.categories.push(req.category);
      }
      continue;
    }

    merged.set(key, {
      requirementIds: [req.id],
      credentialCategory: req.credentialCategory,
      credentialType: req.credentialType,
      categories: [req.category],
      enforcement: req.enforcement,
      mustBeVerified: req.mustBeVerified,
      mustNotBeExpired: req.mustNotBeExpired,
      minimumCoverageAmount:
        req.minimumCoverageAmount != null ? req.minimumCoverageAmount.toString() : null,
      minimumCoverageCurrencyCode: req.minimumCoverageCurrencyCode,
      status: evaluation.status,
      message: evaluation.message,
      matchedCredentialId: evaluation.matchedCredentialId,
      matchedCredentialExpiresAt: evaluation.matchedCredentialExpiresAt,
    });
  }

  return Array.from(merged.values()).sort(
    (a, b) => REQUIREMENT_STATUS_RANK[a.status] - REQUIREMENT_STATUS_RANK[b.status],
  );
}

/**
 * The one place WaslProp answers "is this contractor eligible for this
 * work" — deterministic, structured, and fully explainable. Never reduced
 * to a single boolean internally: every caller (Work Order assignment
 * enforcement, the contractor selector UX, the contractor compliance
 * profile, the contractor list row) gets the same
 * blockingIssues/warnings/satisfiedRequirements shape, so the reasons
 * shown to a manager are exactly the reasons the backend actually
 * enforced.
 */
export class ContractorEligibilityService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Resolves a work order's trade/category via its originating
   * MaintenanceRequest — every WorkOrder today is created from one (see
   * WorkOrdersService.create), so this is always resolvable in practice;
   * null is handled defensively for a future direct-creation path. */
  async evaluateForWorkOrder(
    organisationId: string,
    contractorId: string,
    workOrderId: string,
  ): Promise<EligibilityResult> {
    const workOrder = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, organisationId },
      select: { maintenanceRequest: { select: { category: true } } },
    });
    if (!workOrder) {
      throw new NotFoundError('Work order not found');
    }
    return this.evaluate(
      organisationId,
      contractorId,
      workOrder.maintenanceRequest?.category ?? null,
    );
  }

  /** Pure — no DB access. The single place the actual rule-matching logic
   * lives, so `evaluate()` (one contractor, DB-backed) and
   * `getComplianceOverview`/`getComplianceSummaries` (batched, pre-fetched
   * data) can never drift apart. */
  private evaluateAgainstData(
    contractorId: string,
    category: MaintenanceCategory,
    contractorTradeCategories: MaintenanceCategory[],
    credentials: ContractorCredential[],
    requirements: ContractorComplianceRequirement[],
    now: Date,
  ): EligibilityResult {
    const blockingIssues: ComplianceIssue[] = [];
    const warnings: ComplianceIssue[] = [];
    const satisfiedRequirements: SatisfiedRequirement[] = [];

    // Trade match — only ever a hard block, never organisation-configurable
    // (this is a structural sanity check, not a compliance requirement).
    // A contractor who has never been classified (empty tradeCategories,
    // true of every contractor that predates this milestone) is treated as
    // unclassified, not mismatched — never silently blocked by a migration
    // that ran with nobody classified yet.
    if (contractorTradeCategories.length > 0 && !contractorTradeCategories.includes(category)) {
      blockingIssues.push({
        requirementId: null,
        credentialType: 'Trade classification',
        credentialCategory: null,
        reason: 'TRADE_MISMATCH',
        message: `This contractor is not classified for ${formatMaintenanceCategoryLabel(category)} work.`,
        enforcement: 'BLOCK_ASSIGNMENT',
        expiresAt: null,
        credentialId: null,
      });
    }

    for (const req of requirements) {
      const matching = credentials.filter(
        (c) =>
          c.category === req.credentialCategory &&
          c.type.trim().toLowerCase() === req.credentialType.trim().toLowerCase(),
      );
      const best = pickBestCredential(matching, now);
      const bucket = req.enforcement === 'BLOCK_ASSIGNMENT' ? blockingIssues : warnings;

      if (!best) {
        if (req.required) {
          bucket.push({
            requirementId: req.id,
            credentialType: req.credentialType,
            credentialCategory: req.credentialCategory,
            reason: 'MISSING',
            message: `${req.credentialType} has not been provided.`,
            enforcement: req.enforcement,
            expiresAt: null,
            credentialId: null,
          });
        }
        continue;
      }

      const status = deriveCredentialStatus(best, now);
      const expiresAtIso = best.expiresAt?.toISOString() ?? null;

      if (status === 'REJECTED') {
        if (req.required) {
          bucket.push({
            requirementId: req.id,
            credentialType: req.credentialType,
            credentialCategory: req.credentialCategory,
            reason: 'REJECTED',
            message: `${req.credentialType} was rejected during review.`,
            enforcement: req.enforcement,
            expiresAt: expiresAtIso,
            credentialId: best.id,
          });
        }
        continue;
      }

      if (status === 'PENDING') {
        if (req.required && req.mustBeVerified) {
          bucket.push({
            requirementId: req.id,
            credentialType: req.credentialType,
            credentialCategory: req.credentialCategory,
            reason: 'NOT_VERIFIED',
            message: `${req.credentialType} is awaiting verification.`,
            enforcement: req.enforcement,
            expiresAt: expiresAtIso,
            credentialId: best.id,
          });
          continue;
        }
        satisfiedRequirements.push({
          requirementId: req.id,
          credentialType: req.credentialType,
          credentialId: best.id,
        });
        continue;
      }

      if (status === 'EXPIRED') {
        if (req.required && req.mustNotBeExpired) {
          bucket.push({
            requirementId: req.id,
            credentialType: req.credentialType,
            credentialCategory: req.credentialCategory,
            reason: 'EXPIRED',
            message: `${req.credentialType} expired${expiresAtIso ? ` on ${expiresAtIso.slice(0, 10)}` : ''}.`,
            enforcement: req.enforcement,
            expiresAt: expiresAtIso,
            credentialId: best.id,
          });
          continue;
        }
        satisfiedRequirements.push({
          requirementId: req.id,
          credentialType: req.credentialType,
          credentialId: best.id,
        });
        continue;
      }

      // CURRENT or EXPIRING_SOON — genuinely valid right now either way;
      // EXPIRING_SOON is always advisory-only, never a hard block, since
      // the credential is still valid at the moment of assignment.
      if (status === 'EXPIRING_SOON') {
        warnings.push({
          requirementId: req.id,
          credentialType: req.credentialType,
          credentialCategory: req.credentialCategory,
          reason: 'EXPIRING_SOON',
          message: `${req.credentialType} expires soon${expiresAtIso ? ` (${expiresAtIso.slice(0, 10)})` : ''}.`,
          enforcement: 'WARN_ONLY',
          expiresAt: expiresAtIso,
          credentialId: best.id,
        });
      }

      if (
        req.credentialCategory === 'INSURANCE' &&
        req.minimumCoverageAmount != null &&
        req.required
      ) {
        const hasSufficientCoverage =
          best.coverageAmount != null &&
          Number(best.coverageAmount) >= Number(req.minimumCoverageAmount);
        if (!hasSufficientCoverage) {
          bucket.push({
            requirementId: req.id,
            credentialType: req.credentialType,
            credentialCategory: req.credentialCategory,
            reason: 'INSUFFICIENT_COVERAGE',
            message: `${req.credentialType} coverage does not meet the required minimum.`,
            enforcement: req.enforcement,
            expiresAt: expiresAtIso,
            credentialId: best.id,
          });
          continue;
        }
      }

      satisfiedRequirements.push({
        requirementId: req.id,
        credentialType: req.credentialType,
        credentialId: best.id,
      });
    }

    return {
      contractorId,
      category,
      eligible: blockingIssues.length === 0,
      blockingIssues,
      warnings,
      satisfiedRequirements,
    };
  }

  async evaluate(
    organisationId: string,
    contractorId: string,
    category: MaintenanceCategory | null,
  ): Promise<EligibilityResult> {
    const contractor = await this.prisma.contractor.findFirst({
      where: { id: contractorId, organisationId },
      select: { id: true, tradeCategories: true },
    });
    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }

    if (!category) {
      return {
        contractorId,
        category: null,
        eligible: true,
        blockingIssues: [],
        warnings: [],
        satisfiedRequirements: [],
      };
    }

    const now = new Date();
    const requirements = await this.prisma.contractorComplianceRequirement.findMany({
      where: { organisationId, category },
    });
    // No configured requirements for this trade — existing assignment
    // behaviour must remain unchanged; skip the (otherwise pointless)
    // credentials fetch entirely.
    const credentials =
      requirements.length === 0
        ? []
        : await this.prisma.contractorCredential.findMany({ where: { contractorId } });

    return this.evaluateAgainstData(
      contractorId,
      category,
      contractor.tradeCategories,
      credentials,
      requirements,
      now,
    );
  }

  /** The contractor-profile-level "big picture" — compliance across every
   * trade the contractor is classified under, not one work order's
   * category. Used for the Contractor 360 compliance badge. Two queries
   * total regardless of how many trades the contractor is classified
   * under (previously one pair of queries per trade). */
  async getComplianceOverview(
    organisationId: string,
    contractorId: string,
  ): Promise<ContractorComplianceOverview> {
    const contractor = await this.prisma.contractor.findFirst({
      where: { id: contractorId, organisationId },
      select: { tradeCategories: true },
    });
    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }

    if (contractor.tradeCategories.length === 0) {
      return { status: 'COMPLIANT', byCategory: [], applicableRequirements: [] };
    }

    const now = new Date();
    const [requirements, credentials] = await Promise.all([
      this.prisma.contractorComplianceRequirement.findMany({
        where: { organisationId, category: { in: contractor.tradeCategories } },
      }),
      this.prisma.contractorCredential.findMany({ where: { contractorId } }),
    ]);

    const byCategory = contractor.tradeCategories.map((category) => ({
      category,
      result: this.evaluateAgainstData(
        contractorId,
        category,
        contractor.tradeCategories,
        credentials,
        requirements.filter((r) => r.category === category),
        now,
      ),
    }));

    const allIssues = byCategory.flatMap((c) => [...c.result.blockingIssues, ...c.result.warnings]);
    const applicableRequirements = buildApplicableRequirements(requirements, credentials, now);
    return { status: deriveOverviewStatus(allIssues), byCategory, applicableRequirements };
  }

  /** Batched equivalent of calling `getComplianceOverview` once per
   * contractor — built for list pages. Exactly two queries total
   * (requirements + credentials), regardless of how many contractors or
   * trade categories are involved, so a Contractors list page never
   * triggers an N+1. Returns a compact summary per contractor: the
   * overview status plus up to `LIST_TOP_ISSUES_LIMIT` of its most severe
   * real issues (never a fabricated score, never more than the row can
   * cleanly show). */
  async getComplianceSummaries(
    organisationId: string,
    contractors: Array<{ id: string; tradeCategories: MaintenanceCategory[] }>,
  ): Promise<Map<string, ContractorComplianceSummary>> {
    const summaries = new Map<string, ContractorComplianceSummary>();
    const contractorIds = contractors.map((c) => c.id);
    const categories = [...new Set(contractors.flatMap((c) => c.tradeCategories))];

    if (contractorIds.length === 0) {
      return summaries;
    }

    const [requirements, credentials] =
      categories.length === 0
        ? [[], []]
        : await Promise.all([
            this.prisma.contractorComplianceRequirement.findMany({
              where: { organisationId, category: { in: categories } },
            }),
            this.prisma.contractorCredential.findMany({
              where: { contractorId: { in: contractorIds } },
            }),
          ]);

    const requirementsByCategory = new Map<
      MaintenanceCategory,
      ContractorComplianceRequirement[]
    >();
    for (const req of requirements) {
      const list = requirementsByCategory.get(req.category) ?? [];
      list.push(req);
      requirementsByCategory.set(req.category, list);
    }
    const credentialsByContractor = new Map<string, ContractorCredential[]>();
    for (const cred of credentials) {
      const list = credentialsByContractor.get(cred.contractorId) ?? [];
      list.push(cred);
      credentialsByContractor.set(cred.contractorId, list);
    }

    const now = new Date();
    for (const contractor of contractors) {
      const ownCredentials = credentialsByContractor.get(contractor.id) ?? [];
      const results = contractor.tradeCategories.map((category) =>
        this.evaluateAgainstData(
          contractor.id,
          category,
          contractor.tradeCategories,
          ownCredentials,
          requirementsByCategory.get(category) ?? [],
          now,
        ),
      );
      const blockingIssues = results.flatMap((r) => r.blockingIssues);
      const warnings = results.flatMap((r) => r.warnings);
      const ranked = rankIssues(blockingIssues, warnings);

      summaries.set(contractor.id, {
        status: deriveOverviewStatus([...blockingIssues, ...warnings]),
        issueCount: ranked.length,
        topIssues: ranked
          .slice(0, LIST_TOP_ISSUES_LIMIT)
          .map((issue) => ({ message: issue.message, reason: issue.reason })),
      });
    }

    return summaries;
  }
}
