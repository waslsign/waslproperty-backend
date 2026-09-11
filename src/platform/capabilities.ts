import type { PlatformRole } from '@prisma/client';

/**
 * Every Backoffice capability, in one place. Controllers check these, never
 * `if (role === 'PLATFORM_SUPER_ADMIN')` — that keeps the privilege model
 * centrally auditable and lets a role's grants change without touching
 * route code.
 */
export const PLATFORM_CAPABILITIES = [
  'platform.dashboard.view',
  'organisations.view',
  'organisations.manage',
  'users.view',
  'users.manage',
  'properties.view',
  'properties.manage',
  'operations.view',
  'operations.manage',
  'communications.view',
  'communications.manage',
  'database.view',
  'database.edit',
  'database.sql.read',
  'database.sql.write',
  /** Governs unmasked PII specifically in raw SQL SELECT results — kept
   * separate from `pii.view` because arbitrary SQL is a strictly higher-risk
   * surface than a curated 360 view. See the M10.5 PII/raw-SQL design. */
  'database.sql.pii.unmasked',
  'audit.view',
  'jobs.view',
  'jobs.retry',
  'integrations.view',
  'platformUsers.manage',
  /** Unmasked PII in Organisation 360 / User 360 / search / Data Explorer.
   * Still further gated by the environment PII policy — holding this
   * capability is necessary but not sufficient in production. */
  'pii.view',
] as const;

export type PlatformCapability = (typeof PLATFORM_CAPABILITIES)[number];

const ALL: PlatformCapability[] = [...PLATFORM_CAPABILITIES];

export const PLATFORM_ROLE_CAPABILITIES: Record<PlatformRole, PlatformCapability[]> = {
  PLATFORM_SUPER_ADMIN: ALL,

  PLATFORM_ADMIN: [
    'platform.dashboard.view',
    'organisations.view',
    'organisations.manage',
    'users.view',
    'users.manage',
    'properties.view',
    'properties.manage',
    'operations.view',
    'operations.manage',
    'communications.view',
    'communications.manage',
    'database.view',
    'database.edit',
    'audit.view',
    'jobs.view',
    'jobs.retry',
    'integrations.view',
    'pii.view',
  ],

  PLATFORM_SUPPORT: [
    'platform.dashboard.view',
    'organisations.view',
    'users.view',
    'properties.view',
    'operations.view',
    'communications.view',
    'database.view',
    'audit.view',
    'jobs.view',
    'jobs.retry',
    'integrations.view',
  ],

  PLATFORM_DEVELOPER: [
    'platform.dashboard.view',
    'database.view',
    'database.sql.read',
    'jobs.view',
    'integrations.view',
    'audit.view',
  ],
};

export function resolvePlatformCapabilities(role: PlatformRole): PlatformCapability[] {
  return PLATFORM_ROLE_CAPABILITIES[role];
}
