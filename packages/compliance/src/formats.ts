/**
 * What differs per country on the receipt itself, apart from the legal text (that is `CountryRules`): currency, the VAT
 * rates a line may carry, how cash is rounded, the time zone and locale the receipt is shown in, and whether the receipt
 * only becomes final after a fiscal step (a certified device, a signature, a report to the tax authority).
 *
 * Money is always stored as integer minor units = 1/100 of the currency unit, also for HUF and ISK (they are shown
 * without decimals, and cash is rounded to whole units).
 *
 * Indicative, compiled by hand from public sources in October 2026 next to the legal research: confirm rates with a tax
 * adviser before relying on them. `vatRates` lists every rate a line can have in that country (including 0).
 */

export type FiscalMode =
  /** no fiscal step: a paid receipt is final */
  | 'none'
  /** the fiscal step exists but is not required for every business (e.g. horeca only): `paid` and `fiscalised` are both final */
  | 'optional'
  /** the receipt is final only once the fiscal step has run: `paid` -> `fiscalised` */
  | 'required';

export interface CountryFormat {
  code: string;
  /** ISO 4217 */
  currency: string;
  /** IANA zone the receipt time is shown in (the country's main zone) */
  timezone: string;
  /** BCP 47, for number and date formatting */
  locale: string;
  vatRates: readonly number[];
  /** cash is rounded to a multiple of this many minor units; null = no cash rounding */
  cashRoundingStep: number | null;
  fiscal: FiscalMode;
  /** short names the receipt prints in front of the company registry number and the VAT number (KvK / BTW, SIRET / TVA, ...) */
  idLabels: { company: string; vat: string };
}

const ID_LABELS: Record<string, [string, string]> = {
  AT: ['Steuernr.', 'UID'], BE: ['KBO', 'BTW'], BG: ['ЕИК', 'ДДС №'], CH: ['UID', 'MWST'], CY: ['HE', 'ΦΠΑ'], CZ: ['IČO', 'DIČ'],
  DE: ['Steuernr.', 'USt-IdNr.'], DK: ['CVR', 'Moms'], EE: ['Reg. kood', 'KMKR'], ES: ['NIF', 'NIF-IVA'], FI: ['Y-tunnus', 'ALV'], FR: ['SIRET', 'TVA'],
  GB: ['Company no.', 'VAT'], GR: ['ΑΦΜ', 'ΑΦΜ'], HR: ['OIB', 'PDV'], HU: ['Cégjegyzékszám', 'Adószám'], IE: ['CRO', 'VAT'], IS: ['Kt.', 'VSK'],
  IT: ['C.F.', 'P.IVA'], LT: ['Įm. kodas', 'PVM'], LU: ['RCS', 'TVA'], LV: ['Reģ. Nr.', 'PVN'], MT: ['C no.', 'VAT'], NL: ['KvK', 'BTW'],
  NO: ['Org.nr.', 'MVA'], PL: ['KRS', 'NIP'], PT: ['NIF', 'NIF'], RO: ['CUI', 'TVA'], SE: ['Org.nr', 'Moms'], SI: ['Matična št.', 'DDV'], SK: ['IČO', 'IČ DPH'],
};

const f = (code: string, currency: string, timezone: string, locale: string, vatRates: number[], cashRoundingStep: number | null, fiscal: FiscalMode): CountryFormat => ({
  code,
  currency,
  timezone,
  locale,
  vatRates,
  cashRoundingStep,
  fiscal,
  idLabels: { company: ID_LABELS[code]![0], vat: ID_LABELS[code]![1] },
});

const LIST: CountryFormat[] = [
  f('AT', 'EUR', 'Europe/Vienna', 'de-AT', [20, 13, 10, 0], null, 'required'),
  f('BE', 'EUR', 'Europe/Brussels', 'nl-BE', [21, 12, 6, 0], 5, 'optional'),
  f('BG', 'EUR', 'Europe/Sofia', 'bg-BG', [20, 9, 0], null, 'required'),
  f('CH', 'CHF', 'Europe/Zurich', 'de-CH', [8.1, 3.8, 2.6, 0], 5, 'none'),
  f('CY', 'EUR', 'Asia/Nicosia', 'el-CY', [19, 9, 5, 0], null, 'required'),
  f('CZ', 'CZK', 'Europe/Prague', 'cs-CZ', [21, 12, 0], 100, 'none'),
  f('DE', 'EUR', 'Europe/Berlin', 'de-DE', [19, 7, 0], null, 'required'),
  f('DK', 'DKK', 'Europe/Copenhagen', 'da-DK', [25, 0], 50, 'none'),
  f('EE', 'EUR', 'Europe/Tallinn', 'et-EE', [24, 13, 9, 0], null, 'none'),
  f('ES', 'EUR', 'Europe/Madrid', 'es-ES', [21, 10, 4, 0], null, 'required'),
  f('FI', 'EUR', 'Europe/Helsinki', 'fi-FI', [25.5, 14, 10, 0], 5, 'none'),
  f('FR', 'EUR', 'Europe/Paris', 'fr-FR', [20, 10, 5.5, 2.1, 0], null, 'required'),
  f('GB', 'GBP', 'Europe/London', 'en-GB', [20, 5, 0], null, 'none'),
  f('GR', 'EUR', 'Europe/Athens', 'el-GR', [24, 13, 6, 0], null, 'required'),
  f('HR', 'EUR', 'Europe/Zagreb', 'hr-HR', [25, 13, 5, 0], null, 'required'),
  f('HU', 'HUF', 'Europe/Budapest', 'hu-HU', [27, 18, 5, 0], 500, 'required'),
  f('IE', 'EUR', 'Europe/Dublin', 'en-IE', [23, 13.5, 9, 4.8, 0], 5, 'none'),
  f('IS', 'ISK', 'Atlantic/Reykjavik', 'is-IS', [24, 11, 0], null, 'none'),
  f('IT', 'EUR', 'Europe/Rome', 'it-IT', [22, 10, 5, 4, 0], null, 'required'),
  f('LT', 'EUR', 'Europe/Vilnius', 'lt-LT', [21, 9, 5, 0], null, 'required'),
  f('LU', 'EUR', 'Europe/Luxembourg', 'fr-LU', [17, 14, 8, 3, 0], null, 'none'),
  f('LV', 'EUR', 'Europe/Riga', 'lv-LV', [21, 12, 5, 0], null, 'required'),
  f('MT', 'EUR', 'Europe/Malta', 'mt-MT', [18, 7, 5, 0], null, 'required'),
  f('NL', 'EUR', 'Europe/Amsterdam', 'nl-NL', [21, 9, 0], 5, 'none'),
  f('NO', 'NOK', 'Europe/Oslo', 'nb-NO', [25, 15, 12, 0], 100, 'none'),
  f('PL', 'PLN', 'Europe/Warsaw', 'pl-PL', [23, 8, 5, 0], null, 'required'),
  f('PT', 'EUR', 'Europe/Lisbon', 'pt-PT', [23, 13, 6, 0], null, 'required'),
  f('RO', 'RON', 'Europe/Bucharest', 'ro-RO', [21, 11, 0], null, 'required'),
  f('SE', 'SEK', 'Europe/Stockholm', 'sv-SE', [25, 12, 6, 0], null, 'required'),
  f('SI', 'EUR', 'Europe/Ljubljana', 'sl-SI', [22, 9.5, 5, 0], null, 'required'),
  f('SK', 'EUR', 'Europe/Bratislava', 'sk-SK', [23, 19, 10, 5, 0], null, 'required'),
];

const BY_CODE = new Map(LIST.map((x) => [x.code, x]));

export const FORMAT_COUNTRY_CODES: readonly string[] = LIST.map((x) => x.code);

/** Format of a country (code case-insensitive); null when the country is not supported. */
export function getFormat(code: string): CountryFormat | null {
  return BY_CODE.get(code.toUpperCase()) ?? null;
}

/** Every currency the supported countries use. */
export const CURRENCIES: readonly string[] = [...new Set(LIST.map((x) => x.currency))].sort();

/** Does this country's receipt end in `fiscalised` rather than `paid`? Unknown countries keep the original NL rule. */
export function endsInFiscalised(code: string): boolean {
  return (getFormat(code)?.fiscal ?? 'none') === 'required';
}

/** Is `fiscalised` an allowed state for receipts of this country? */
export function allowsFiscalised(code: string): boolean {
  return (getFormat(code)?.fiscal ?? 'none') !== 'none';
}
