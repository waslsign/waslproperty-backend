import { describe, expect, it } from 'vitest';
import { selectEmailProvider } from '../../src/lib/email/selectEmailProvider.js';
import { ResendEmailProvider } from '../../src/lib/email/resendEmailProvider.js';
import { SmtpEmailProvider } from '../../src/lib/email/smtpEmailProvider.js';

describe('selectEmailProvider', () => {
  it('selects Resend when an API key is configured', () => {
    const provider = selectEmailProvider({
      resendApiKey: 're_test_key',
      emailFrom: 'Wasl Property <no-reply@waslproperty.dev>',
    });
    expect(provider).toBeInstanceOf(ResendEmailProvider);
  });

  it('falls back to SMTP when no API key is configured — local development only', () => {
    const provider = selectEmailProvider({
      resendApiKey: undefined,
      emailFrom: 'Wasl Property <no-reply@waslproperty.dev>',
    });
    expect(provider).toBeInstanceOf(SmtpEmailProvider);
  });

  it('treats an empty-string API key the same as unset', () => {
    const provider = selectEmailProvider({
      resendApiKey: '',
      emailFrom: 'Wasl Property <no-reply@waslproperty.dev>',
    });
    expect(provider).toBeInstanceOf(SmtpEmailProvider);
  });
});
