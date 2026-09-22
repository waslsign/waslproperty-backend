import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../logger.js';
import type { EmailProvider, SendEmailInput, SendEmailResult } from './types.js';

/**
 * Local-development-only transport. Raw SMTP is not a viable
 * production/staging transport on this platform — Render's Free Web
 * Service tier blocks outbound SMTP ports (25/465/587) entirely, and even
 * a reachable SMTP host elsewhere fights most cloud platforms' anti-abuse
 * network policies (this is what was actually happening when
 * smtp.gmail.com timed out from Render but worked locally). Never selected
 * when RESEND_API_KEY is configured — see selectEmailProvider.ts. Kept
 * only because it gives local development a zero-config outbound-mail
 * story (an ad-hoc Ethereal test inbox) without requiring a Resend API key
 * just to run the app locally.
 */
export class SmtpEmailProvider implements EmailProvider {
  private transporterPromise: Promise<Transporter> | undefined;

  private getTransporter(): Promise<Transporter> {
    if (!this.transporterPromise) {
      this.transporterPromise = this.buildTransporter();
    }
    return this.transporterPromise;
  }

  private async buildTransporter(): Promise<Transporter> {
    if (env.SMTP_HOST) {
      return nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      });
    }

    const testAccount = await nodemailer.createTestAccount();
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const transporter = await this.getTransporter();
    const info = await transporter.sendMail({
      from: env.SMTP_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });

    if (!env.SMTP_HOST) {
      logger.info(
        { previewUrl: nodemailer.getTestMessageUrl(info) },
        'Email sent via Ethereal (dev-only fallback, no SMTP configured)',
      );
    }

    return { providerMessageId: info.messageId };
  }
}
