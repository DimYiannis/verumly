import { renderReceiptPdf } from '@lr/receipt-pdf';
import type { Crf, ReceiptTemplate } from '@lr/schema';

/** A PDF of one receipt version for the merchant archive, in the organisation's receipt design (default when none saved). */
export async function receiptPdf(crf: Crf, template: ReceiptTemplate | null = null): Promise<Uint8Array> {
  return renderReceiptPdf(crf, template);
}
