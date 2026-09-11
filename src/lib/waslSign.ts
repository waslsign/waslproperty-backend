import { env } from '../config/env.js';
import { logger } from './logger.js';

export class WaslSignServiceError extends Error {
  readonly code: 'UNAVAILABLE' | 'TIMEOUT' | 'MALFORMED_RESPONSE' | 'REQUEST_FAILED';

  constructor(code: WaslSignServiceError['code'], message: string) {
    super(message);
    this.name = 'WaslSignServiceError';
    this.code = code;
  }
}

export interface WaslSignSigner {
  name: string;
  email: string;
  role?: string;
  signingOrder: number;
  /** Where this signer's field sits on the document — normalized (0-1),
   * top-left origin. Omit only if the document has no fixed layout for it;
   * WaslSign falls back to a generic stacked position in that case, which
   * won't line up with anything drawn on the page. */
  field?: { page: number; x: number; y: number; width: number; height: number };
}

export interface CreateAgreementWorkflowInput {
  waslSignOrganisationId: string;
  sourceEntityId: string;
  title: string;
  description?: string;
  signers: WaslSignSigner[];
  documentBase64: string;
  /** Shown to the first recipient as "X sent you a document to review and
   * sign" — omit to fall back to WaslSign's own internal integration-user
   * address, which reads oddly to an actual human recipient. */
  senderDisplayName?: string;
}

export interface CreateAgreementWorkflowResult {
  agreementId: string;
  status: string;
  created: boolean;
}

export interface WaslSignRecipientStatus {
  name: string;
  email: string;
  role: string | null;
  order: number;
  status: string;
  signedAt: string | null;
}

export interface WaslSignWorkflowStatus {
  id: string;
  status: string;
  recipients: WaslSignRecipientStatus[];
  finalUrl: string | null;
}

const REQUEST_TIMEOUT_MS = 10_000;
const SOURCE_SYSTEM = 'wasl-property';

/**
 * Wraps WaslSign's /integrations/v1 API — the only thing Wasl Property is
 * allowed to know about WaslSign (see the M9-A architecture boundary: no
 * direct DB access, no DocuSeal knowledge, no scattered HTTP calls in
 * domain code). Every call goes through here.
 *
 * `isConfigured()` reflects whether WASLSIGN_* env vars are present — an
 * environment without them simply can't offer SIGNATURE_ONLY /
 * APPROVAL_THEN_SIGNATURE; callers must check it and fail closed rather
 * than let a request hang against an empty base URL.
 */
export class WaslSignService {
  private tokenCache: { token: string; expiresAt: number } | undefined;

  isConfigured(): boolean {
    return Boolean(
      env.WASLSIGN_API_BASE_URL &&
      env.WASLSIGN_SERVICE_CLIENT_ID &&
      env.WASLSIGN_SERVICE_CLIENT_SECRET,
    );
  }

  private async request<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
    if (!env.WASLSIGN_API_BASE_URL) {
      throw new WaslSignServiceError('UNAVAILABLE', 'WaslSign integration is not configured');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    };

    if (init.auth !== false) {
      const token = await this.getServiceToken();
      headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${env.WASLSIGN_API_BASE_URL}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new WaslSignServiceError('TIMEOUT', 'WaslSign request timed out');
      }
      throw new WaslSignServiceError('UNAVAILABLE', 'WaslSign is unreachable');
    } finally {
      clearTimeout(timeout);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new WaslSignServiceError('MALFORMED_RESPONSE', 'WaslSign returned a non-JSON response');
    }

    if (!response.ok) {
      const message =
        body &&
        typeof body === 'object' &&
        'message' in body &&
        typeof (body as { message: unknown }).message === 'string'
          ? (body as { message: string }).message
          : 'Request failed';
      logger.warn({ path, statusCode: response.status, message }, 'WaslSign request failed');
      throw new WaslSignServiceError('REQUEST_FAILED', message);
    }

    return body as T;
  }

  private async getServiceToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 5_000) {
      return this.tokenCache.token;
    }

    const result = await this.request<{ accessToken: string; expiresIn: string }>(
      '/integrations/v1/auth/token',
      {
        method: 'POST',
        auth: false,
        body: JSON.stringify({
          clientId: env.WASLSIGN_SERVICE_CLIENT_ID,
          clientSecret: env.WASLSIGN_SERVICE_CLIENT_SECRET,
        }),
      },
    );

    const ttlMs = parseExpiresIn(result.expiresIn);
    this.tokenCache = { token: result.accessToken, expiresAt: Date.now() + ttlMs };
    return result.accessToken;
  }

  /** Idempotent — provisions once per (Wasl Property) organisation, on first need. */
  async provisionOrganisation(organisationId: string, name: string): Promise<string> {
    const result = await this.request<{ organizationId: number }>(
      '/integrations/v1/organizations',
      {
        method: 'POST',
        body: JSON.stringify({ name, externalRef: organisationId }),
      },
    );
    return String(result.organizationId);
  }

  async createAgreementWorkflow(
    input: CreateAgreementWorkflowInput,
  ): Promise<CreateAgreementWorkflowResult> {
    const callbackUrl = `${env.BACKEND_PUBLIC_URL}/api/v1/integrations/waslsign/callback`;
    const result = await this.request<{ agreementId: number; status: string; created: boolean }>(
      '/integrations/v1/agreements',
      {
        method: 'POST',
        body: JSON.stringify({
          organizationId: Number(input.waslSignOrganisationId),
          sourceSystem: SOURCE_SYSTEM,
          sourceEntityId: input.sourceEntityId,
          title: input.title,
          description: input.description,
          recipients: input.signers.map((s) => ({
            name: s.name,
            email: s.email,
            role: s.role,
            signingOrder: s.signingOrder,
            field: s.field,
          })),
          documentBase64: input.documentBase64,
          webhookUrl: callbackUrl,
          senderDisplayName: input.senderDisplayName,
        }),
      },
    );
    return {
      agreementId: String(result.agreementId),
      status: result.status,
      created: result.created,
    };
  }

  async getWorkflowStatus(waslSignAgreementId: string): Promise<WaslSignWorkflowStatus> {
    const result = await this.request<{
      id: number;
      status: string;
      recipients: WaslSignRecipientStatus[];
      finalUrl: string | null;
    }>(`/integrations/v1/agreements/${waslSignAgreementId}`, { method: 'GET' });
    return {
      id: String(result.id),
      status: result.status,
      recipients: result.recipients,
      finalUrl: result.finalUrl,
    };
  }

  async cancelWorkflow(waslSignAgreementId: string, reason?: string): Promise<void> {
    await this.request(`/integrations/v1/agreements/${waslSignAgreementId}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }
}

function parseExpiresIn(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) return 5 * 60 * 1000;
  const amount = Number(match[1]);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[
    match[2] as 's' | 'm' | 'h' | 'd'
  ];
  return amount * unitMs;
}

export const waslSignService = new WaslSignService();
