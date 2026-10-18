import data from './data/countries.json' with { type: 'json' };
import type { ComplianceSettings, CountryRules } from './types.ts';

export * from './types.ts';
export * from './formats.ts';

const countries = data.countries as unknown as Record<string, CountryRules>;

/** Everything is research output, not legal advice: shown next to every country in the UI. */
export const DISCLAIMER =
  'Compiled from public sources in October 2026 and not reviewed by a tax adviser. Laws and fiscal systems change: confirm every requirement with your tax adviser or tax authority before you rely on it.';

export const COUNTRY_CODES: readonly string[] = Object.keys(countries).sort((a, b) => countries[a]!.name.localeCompare(countries[b]!.name));

export function listCountries(): CountryRules[] {
  return COUNTRY_CODES.map((c) => countries[c]!);
}

export function getCountry(code: string): CountryRules | null {
  return countries[code.toUpperCase()] ?? null;
}

/** EU-wide baseline notes (VAT Directive invoices, ViDA, GDPR), as written by the research. */
export const EU_BASELINE: Record<string, unknown> | null = (data as { eu: Record<string, unknown> | null }).eu;

const GENERIC_VAT_RE = '^[A-Z]{2}[A-Z0-9]{2,12}$';

function matches(pattern: string | undefined, value: string): boolean {
  if (!pattern) return true;
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return true;
  }
}

export interface IdentityInput {
  /** company registry number (KvK, SIRET, Handelsregister, ...), or null when there is none to give */
  companyId: string | null;
  vatId: string | null;
}

export function normaliseVatId(v: string | null | undefined): string {
  return (v ?? '').trim().toUpperCase().replace(/[\s.-]+/g, '');
}

/** Checks the identity fields and the country settings. Returns one message per problem, empty when valid. */
export function validateSetup(code: string, identity: IdentityInput, values: Record<string, string | boolean>): string[] {
  const c = getCountry(code);
  if (!c) return [`unknown country ${code}`];
  const errors: string[] = [];
  const companyId = identity.companyId?.trim() ?? '';
  if (companyId && !matches(c.companyId.pattern, companyId)) {
    errors.push(`${c.companyId.label}: ${c.companyId.example ? `expected something like ${c.companyId.example}` : 'invalid format'}`);
  }
  const vat = normaliseVatId(identity.vatId);
  if (vat && !matches(c.vatId.pattern ?? GENERIC_VAT_RE, vat)) {
    errors.push(`${c.vatId.label}: ${c.vatId.example ? `expected something like ${c.vatId.example}` : 'invalid format'}`);
  }
  for (const s of c.settings) {
    const v = values[s.key];
    const missing = v === undefined || v === null || v === '';
    if (s.required && missing) {
      errors.push(`${s.label}: required`);
      continue;
    }
    if (missing) continue;
    if (s.type === 'select' && s.options && typeof v === 'string' && !s.options.includes(v)) errors.push(`${s.label}: choose one of ${s.options.join(', ')}`);
    if (s.type === 'text' && typeof v === 'string' && !matches(s.pattern, v)) errors.push(`${s.label}: invalid format`);
  }
  return errors;
}

/** Drops values that are not settings of this country, and coerces types. */
export function cleanSettings(code: string, values: Record<string, unknown>): Record<string, string | boolean> {
  const c = getCountry(code);
  const out: Record<string, string | boolean> = {};
  if (!c) return out;
  for (const s of c.settings) {
    const v = values[s.key];
    if (s.type === 'boolean') out[s.key] = v === true || v === 'true';
    else if (typeof v === 'string' && v.trim() !== '') out[s.key] = v.trim().slice(0, 200);
  }
  return out;
}

export function emptyCompliance(country: string): ComplianceSettings {
  return { country, values: {}, confirmedAt: null };
}

/** null when `value` is a plausible company registry number for the country, otherwise a message. Countries the research has no pattern for accept anything. */
export function companyIdProblem(code: string, value: string): string | null {
  const c = getCountry(code);
  if (!c) return `unknown country ${code}`;
  return matches(c.companyId.pattern, value.trim()) ? null : `${c.companyId.label}: ${c.companyId.example ? `expected something like ${c.companyId.example}` : 'invalid format'}`;
}

/** Same for the VAT number (compact form, as stored). */
export function vatIdProblem(code: string, value: string): string | null {
  const c = getCountry(code);
  if (!c) return `unknown country ${code}`;
  return matches(c.vatId.pattern ?? GENERIC_VAT_RE, normaliseVatId(value)) ? null : `${c.vatId.label}: ${c.vatId.example ? `expected something like ${c.vatId.example}` : 'invalid format'}`;
}
