import type { Prisma, PrismaClient } from '@prisma/client';
import { recordActivity } from '../activity/activity.js';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { generateQuoteAcceptanceDocument } from '../../lib/quoteAcceptanceDocument.js';
import { waslSignService, WaslSignServiceError } from '../../lib/waslSign.js';
import { notifyOrgStaff } from '../notifications/notifications.js';
import { WorkOrdersService } from '../work-orders/work-orders.service.js';
import type {
  CreateQuoteInput,
  RejectQuoteInput,
  SetWorkflowModeInput,
  SubmitQuoteInput,
} from './quotes.schemas.js';

const quoteInclude = {
  contractor: { select: { id: true, name: true, companyName: true, email: true } },
  workOrder: {
    select: {
      id: true,
      title: true,
      organisationId: true,
      maintenanceRequestId: true,
      property: { select: { id: true, name: true } },
      space: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.ContractorQuoteInclude;

export class QuotesService {
  private readonly workOrdersService: WorkOrdersService;

  constructor(private readonly prisma: PrismaClient) {
    this.workOrdersService = new WorkOrdersService(prisma);
  }

  /**
   * The DRAFT → READY step isn't really a manager decision — it's just
   * reflecting that the required workflow finished. Advance it the moment
   * that becomes true, rather than making the manager click "Update status"
   * purely to acknowledge something that already happened. Scheduling,
   * starting, and completing stay genuinely manual (see M7's Work Order
   * Release rule). Best-effort: if the work order already moved on or isn't
   * actually eligible yet, this silently no-ops rather than surfacing an
   * error the caller has no reason to handle.
   */
  private async maybeReleaseWorkOrder(
    organisationId: string,
    workOrderId: string,
    actorUserId: string | null,
  ) {
    try {
      await this.workOrdersService.updateStatus(organisationId, actorUserId, workOrderId, {
        status: 'READY',
      });
    } catch (err) {
      if (err instanceof ConflictError) return;
      throw err;
    }
  }

  private defaultWorkflowMode(
    amount: number,
  ): 'NONE' | 'APPROVAL_ONLY' | 'SIGNATURE_ONLY' | 'APPROVAL_THEN_SIGNATURE' {
    return amount >= env.WORK_ORDER_WASLSIGN_THRESHOLD_AED
      ? env.WORK_ORDER_DEFAULT_WORKFLOW_MODE
      : 'NONE';
  }

  private async getOwnedQuote(organisationId: string, quoteId: string) {
    const quote = await this.prisma.contractorQuote.findFirst({
      where: { id: quoteId, organisationId },
      include: quoteInclude,
    });
    if (!quote) {
      throw new NotFoundError('Quote not found');
    }
    return quote;
  }

  async create(organisationId: string, input: CreateQuoteInput) {
    const workOrder = await this.prisma.workOrder.findFirst({
      where: { id: input.workOrderId, organisationId },
    });
    if (!workOrder) {
      throw new NotFoundError('Work order not found');
    }

    const contractor = await this.prisma.contractor.findFirst({
      where: { id: input.contractorId, organisationId, status: 'ACTIVE' },
    });
    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }

    return this.prisma.contractorQuote.create({
      data: {
        organisationId,
        workOrderId: input.workOrderId,
        contractorId: input.contractorId,
        amount: input.amount,
        currency: input.currency,
        description: input.description,
        status: 'REQUESTED',
        workflowMode: this.defaultWorkflowMode(input.amount),
      },
      include: quoteInclude,
    });
  }

  async getById(organisationId: string, quoteId: string) {
    return this.getOwnedQuote(organisationId, quoteId);
  }

  async submit(
    organisationId: string,
    actorUserId: string,
    quoteId: string,
    input: SubmitQuoteInput,
  ) {
    const quote = await this.getOwnedQuote(organisationId, quoteId);
    if (quote.status !== 'REQUESTED') {
      throw new ConflictError(`Cannot submit a quote in ${quote.status} status`);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contractorQuote.update({
        where: { id: quoteId },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
          amount: input.amount ?? undefined,
          description: input.description ?? undefined,
          workflowMode:
            input.amount !== undefined ? this.defaultWorkflowMode(input.amount) : undefined,
        },
        include: quoteInclude,
      });

      await recordActivity(tx, {
        organisationId,
        propertyId: quote.workOrder.property.id,
        spaceId: quote.workOrder.space?.id ?? null,
        actorUserId,
        eventType: 'QUOTE_SUBMITTED',
        entityType: 'WorkOrder',
        entityId: quote.workOrder.id,
        title: `Quote submitted by ${quote.contractor.name}`,
        description: `${updated.amount} ${updated.currency} · ${quote.workOrder.title}`,
      });

      await notifyOrgStaff(
        tx,
        organisationId,
        {
          title: `Quote submitted for ${quote.workOrder.title}`,
          body: `${quote.contractor.name} · needs review`,
          entityType: 'WorkOrder',
          entityId: quote.workOrder.id,
        },
        { excludeUserId: actorUserId },
      );

      return updated;
    });
  }

  /**
   * Sets the business-process choice for this quote. APPROVAL_ONLY just
   * opens the native approval step (no WaslSign call at all). SIGNATURE_ONLY
   * starts the WaslSign signature workflow immediately. APPROVAL_THEN_SIGNATURE
   * opens the native approval step only — signature starts automatically
   * once (and only if) that approval passes, see approve().
   */
  async setWorkflowMode(
    organisationId: string,
    actorUserId: string,
    quoteId: string,
    input: SetWorkflowModeInput,
  ) {
    const quote = await this.getOwnedQuote(organisationId, quoteId);
    if (quote.status === 'APPROVED' || quote.status === 'REJECTED') {
      throw new ConflictError(
        `Cannot change the workflow for a quote already ${quote.status.toLowerCase()}`,
      );
    }

    if (
      input.workflowMode === 'APPROVAL_ONLY' ||
      input.workflowMode === 'APPROVAL_THEN_SIGNATURE'
    ) {
      return this.prisma.contractorQuote.update({
        where: { id: quoteId },
        data: {
          workflowMode: input.workflowMode,
          approvalStatus: 'PENDING',
          status: 'UNDER_REVIEW',
        },
        include: quoteInclude,
      });
    }

    // SIGNATURE_ONLY — start the WaslSign workflow right away.
    return this.startSignatureWorkflow(organisationId, actorUserId, quote, input.workflowMode);
  }

  async approve(organisationId: string, actorUserId: string, quoteId: string) {
    const quote = await this.getOwnedQuote(organisationId, quoteId);
    if (
      quote.workflowMode !== 'APPROVAL_ONLY' &&
      quote.workflowMode !== 'APPROVAL_THEN_SIGNATURE'
    ) {
      throw new ConflictError('This quote does not require approval');
    }
    if (quote.approvalStatus !== 'PENDING') {
      throw new ConflictError(
        `Approval already ${quote.approvalStatus?.toLowerCase() ?? 'resolved'}`,
      );
    }

    const approved = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.contractorQuote.update({
        where: { id: quoteId },
        data: {
          approvalStatus: 'APPROVED',
          approvedByUserId: actorUserId,
          approvedAt: new Date(),
          status: quote.workflowMode === 'APPROVAL_ONLY' ? 'APPROVED' : 'UNDER_REVIEW',
        },
        include: quoteInclude,
      });

      await recordActivity(tx, {
        organisationId,
        propertyId: quote.workOrder.property.id,
        spaceId: quote.workOrder.space?.id ?? null,
        actorUserId,
        eventType: 'QUOTE_APPROVED',
        entityType: 'WorkOrder',
        entityId: quote.workOrder.id,
        title: `Quote approved: ${quote.workOrder.title}`,
        description: `${quote.amount} ${quote.currency} · ${quote.contractor.name}`,
      });

      await notifyOrgStaff(
        tx,
        organisationId,
        {
          title: `Quote approved for ${quote.workOrder.title}`,
          body: quote.contractor.name,
          entityType: 'WorkOrder',
          entityId: quote.workOrder.id,
        },
        { excludeUserId: actorUserId },
      );

      return updated;
    });

    if (quote.workflowMode === 'APPROVAL_ONLY') {
      await this.maybeReleaseWorkOrder(organisationId, quote.workOrder.id, actorUserId);
      return approved;
    }

    // APPROVAL_THEN_SIGNATURE — the signature phase only ever starts here,
    // never before approval, and never if approval was rejected instead.
    return this.startSignatureWorkflow(
      organisationId,
      actorUserId,
      approved,
      'APPROVAL_THEN_SIGNATURE',
    );
  }

  async reject(
    organisationId: string,
    actorUserId: string,
    quoteId: string,
    input: RejectQuoteInput,
  ) {
    const quote = await this.getOwnedQuote(organisationId, quoteId);
    if (
      quote.workflowMode !== 'APPROVAL_ONLY' &&
      quote.workflowMode !== 'APPROVAL_THEN_SIGNATURE'
    ) {
      throw new ConflictError('This quote does not require approval');
    }
    if (quote.approvalStatus !== 'PENDING') {
      throw new ConflictError(
        `Approval already ${quote.approvalStatus?.toLowerCase() ?? 'resolved'}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contractorQuote.update({
        where: { id: quoteId },
        data: { approvalStatus: 'REJECTED', rejectedAt: new Date(), status: 'REJECTED' },
        include: quoteInclude,
      });

      await recordActivity(tx, {
        organisationId,
        propertyId: quote.workOrder.property.id,
        spaceId: quote.workOrder.space?.id ?? null,
        actorUserId,
        eventType: 'QUOTE_REJECTED',
        entityType: 'WorkOrder',
        entityId: quote.workOrder.id,
        title: `Quote rejected: ${quote.workOrder.title}`,
        description: input.reason ?? `${quote.amount} ${quote.currency} · ${quote.contractor.name}`,
      });

      await notifyOrgStaff(
        tx,
        organisationId,
        {
          title: `Quote rejected for ${quote.workOrder.title}`,
          body: quote.contractor.name,
          entityType: 'WorkOrder',
          entityId: quote.workOrder.id,
        },
        { excludeUserId: actorUserId },
      );

      return updated;
    });
  }

  private async startSignatureWorkflow(
    organisationId: string,
    actorUserId: string,
    quote: Prisma.ContractorQuoteGetPayload<{ include: typeof quoteInclude }>,
    workflowMode: 'SIGNATURE_ONLY' | 'APPROVAL_THEN_SIGNATURE',
  ) {
    if (!waslSignService.isConfigured()) {
      throw new ConflictError(
        'Signature workflow is not available: WaslSign integration is not configured',
      );
    }

    const organisation = await this.prisma.organisation.findUniqueOrThrow({
      where: { id: organisationId },
    });
    // The authorised signatory is the real manager who confirmed this
    // workflow — a synthetic address here would mean WaslSign faithfully
    // emails a signing link to an inbox that can never exist.
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: actorUserId } });
    let waslSignOrganisationId = organisation.waslSignOrganisationId;

    try {
      if (!waslSignOrganisationId) {
        waslSignOrganisationId = await waslSignService.provisionOrganisation(
          organisationId,
          organisation.name,
        );
        await this.prisma.organisation.update({
          where: { id: organisationId },
          data: { waslSignOrganisationId },
        });
      }

      const { bytes: documentBytes, signatureFields } = await generateQuoteAcceptanceDocument({
        organisationName: organisation.name,
        propertyName: quote.workOrder.property.name,
        spaceName: quote.workOrder.space?.name,
        workOrderTitle: quote.workOrder.title,
        workOrderId: quote.workOrder.id,
        maintenanceRequestId: quote.workOrder.maintenanceRequestId,
        contractorName: quote.contractor.name,
        scopeOfWork: quote.description ?? quote.workOrder.title,
        amount: quote.amount.toString(),
        currency: quote.currency,
      });

      const result = await waslSignService.createAgreementWorkflow({
        waslSignOrganisationId,
        sourceEntityId: quote.id,
        title: `${quote.workOrder.title} — Acceptance`,
        description: quote.description ?? undefined,
        signers: [
          {
            name: `${actor.firstName} ${actor.lastName} (Authorised Signatory)`,
            email: actor.email,
            signingOrder: 1,
            field: signatureFields[0],
          },
          {
            name: quote.contractor.name,
            email: quote.contractor.email,
            signingOrder: 2,
            field: signatureFields[1],
          },
        ],
        documentBase64: Buffer.from(documentBytes).toString('base64'),
        senderDisplayName: organisation.name,
      });

      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.contractorQuote.update({
          where: { id: quote.id },
          data: {
            workflowMode,
            signatureStatus: 'PENDING',
            waslSignAgreementId: result.agreementId,
            waslSignStatus: result.status,
            status: 'UNDER_REVIEW',
          },
          include: quoteInclude,
        });

        await recordActivity(tx, {
          organisationId,
          propertyId: quote.workOrder.property.id,
          spaceId: quote.workOrder.space?.id ?? null,
          actorUserId,
          eventType: 'QUOTE_SIGNING_STARTED',
          entityType: 'WorkOrder',
          entityId: quote.workOrder.id,
          title: `Signing started: ${quote.workOrder.title}`,
          description: `${quote.amount} ${quote.currency} · ${quote.contractor.name}`,
        });

        return updated;
      });
    } catch (err) {
      if (err instanceof WaslSignServiceError) {
        logger.error({ err, quoteId: quote.id }, 'Failed to start WaslSign workflow');
        throw new ConflictError(`Could not start the signature workflow: ${err.message}`);
      }
      throw err;
    }
  }

  /** Idempotent — a duplicate eventId is a guaranteed no-op (see the unique constraint on WaslSignWebhookEvent.eventId). */
  async handleWaslSignCallback(payload: {
    eventId: string;
    eventType: string;
    sourceEntityId: string;
    waslSignAgreementId: string;
  }) {
    try {
      await this.prisma.waslSignWebhookEvent.create({
        data: { eventId: payload.eventId, payload: payload as unknown as Prisma.InputJsonValue },
      });
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        logger.info({ eventId: payload.eventId }, 'Duplicate WaslSign webhook event ignored');
        return { handled: false, reason: 'duplicate' as const };
      }
      throw err;
    }

    const quote = await this.prisma.contractorQuote.findFirst({
      where: { id: payload.sourceEntityId },
      include: quoteInclude,
    });
    if (!quote) {
      logger.warn({ payload }, 'WaslSign callback for unknown quote — ignored');
      return { handled: false, reason: 'unknown_quote' as const };
    }
    if (quote.waslSignAgreementId !== payload.waslSignAgreementId) {
      logger.warn(
        { payload, quoteId: quote.id },
        'WaslSign callback agreement id mismatch — ignored',
      );
      return { handled: false, reason: 'agreement_mismatch' as const };
    }

    const signatureStatus = mapSignatureEvent(payload.eventType);
    if (!signatureStatus) {
      return { handled: false, reason: 'unrecognised_event' as const };
    }
    if (quote.signatureStatus === signatureStatus) {
      // Nothing actually changed (e.g. WaslSign's SIGNED and
      // WORKFLOW_COMPLETED events both land here) — no duplicate activity.
      return { handled: true as const, reason: 'no_change' as const };
    }

    const nowCompleting = signatureStatus === 'SIGNED';
    await this.prisma.$transaction(async (tx) => {
      await tx.contractorQuote.update({
        where: { id: quote.id },
        data: {
          signatureStatus,
          signedAt: nowCompleting ? new Date() : quote.signedAt,
          status: nowCompleting ? 'APPROVED' : quote.status,
        },
      });

      await recordActivity(tx, {
        organisationId: quote.organisationId,
        propertyId: quote.workOrder.property.id,
        spaceId: quote.workOrder.space?.id ?? null,
        eventType: nowCompleting ? 'QUOTE_SIGNED' : 'QUOTE_SUBMITTED',
        entityType: 'WorkOrder',
        entityId: quote.workOrder.id,
        title: nowCompleting
          ? `Agreement signed: ${quote.workOrder.title}`
          : `Signature update: ${quote.workOrder.title}`,
        description: `Status: ${signatureStatus}`,
      });

      if (nowCompleting) {
        await notifyOrgStaff(tx, quote.organisationId, {
          title: `Signature completed for ${quote.workOrder.title}`,
          body: quote.contractor.name,
          entityType: 'WorkOrder',
          entityId: quote.workOrder.id,
        });
      }
    });

    if (nowCompleting) {
      // No human actor for a webhook-driven completion — signer identities
      // are recorded in WaslSign's own audit trail, not duplicated here.
      await this.maybeReleaseWorkOrder(quote.organisationId, quote.workOrder.id, null);
    }

    return { handled: true as const };
  }
}

function mapSignatureEvent(eventType: string) {
  switch (eventType) {
    case 'SIGNATURE_PENDING':
      return 'PENDING' as const;
    case 'PARTIALLY_SIGNED':
      return 'PARTIALLY_SIGNED' as const;
    case 'SIGNED':
    case 'WORKFLOW_COMPLETED':
      return 'SIGNED' as const;
    case 'WORKFLOW_CANCELLED':
      return 'CANCELLED' as const;
    case 'DECLINED':
      return 'DECLINED' as const;
    case 'EXPIRED':
      return 'EXPIRED' as const;
    default:
      return null;
  }
}
