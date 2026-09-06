import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface QuoteAcceptanceDocumentInput {
  organisationName: string;
  propertyName: string;
  spaceName?: string | null;
  workOrderTitle: string;
  workOrderId: string;
  maintenanceRequestId?: string | null;
  contractorName: string;
  scopeOfWork: string;
  amount: string;
  currency: string;
  scheduledAt?: string | null;
}

/**
 * Generates the simple, single-page Work Order / Quote Acceptance document
 * used for SIGNATURE_ONLY and the signature phase of APPROVAL_THEN_SIGNATURE.
 * Deliberately plain — no branding system, no layout engine. Returns the
 * raw PDF bytes; the caller base64-encodes them for the WaslSign API.
 *
 * Never includes resident identity or contact details — only what's needed
 * to identify the property/space and the work being accepted.
 */
export async function generateQuoteAcceptanceDocument(
  input: QuoteAcceptanceDocumentInput,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // US Letter
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = 740;
  const left = 56;
  const lineGap = 20;

  const drawTitle = (text: string) => {
    page.drawText(text, { x: left, y, size: 18, font: bold, color: rgb(0.15, 0.1, 0.2) });
    y -= 32;
  };
  const drawLabelValue = (label: string, value: string) => {
    page.drawText(label, { x: left, y, size: 10, font: bold, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(value, { x: left + 160, y, size: 11, font, color: rgb(0, 0, 0) });
    y -= lineGap;
  };
  const drawParagraph = (text: string) => {
    const words = text.split(' ');
    let line = '';
    const maxWidth = 500;
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, 11) > maxWidth) {
        page.drawText(line, { x: left, y, size: 11, font });
        y -= 16;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      page.drawText(line, { x: left, y, size: 11, font });
      y -= 16;
    }
  };

  drawTitle('Work Order Acceptance');
  drawLabelValue('Organisation', input.organisationName);
  drawLabelValue('Property', input.propertyName);
  if (input.spaceName) drawLabelValue('Space / Unit', input.spaceName);
  drawLabelValue('Work Order', `${input.workOrderTitle} (${input.workOrderId})`);
  if (input.maintenanceRequestId) drawLabelValue('Originating request', input.maintenanceRequestId);
  drawLabelValue('Contractor', input.contractorName);
  drawLabelValue('Amount', `${input.amount} ${input.currency}`);
  if (input.scheduledAt) drawLabelValue('Scheduled', input.scheduledAt);

  y -= 12;
  page.drawText('Scope of work', { x: left, y, size: 12, font: bold });
  y -= 18;
  drawParagraph(input.scopeOfWork);

  y -= 20;
  page.drawText('Acknowledgement', { x: left, y, size: 12, font: bold });
  y -= 18;
  drawParagraph(
    'By signing below, the parties acknowledge the scope of work and amount stated above and authorise the work to proceed.',
  );

  y -= 60;
  page.drawLine({
    start: { x: left, y },
    end: { x: left + 220, y },
    thickness: 1,
    color: rgb(0.5, 0.5, 0.5),
  });
  page.drawText('Authorised signatory', {
    x: left,
    y: y - 14,
    size: 9,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });

  page.drawLine({
    start: { x: left + 280, y },
    end: { x: left + 500, y },
    thickness: 1,
    color: rgb(0.5, 0.5, 0.5),
  });
  page.drawText('Contractor', {
    x: left + 280,
    y: y - 14,
    size: 9,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });

  return doc.save();
}
