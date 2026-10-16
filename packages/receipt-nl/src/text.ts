/**
 * Normalises OCR/markdown text before parsing: NFKC (full-width digits, ligatures), unusual spaces,
 * unicode minus signs next to digits, markdown emphasis and CRLF. It never "repairs" digits:
 * a misread digit must stay visible to the arithmetic checks.
 */
export function normaliseOcrText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2000-\u200a\u202f\u3000\t]/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[\u2212\u2012\u2013\u2014](?=\s*[€\d])/g, '-')
    .replace(/(?<=\d)[\u2212\u2012\u2013\u2014]/g, '-')
    .replace(/\*{1,3}|`{1,3}|\\_/g, '')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim();
}

/** Lowercase, diacritics stripped, punctuation to spaces, whitespace collapsed. Used for merchant keys. */
export function normaliseName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' en ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
