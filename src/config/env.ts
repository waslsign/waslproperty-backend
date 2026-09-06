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
  COOKIE_DOMAIN: z.string().default('localhost'),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  FRONTEND_URL: z.string().default('http://localhost:5174'),
  BACKEND_PUBLIC_URL: z.string().default('http://localhost:4100'),
  LOG_LEVEL: z.string().default('info'),

  INVITE_TOKEN_EXPIRES_IN_HOURS: z.coerce.number().default(72),

  AWS_REGION: z.string().min(1, 'AWS_REGION is required'),
  S3_BUCKET_NAME: z.string().min(1, 'S3_BUCKET_NAME is required'),
  MAINTENANCE_ATTACHMENT_MAX_FILES: z.coerce.number().default(5),
  MAINTENANCE_ATTACHMENT_MAX_SIZE_MB: z.coerce.number().default(10),

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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
