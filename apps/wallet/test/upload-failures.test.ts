import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { messages, type MessageKey } from '../app/i18n/index.ts';
import { uploadFailureText } from '../app/utils/upload-failures.ts';

const SOURCES = ['../../../packages/receipt-nl/src/parse.ts', '../../../packages/receipt-nl/src/validate.ts', '../../buyer-api/src/uploads.ts'];

/** Every literal failure code the parser, the validator and the correction endpoint can put on an upload. */
function sourceCodes(): string[] {
  const codes = new Set<string>();
  for (const rel of SOURCES) {
    const text = readFileSync(new URL(rel, import.meta.url), 'utf8');
    for (const m of text.matchAll(/failures\.push\('([a-z_]+)'\)/g)) codes.add(m[1]!);
    for (const m of text.matchAll(/\badd\([^,]+,\s*(?:country === 'NL' \? '([a-z_]+)' : )?'([a-z_]+)'/g)) {
      if (m[1]) codes.add(m[1]);
      codes.add(m[2]!);
    }
  }
  return [...codes].sort();
}

describe('upload failure codes', () => {
  const codes = sourceCodes();

  it('finds the codes in the sources', () => {
    expect(codes).toEqual(expect.arrayContaining(['gross_sum', 'vat_missing', 'date_missing', 'rounding_rule', 'payments_sum', 'fiscalised_not_allowed_nl']));
  });

  it.each(codes)('%s has an English and a Dutch message', (code) => {
    const key = `uploadFailure.${code}` as MessageKey;
    expect(messages.en[key], `en ${key}`).toBeTruthy();
    expect(messages.nl[key], `nl ${key}`).toBeTruthy();
  });

  it('puts the numbers in the gross_sum sentence', () => {
    const draft = { gross: 4880, lines: [{ total: 1500 }, { total: 2880 }] };
    expect(uploadFailureText('gross_sum', draft, 'en').replace(/\s/g, ' ')).toBe('Items add up to €43.80, total read as €48.80.');
    expect(uploadFailureText('gross_sum', draft, 'nl')).toMatch(/43,80.*48,80/);
  });

  it('falls back to a generic sentence for an unknown code', () => {
    expect(uploadFailureText('made_up_code', null, 'en')).toBe(messages.en['uploadFailure.unknown']);
    expect(uploadFailureText('made_up_code', null, 'nl')).not.toContain('made_up_code');
  });
});
