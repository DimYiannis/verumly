import { describe, expect, it } from 'vitest';
import { parseExtraction, pdfTextToMarkdown } from '../src/index.ts';

describe('pdfTextToMarkdown', () => {
  it('turns the lines above the total into a table and keeps the rest', () => {
    const md = pdfTextToMarkdown(['Bakkerij', 'KvK 12345678', 'Brood 2 x 2,00 4,00 9%', 'Taart 3,50 9%', 'Totaal 7,50', 'BTW 9% 6,88 0,62', 'Contant 7,50']);
    expect(md).toContain('| Omschrijving | Aantal | Bedrag | BTW |');
    expect(md).toContain('| Brood | 2 | 4,00 | 9 |');
    expect(md).toContain('| Taart | 1 | 3,50 | 9 |');
    expect(md).toContain('Betaald contant Contant 7,50');
    expect(md.indexOf('Totaal')).toBeGreaterThan(md.indexOf('Taart'));
  });

  it('writes month names as numbers (the parser reads numeric dates)', () => {
    expect(pdfTextToMarkdown(['Shop', '17 Oct 2026, 12:04'])).toContain('17-10-2026, 12:04');
    expect(pdfTextToMarkdown(['Shop', '3 okt. 2026 09:15'])).toContain('3-10-2026 09:15');
  });

  it('with one VAT rate in the table every item gets it; labels are not items', () => {
    const md = pdfTextToMarkdown(['Shop', 'Koffie 3,40', 'Thee 2,10', 'Totaal 5,50', 'BTW 9% 5,05 0,45']);
    expect(md).toContain('| Koffie | 1 | 3,40 | 9 |');
    expect(md).toContain('| Thee | 1 | 2,10 | 9 |');
    expect(md).not.toContain('| Totaal');
  });

  it('a whole slip parses to a finished receipt', () => {
    const md = pdfTextToMarkdown([
      'Café Het Plein',
      'KvK 12345678',
      'BTW NL123456789B01',
      '17-10-2026 14:32',
      'Koffie 2 x 3,40 6,80',
      'Bier 3,89',
      'Totaal 10,69',
      'BTW 21% 3,21 0,68',
      'BTW 9% 6,24 0,56',
      'Pinnen 10,69',
    ]);
    const parsed = parseExtraction({ markdown: md, kie: '{}' });
    expect(parsed.failures).toEqual([]);
    expect(parsed.gross).toBe(1069);
  });

  it('text it cannot read stays as it is, and a receipt without items is left to the reader', () => {
    const md = pdfTextToMarkdown(['Invoice 2026-001', 'Consulting services', 'Total due 1.250,00']);
    expect(md).not.toContain('| Omschrijving');
    expect(parseExtraction({ markdown: md, kie: '{}' }).status).toBe('needs_review');
  });
});
