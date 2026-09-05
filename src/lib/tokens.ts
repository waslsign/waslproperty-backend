import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { OrgRole } from '@prisma/client';

export interface AccessTokenPayload {
  sub: string;
  organisationId: string;
  /** null for a resident session — see AuthService for the staff/resident distinction. */
  orgRole: OrgRole | null;
  /** Set only for a resident session (a User linked to a PropertyContact, not an OrganisationMembership). */
  propertyContactId?: string | null;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as unknown as AccessTokenPayload;
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiresAt(): Date {
  const days = env.JWT_REFRESH_EXPIRES_IN_DAYS;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Raw invite tokens are only ever emailed to the resident and returned once
 * at issuance — only their sha256 hash is persisted (ContactInvite.tokenHash),
 * mirroring the refresh-token hashing above.
 */
export function generateInviteToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function inviteTokenExpiresAt(): Date {
  const hours = env.INVITE_TOKEN_EXPIRES_IN_HOURS;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}
