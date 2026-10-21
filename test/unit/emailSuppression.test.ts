import { describe, expect, it, vi } from 'vitest';
import { emailService } from '../../src/lib/email.js';

/**
 * Layer 1 of outbound-email safety: every existing test file that
 * exercises a real send path (invites.test.ts, communications.test.ts,
 * multi-org-access.test.ts) declares exactly this same
 * `vi.mock('../../src/lib/email.js', ...)` pattern. This file proves that
 * pattern itself is sound — a STATIC import of `emailService` (the same
 * shape every real caller uses) resolves to the mock, not a real
 * transport, and no network call is ever made.
 *
 * See emailSuppressionReal.test.ts for layer 2 — the EMAIL_SEND_DISABLED
 * kill switch that protects a real (non-test) dev-server process, where
 * this file's mock does not apply at all.
 */
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn().mockResolvedValue({}) }));

vi.mock('../../src/lib/email.js', () => ({
  emailService: { send: sendMock },
}));

describe('outbound email suppression — layer 1 (test-time mock)', () => {
  it('a normal import of emailService is the test mock, not a real transport', async () => {
    const result = await emailService.send({
      to: 'should-never-receive-this@example.com',
      subject: 'Suppression test (mocked layer)',
      html: '<p>test</p>',
      text: 'test',
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({});
  });
});
