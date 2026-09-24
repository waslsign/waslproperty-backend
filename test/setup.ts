import { config } from 'dotenv';
import { vi } from 'vitest';

process.env.NODE_ENV = 'test';
config({ path: '.env.test' });

if (!process.env.DEBUG_TESTS) {
  console.log = () => undefined;
}

// Hard belt-and-braces guard: no test run may ever send a real email, no
// matter what SMTP/Resend config ends up in process.env. This used to rely
// solely on .env.test leaving SMTP_HOST unset — a dotenv override gap
// (src/config/env.ts's `import 'dotenv/config'` backfills missing keys
// from the real .env, which holds live Gmail SMTP credentials) meant tests
// were actually sending real mail through that account. Mocking the
// transport boundary itself means that gap can never matter again.
vi.mock('../src/lib/email.js', () => ({
  emailService: {
    send: vi.fn().mockResolvedValue({ providerMessageId: 'test-mock-email' }),
  },
}));
