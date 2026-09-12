import type { Response } from 'express';
import { env } from '../config/env.js';

const REFRESH_COOKIE_NAME = 'wasl_property_refresh_token';

export function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    domain: env.COOKIE_DOMAIN || undefined,
    expires: expiresAt,
    path: '/api/v1/auth',
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    domain: env.COOKIE_DOMAIN || undefined,
    path: '/api/v1/auth',
  });
}

export function getRefreshCookie(cookies: Record<string, string | undefined>): string | undefined {
  return cookies[REFRESH_COOKIE_NAME];
}

// A separate cookie, on a separate path — a customer session's refresh
// cookie is never even sent to a Backoffice endpoint (and vice versa), by
// construction, not just by server-side rejection.
const PLATFORM_REFRESH_COOKIE_NAME = 'wasl_property_platform_refresh_token';
const PLATFORM_REFRESH_COOKIE_PATH = '/api/v1/backoffice/auth';

export function setPlatformRefreshCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(PLATFORM_REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    domain: env.COOKIE_DOMAIN || undefined,
    expires: expiresAt,
    path: PLATFORM_REFRESH_COOKIE_PATH,
  });
}

export function clearPlatformRefreshCookie(res: Response) {
  res.clearCookie(PLATFORM_REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    domain: env.COOKIE_DOMAIN || undefined,
    path: PLATFORM_REFRESH_COOKIE_PATH,
  });
}

export function getPlatformRefreshCookie(
  cookies: Record<string, string | undefined>,
): string | undefined {
  return cookies[PLATFORM_REFRESH_COOKIE_NAME];
}
