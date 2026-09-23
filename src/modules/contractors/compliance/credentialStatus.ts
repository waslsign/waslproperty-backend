import type { CredentialVerificationStatus } from '@prisma/client';
import { env } from '../../../config/env.js';

/**
 * The single source of truth for "what state is this credential actually
 * in right now" — always derived from (verificationStatus, expiresAt) at
 * read time, never stored. A credential row never has its own status
 * column beyond verificationStatus; CURRENT/EXPIRING_SOON/EXPIRED exist
 * only as a function of the clock, so they can never drift out of sync
 * with it (no background job needs to "update" a credential when it
 * expires — the very next read already reflects it).
 */
export type CredentialEffectiveStatus =
  'CURRENT' | 'EXPIRING_SOON' | 'EXPIRED' | 'PENDING' | 'REJECTED';

export function deriveCredentialStatus(
  credential: { verificationStatus: CredentialVerificationStatus; expiresAt: Date | null },
  now: Date,
  expiringSoonDays: number = env.CREDENTIAL_EXPIRING_SOON_DAYS,
): CredentialEffectiveStatus {
  if (credential.verificationStatus === 'REJECTED') return 'REJECTED';

  // Expiry is an objective date fact, independent of whether staff have
  // verified the document — an expired policy is invalid regardless of
  // verification state, so this check applies even to a still-PENDING
  // credential. Checked before the PENDING branch below.
  if (credential.expiresAt && credential.expiresAt.getTime() <= now.getTime()) {
    return 'EXPIRED';
  }

  if (credential.verificationStatus === 'PENDING') return 'PENDING';

  // VERIFIED, not expired, from here on.
  if (!credential.expiresAt) return 'CURRENT';

  const warnAt = new Date(now.getTime() + expiringSoonDays * 24 * 60 * 60 * 1000);
  if (credential.expiresAt.getTime() <= warnAt.getTime()) return 'EXPIRING_SOON';
  return 'CURRENT';
}
