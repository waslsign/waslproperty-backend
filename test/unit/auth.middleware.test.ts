import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requireOrgRole } from '../../src/middlewares/auth.middleware.js';
import { ForbiddenError, UnauthorizedError } from '../../src/errors/AppError.js';

function mockReq(auth?: { orgRole: 'OWNER' | 'ADMIN' | 'MEMBER' }): Request {
  return { auth: auth ? { userId: 'u1', organisationId: 'o1', ...auth } : undefined } as Request;
}

describe('requireOrgRole', () => {
  it('calls next when the role is allowed', () => {
    const next = vi.fn();
    requireOrgRole(['OWNER', 'ADMIN'])(mockReq({ orgRole: 'OWNER' }), {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('throws ForbiddenError when the role is not allowed', () => {
    expect(() =>
      requireOrgRole(['OWNER'])(mockReq({ orgRole: 'MEMBER' }), {} as Response, vi.fn()),
    ).toThrow(ForbiddenError);
  });

  it('throws UnauthorizedError when there is no auth context', () => {
    expect(() => requireOrgRole(['OWNER'])(mockReq(), {} as Response, vi.fn())).toThrow(
      UnauthorizedError,
    );
  });
});
