function formatExpiry(expiresAt: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(expiresAt);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface InviteEmailInput {
  firstName: string;
  organisationName: string;
  activationUrl: string;
  expiresAt: Date;
}

export function renderInviteEmail(input: InviteEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const expiry = formatExpiry(input.expiresAt);
  const safeName = escapeHtml(input.firstName);
  const safeOrg = escapeHtml(input.organisationName);
  const subject = `You've been invited to access ${input.organisationName} on Wasl Property`;

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
      <div style="background: #5b1a86; padding: 20px 24px; border-radius: 8px 8px 0 0;">
        <span style="color: #ffffff; font-size: 18px; font-weight: 700;">Wasl Property</span>
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; border-radius: 0 0 8px 8px; padding: 24px;">
        <p style="font-size: 15px; color: #111; margin-top: 0;">Hi ${safeName},</p>
        <p style="font-size: 15px; color: #111;">
          You've been invited to access <strong>${safeOrg}</strong> on Wasl Property, where you can
          report maintenance issues and track your requests for your property.
        </p>
        <p style="text-align: center; margin: 28px 0;">
          <a href="${input.activationUrl}"
             style="background: #5b1a86; color: #ffffff; text-decoration: none; padding: 12px 24px;
                    border-radius: 6px; font-size: 15px; font-weight: 600; display: inline-block;">
            Activate account
          </a>
        </p>
        <p style="font-size: 13px; color: #666;">
          This invitation link expires on ${expiry}. If you weren't expecting this invitation, you can
          safely ignore this email.
        </p>
      </div>
    </div>
  `.trim();

  const text = [
    `Hi ${input.firstName},`,
    '',
    `You've been invited to access ${input.organisationName} on Wasl Property.`,
    '',
    `Activate your account: ${input.activationUrl}`,
    '',
    `This invitation link expires on ${expiry}.`,
  ].join('\n');

  return { subject, html, text };
}
