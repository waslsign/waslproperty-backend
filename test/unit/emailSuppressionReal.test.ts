import { describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env.js';
import * as selectProviderModule from '../../src/lib/email/selectEmailProvider.js';

// Cancels test/setup.ts's global belt-and-braces mock of this module for
// THIS FILE ONLY (vi.unmock, like vi.mock, is hoisted to the top of the
// file) — deliberately, since this file's entire purpose is to exercise
// the REAL EmailService/isEmailSendSuppressed implementation directly.
vi.unmock('../../src/lib/email.js');
const { EmailService, isEmailSendSuppressed } = await import('../../src/lib/email.js');

/**
 * Layer 2 of outbound-email safety: the EMAIL_SEND_DISABLED kill switch,
 * checked inside EmailService.send() itself, before any mail provider is
 * even selected/instantiated — see src/lib/email.ts. This protects a real
 * (non-test) dev-server process, where test/setup.ts's global mock and
 * emailSuppression.test.ts's file-local mock do NOT apply at all (nothing
 * is running under vitest). This file deliberately does NOT mock
 * src/lib/email.js, so it exercises the real implementation directly.
 */
describe('outbound email suppression — layer 2 (EMAIL_SEND_DISABLED kill switch)', () => {
  it('is suppressed under the test runner by default', () => {
    expect(env.NODE_ENV).toBe('test');
    expect(isEmailSendSuppressed()).toBe(true);
  });

  it('EMAIL_SEND_DISABLED=true is also explicitly set in .env.test (defense in depth, not relied on via NODE_ENV alone)', () => {
    expect(env.EMAIL_SEND_DISABLED).toBe(true);
  });

  it('EmailService.send() never selects/constructs a real provider while suppressed', async () => {
    const selectSpy = vi.spyOn(selectProviderModule, 'selectEmailProvider');
    const service = new EmailService();

    const result = await service.send({
      to: 'should-never-receive-this@example.com',
      subject: 'Suppression test (real layer)',
      html: '<p>test</p>',
      text: 'test',
    });

    // No provider (SMTP transporter or Resend client) was ever
    // constructed — the real-provider branch of send() was never reached,
    // so no network connection to any mail server was ever attempted.
    expect(selectSpy).not.toHaveBeenCalled();
    // A suppressed send still resolves successfully (never throws), so
    // calling code behaves exactly as it would on a real send.
    expect(result).toEqual({});

    selectSpy.mockRestore();
  });

  it('proves the spy above is a meaningful negative, not a tautology — selectEmailProvider IS called when actually invoked', () => {
    const selectSpy = vi.spyOn(selectProviderModule, 'selectEmailProvider');
    selectProviderModule.selectEmailProvider({ resendApiKey: undefined, emailFrom: 'test@example.com' });
    expect(selectSpy).toHaveBeenCalledTimes(1);
    selectSpy.mockRestore();
  });
});
