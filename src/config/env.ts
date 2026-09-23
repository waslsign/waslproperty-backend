import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4100),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET is required'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
  JWT_REFRESH_EXPIRES_IN_DAYS: z.coerce.number().default(30),
  // Empty string means "omit the Domain attribute" (host-only cookie) — see
  // setRefreshCookie in lib/cookies.ts. Required when the frontend and
  // backend are on different registrable domains (e.g. two separate
  // *.onrender.com services), where a shared Domain attribute is neither
  // valid nor desired.
  COOKIE_DOMAIN: z.string().default('localhost'),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // 'none' is required (together with COOKIE_SECURE=true) for the refresh
  // cookie to be sent on cross-site requests — e.g. a frontend and backend
  // deployed as separate Render services. Left at the 'lax' default
  // everywhere frontend and backend share a site (local dev, and any
  // same-registrable-domain production setup).
  COOKIE_SAME_SITE: z.enum(['lax', 'none', 'strict']).default('lax'),
  // Comma-separated for staging/prod, where more than one origin (e.g. a
  // local dev frontend and a deployed one) may need to call the same
  // backend. A single value works exactly as before.
  FRONTEND_URL: z.string().default('http://localhost:5174'),
  BACKEND_PUBLIC_URL: z.string().default('http://localhost:4100'),
  LOG_LEVEL: z.string().default('info'),

  INVITE_TOKEN_EXPIRES_IN_HOURS: z.coerce.number().default(72),

  AWS_REGION: z.string().min(1, 'AWS_REGION is required'),
  S3_BUCKET_NAME: z.string().min(1, 'S3_BUCKET_NAME is required'),
  MAINTENANCE_ATTACHMENT_MAX_FILES: z.coerce.number().default(5),
  MAINTENANCE_ATTACHMENT_MAX_SIZE_MB: z.coerce.number().default(10),
  // Credential evidence (licence scans, Certificates of Currency, ...) — a
  // separate limit from maintenance photos since these are commonly
  // multi-page PDF scans, not single photos.
  CREDENTIAL_DOCUMENT_MAX_SIZE_MB: z.coerce.number().default(15),
  // Days out from expiry a VERIFIED credential is considered
  // EXPIRING_SOON rather than CURRENT — a sensible central default, not
  // organisation-configurable this milestone (see the compliance
  // milestone report).
  CREDENTIAL_EXPIRING_SOON_DAYS: z.coerce.number().default(30),

  // --- Outbound email ---
  // RESEND_API_KEY is the production/staging transport (Resend's HTTPS
  // API) — required anywhere the platform blocks outbound SMTP ports (e.g.
  // Render's Free Web Service tier blocks 25/465/587 entirely, so SMTP is
  // a hard outage there regardless of which mail provider is behind it).
  // Left unset, EmailService falls back to SMTP, which only ever makes
  // sense in local development. See src/lib/email/selectEmailProvider.ts.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Wasl Property <no-reply@waslproperty.dev>'),

  // SMTP: local-development-only fallback transport (see
  // SmtpEmailProvider). Leave SMTP_HOST unset in development to use an
  // ad-hoc Ethereal test inbox instead of a real mailbox.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('Wasl Property <no-reply@waslproperty.dev>'),

  // --- WaslSign integration (M9-A) ---
  // Optional: an environment with none of these set simply can't offer
  // SIGNATURE_ONLY / APPROVAL_THEN_SIGNATURE — WaslSignService treats that
  // as "unavailable", never as a hard startup failure.
  WASLSIGN_API_BASE_URL: z.string().optional(),
  WASLSIGN_SERVICE_CLIENT_ID: z.string().optional(),
  WASLSIGN_SERVICE_CLIENT_SECRET: z.string().optional(),
  WASLSIGN_WEBHOOK_SECRET: z.string().optional(),

  WORK_ORDER_WASLSIGN_THRESHOLD_AED: z.coerce.number().default(5000),
  WORK_ORDER_DEFAULT_WORKFLOW_MODE: z
    .enum(['APPROVAL_ONLY', 'SIGNATURE_ONLY', 'APPROVAL_THEN_SIGNATURE'])
    .default('APPROVAL_ONLY'),

  // --- Backoffice / Platform Operations (M10.5) ---
  // Every one of these defaults to the safe/disabled state when absent —
  // production is never accidentally opened up just because a var wasn't
  // set. See src/platform/privacy-policy.ts for how NODE_ENV interacts
  // with BACKOFFICE_PII_MODE (the mode itself isn't a plain default here
  // because "masked in production unless explicitly overridden" depends on
  // NODE_ENV too, not just this one var in isolation).
  BACKOFFICE_PII_MODE: z.enum(['masked', 'full']).optional(),
  BACKOFFICE_RAW_SQL_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  BACKOFFICE_RAW_SQL_WRITE_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  BACKOFFICE_RAW_SQL_UNMASKED_PII_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  BACKOFFICE_SQL_MAX_UPDATE_ROWS: z.coerce.number().default(500),
  BACKOFFICE_SQL_RESULT_ROW_LIMIT: z.coerce.number().default(500),
  BACKOFFICE_SQL_STATEMENT_TIMEOUT_MS: z.coerce.number().default(5000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
