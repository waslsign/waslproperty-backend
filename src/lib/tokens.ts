import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { OrgRole, PlatformRole } from '@prisma/client';

export interface AccessTokenPayload {
  sub: string;
  sessionType: 'CUSTOMER';
  organisationId: string;
  /** null for a resident session — see AuthService for the staff/resident distinction. */
  orgRole: OrgRole | null;
  /** Set only for a resident session (a User linked to a PropertyContact, not an OrganisationMembership). */
  propertyContactId?: string | null;
}

/**
 * A Backoffice session for a WaslProperty employee — never carries an
 * organisationId or orgRole. Capabilities are resolved once, at issue time,
 * from the central role->capability map (see src/platform/capabilities.ts)
 * and embedded here so the backend never has to re-derive them ad hoc per
 * request, while still checking them on every request.
 */
export interface PlatformAccessTokenPayload {
  sub: string;
  sessionType: 'PLATFORM';
  platformUserId: string;
  username: string;
  platformRole: PlatformRole;
  platformCapabilities: string[];
}

export type AnyAccessTokenPayload = AccessTokenPayload | PlatformAccessTokenPayload;

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function signPlatformAccessToken(payload: PlatformAccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

/**
 * Verifies the JWT signature only — does not assume either payload shape.
 * `authenticate` and `authenticatePlatform` each narrow by `sessionType`
 * and reject the shape they don't expect; this is what makes a customer
 * token unusable on `/backoffice/*` and a platform token unusable on every
 * existing customer route.
 */
export function verifyAnyAccessToken(token: string): AnyAccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as unknown as AnyAccessTokenPayload;
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = verifyAnyAccessToken(token);
  if (payload.sessionType !== 'CUSTOMER') {
    throw new Error('Not a customer session token');
  }
  return payload;
}

export function verifyPlatformAccessToken(token: string): PlatformAccessTokenPayload {
  const payload = verifyAnyAccessToken(token);
  if (payload.sessionType !== 'PLATFORM') {
    throw new Error('Not a platform session token');
  }
  return payload;
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
