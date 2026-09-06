import type { ApprovalStatus, SignatureStatus, WorkflowMode } from '@prisma/client';

/**
 * The one normalized result Wasl Property actually needs to make an
 * operational decision ("can this work order proceed?"), derived — never
 * stored — from (workflowMode, approvalStatus, signatureStatus). Keeping it
 * derived means the two underlying statuses can never drift out of sync
 * with the summary a manager sees.
 *
 * NOT_REQUIRED: workflowMode is NONE (or unset) — nothing to wait for.
 * PENDING: still waiting on approval and/or signature.
 * COMPLETED: every required stage passed — the work order may proceed.
 * REJECTED: an approval step was explicitly rejected.
 * FAILED: a signature step was declined or expired (distinct from REJECTED
 *   — nobody made an approve/reject decision, the document simply never
 *   got signed).
 * CANCELLED: the workflow itself was withdrawn (e.g. quote superseded).
 */
export type WorkflowResult =
  'NOT_REQUIRED' | 'PENDING' | 'COMPLETED' | 'REJECTED' | 'FAILED' | 'CANCELLED';

export function deriveWorkflowResult(
  workflowMode: WorkflowMode | null,
  approvalStatus: ApprovalStatus | null,
  signatureStatus: SignatureStatus | null,
): WorkflowResult {
  if (!workflowMode || workflowMode === 'NONE') return 'NOT_REQUIRED';

  if (workflowMode === 'APPROVAL_ONLY') {
    if (approvalStatus === 'APPROVED') return 'COMPLETED';
    if (approvalStatus === 'REJECTED') return 'REJECTED';
    if (approvalStatus === 'CANCELLED') return 'CANCELLED';
    return 'PENDING';
  }

  if (workflowMode === 'SIGNATURE_ONLY') {
    return signatureResult(signatureStatus);
  }

  // APPROVAL_THEN_SIGNATURE — signature stage is never even consulted until
  // approval has actually passed.
  if (approvalStatus === 'REJECTED') return 'REJECTED';
  if (approvalStatus === 'CANCELLED') return 'CANCELLED';
  if (approvalStatus !== 'APPROVED') return 'PENDING';
  return signatureResult(signatureStatus);
}

function signatureResult(signatureStatus: SignatureStatus | null): WorkflowResult {
  switch (signatureStatus) {
    case 'SIGNED':
      return 'COMPLETED';
    case 'DECLINED':
    case 'EXPIRED':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return 'PENDING';
  }
}

/** A work order may only leave DRAFT once its governing quote's workflow (if any) has actually completed. */
export function canReleaseWorkOrder(workflowResult: WorkflowResult): boolean {
  return workflowResult === 'NOT_REQUIRED' || workflowResult === 'COMPLETED';
}
