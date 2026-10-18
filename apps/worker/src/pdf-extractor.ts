import { getDocumentProxy, extractTextItems, renderPageAsImage, type StructuredTextItem } from 'unpdf';
import { pdfTextToMarkdown } from '@lr/receipt-nl';
import { PermanentExtractionError, sniffMime, type Extraction, type Extractor } from './extractor.ts';

/** A receipt is one or two pages; a longer PDF is a statement or a contract. */
const MAX_PAGES = 5;
/** Fewer printed characters than this on the pages: it is a scan, not a text PDF. */
const MIN_TEXT_CHARS = 40;
/** Items whose baselines differ by less than this (PDF points) are on the same printed line. */
const LINE_TOLERANCE = 2.5;
/** Rendering scale of a scanned page: about 150 dpi, what the model reads well without a huge image. */
const SCAN_SCALE = 2;

/** The printed lines of one page: items grouped by baseline, left to right, a wide gap becomes two spaces. */
export function pageLines(items: StructuredTextItem[]): string[] {
  const rows: Array<{ y: number; items: StructuredTextItem[] }> = [];
  for (const it of [...items].filter((i) => i.str.trim() !== '').sort((a, b) => b.y - a.y)) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= LINE_TOLERANCE);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  return rows.map((r) => {
    const sorted = r.items.sort((a, b) => a.x - b.x);
    let out = '';
    let end = Number.NEGATIVE_INFINITY;
    for (const it of sorted) {
      const gap = it.x - end;
      out += out === '' ? it.str : gap > it.fontSize * 1.5 ? `  ${it.str}` : gap > 0.5 ? ` ${it.str}` : it.str;
      end = it.x + it.width;
    }
    return out.trim();
  });
}

/**
 * Wraps an extractor so it also reads PDFs. A PDF with a text layer is read from its text (no OCR, no model: the text is
 * exact) and goes through the same parser as a photo; a scanned PDF has its first page drawn as an image and handed to
 * the wrapped extractor like a photo. Everything else goes straight to the wrapped extractor.
 */
export function withPdfSupport(inner: Extractor): Extractor {
  return {
    async extract(bytes: Uint8Array): Promise<Extraction> {
      if (sniffMime(bytes) !== 'application/pdf') return inner.extract(bytes);

      let pdf;
      try {
        // pdf.js takes ownership of the buffer it is given
        pdf = await getDocumentProxy(new Uint8Array(bytes));
      } catch {
        throw new PermanentExtractionError('pdf_unreadable', 'the PDF could not be opened (damaged or password protected)');
      }
      if (pdf.numPages > MAX_PAGES) throw new PermanentExtractionError('pdf_too_long', `the PDF has ${pdf.numPages} pages`);
      const { items } = await extractTextItems(pdf);
      const lines = items.flatMap((page) => pageLines(page));
      if (lines.join('').replace(/\s/g, '').length >= MIN_TEXT_CHARS) {
        return { markdown: pdfTextToMarkdown(lines), kie: '{}', modelRevision: 'pdf-text-1' };
      }
      // a scan: the first page as an image, read like a photo
      const png = new Uint8Array(await renderPageAsImage(pdf, 1, { canvasImport: () => import('@napi-rs/canvas'), scale: SCAN_SCALE }));
      const read = await inner.extract(png);
      return { ...read, modelRevision: `${read.modelRevision}+pdf-scan` };
    },
  };
}
