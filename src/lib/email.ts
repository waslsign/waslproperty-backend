import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * A small, reusable transactional-email sender — deliberately not a full
 * notification system (no templates registry, no queueing, no delivery
 * tracking). It exists so the later Notification Service has a single
 * outbound-mail primitive to build on instead of scattered SMTP calls.
 *
 * In development, when SMTP_HOST isn't configured, mail is sent through an
 * ad-hoc Ethereal test inbox and the preview URL is logged — no real email
 * ever leaves the machine.
 */
export class EmailService {
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

  async send(input: SendEmailInput): Promise<void> {
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
  }
}

export const emailService = new EmailService();
