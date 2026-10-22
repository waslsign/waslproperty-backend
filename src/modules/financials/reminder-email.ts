/**
 * M16.8 — the reminder email template. `TEMPLATE_VERSION` is bumped
 * whenever wording changes materially and is recorded on
 * PaymentReminder.templateVersion/approvalSnapshot so a completed send is
 * always traceable to the exact copy that was sent.
 *
 * Deliberately a courtesy reminder, never a statutory/legal notice — see
 * this module's own COPY constants. No penalties, no enforcement powers,
 * no court action, no interest/recovery-fee figures are ever rendered
 * (this milestone never calculates any of those). No payment
 * instructions/bank details/links are rendered because none are
 * configured anywhere in this schema yet — inventing one would violate
 * ADR-029's explicit "never invent contact/payment information"
 * constraint; a manager contact line is likewise omitted because no
 * Property/Organisation field represents one today.
 */
export const TEMPLATE_VERSION = 1;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface ReminderEmailCharge {
  publicReference: string;
  levyScheduleName: string;
  dueDate: string;
  fundName: string;
  outstandingAmount: string;
}

export interface ReminderEmailInput {
  schemeName: string;
  strataPlanNumber: string | null;
  lotLabel: string;
  recipientFirstName: string;
  asOfDate: string;
  currencyCode: string;
  totalAmountOwing: string;
  charges: ReminderEmailCharge[];
}

export function renderReminderEmail(input: ReminderEmailInput): { subject: string; html: string; text: string } {
  const safeScheme = escapeHtml(input.schemeName);
  const safePlan = input.strataPlanNumber ? escapeHtml(input.strataPlanNumber) : null;
  const safeLot = escapeHtml(input.lotLabel);
  const safeName = escapeHtml(input.recipientFirstName);

  const rows = input.charges
    .map(
      (c) => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(c.levyScheduleName)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(c.fundName)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(c.dueDate)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${input.currencyCode} ${escapeHtml(c.outstandingAmount)}</td>
        </tr>`,
    )
    .join('');

  const subject = `Strata levy payment reminder — ${input.lotLabel}, ${input.currencyCode} ${input.totalAmountOwing} outstanding`;

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: #662A6F; padding: 20px 24px; border-radius: 8px 8px 0 0;">
        <span style="color: #ffffff; font-size: 18px; font-weight: 700;">${safeScheme}</span>
        ${safePlan ? `<div style="color: #e9d9ec; font-size: 12px; margin-top: 2px;">Strata Plan ${safePlan}</div>` : ''}
      </div>
      <div style="border: 1px solid #e5e5e5; border-top: none; border-radius: 0 0 8px 8px; padding: 24px;">
        <p style="font-size: 15px; color: #111; margin-top: 0;">Hi ${safeName},</p>
        <p style="font-size: 15px; color: #111; line-height: 1.5;">
          This is a courtesy reminder that the following strata levy instalment(s) for
          <strong>${safeLot}</strong> remain outstanding, as of ${escapeHtml(input.asOfDate)}:
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin:16px 0;">
          <thead>
            <tr style="background:#f6f1f7;">
              <th style="padding:6px 10px;text-align:left;">Levy Schedule</th>
              <th style="padding:6px 10px;text-align:left;">Fund</th>
              <th style="padding:6px 10px;text-align:left;">Due Date</th>
              <th style="padding:6px 10px;text-align:right;">Outstanding</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="padding:8px 10px;font-weight:700;">Total Amount Owing</td>
              <td style="padding:8px 10px;font-weight:700;text-align:right;">${input.currencyCode} ${escapeHtml(input.totalAmountOwing)}</td>
            </tr>
          </tfoot>
        </table>
        <p style="font-size: 14px; color: #333; line-height: 1.5;">
          Please arrange payment at your earliest convenience. If you have already made this
          payment, or believe this reminder has been sent in error, please disregard this notice
          or contact your strata manager.
        </p>
        <p style="font-size: 12px; color: #888; margin-top: 24px; border-top: 1px solid #eee; padding-top: 12px;">
          This is a courtesy payment reminder, not a statutory or legal notice. It does not imply
          any penalty, interest charge, enforcement action or legal proceeding.
        </p>
      </div>
    </div>
  `.trim();

  const text = [
    `Hi ${input.recipientFirstName},`,
    '',
    `This is a courtesy reminder that the following strata levy instalment(s) for ${input.lotLabel} remain outstanding, as of ${input.asOfDate}:`,
    '',
    ...input.charges.map(
      (c) => `- ${c.levyScheduleName} (${c.fundName}), due ${c.dueDate}: ${input.currencyCode} ${c.outstandingAmount}`,
    ),
    '',
    `Total Amount Owing: ${input.currencyCode} ${input.totalAmountOwing}`,
    '',
    'Please arrange payment at your earliest convenience. If you have already made this payment, or believe this reminder has been sent in error, please disregard this notice or contact your strata manager.',
    '',
    'This is a courtesy payment reminder, not a statutory or legal notice. It does not imply any penalty, interest charge, enforcement action or legal proceeding.',
  ].join('\n');

  return { subject, html, text };
}
