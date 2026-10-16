import { BTW_ID_RE, KVK_RE } from '@lr/schema';
import { normaliseName } from './text.ts';

/** `KvK 1234 5678`, `12345678` → `12345678`; anything that is not exactly 8 digits → null. */
export function normaliseKvk(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[\s.-]/g, '').replace(/^kvk[:\s]*/i, '');
  return KVK_RE.test(digits) ? digits : null;
}

/** `NL 1234.56.789.B01`, `nl123456789b01` → `NL123456789B01`. Format-checked only (no checksum). */
export function normaliseBtwId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const compact = raw.replace(/[\s.-]/g, '').toUpperCase();
  return BTW_ID_RE.test(compact) ? compact : null;
}

/** Dutch postcode `1012 ab` → `1012AB` (first digit 1–9, two letters). Otherwise null. */
export function normalisePostcode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^([1-9]\d{3})\s?([A-Za-z]{2})$/.exec(raw.trim());
  return m ? `${m[1]}${m[2]!.toUpperCase()}` : null;
}

export interface MerchantIdentity {
  name: string | null;
  kvkNumber: string | null;
  vatNumber: string | null;
  postcode: string | null;
}

/**
 * Lead / matching key (v2 §7): the first that exists of `vat:<btw-id>`, `kvk:<kvk>`,
 * `name:<normalised name>|<postcode>`. Identifiers that fail their format check are ignored.
 */
export function merchantKeyOf(m: MerchantIdentity): string | null {
  const vat = normaliseBtwId(m.vatNumber);
  if (vat) return `vat:${vat}`;
  const kvk = normaliseKvk(m.kvkNumber);
  if (kvk) return `kvk:${kvk}`;
  const name = m.name ? normaliseName(m.name) : '';
  if (!name) return null;
  return `name:${name}|${normalisePostcode(m.postcode) ?? ''}`;
}
