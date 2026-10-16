// Merges the raw research files in docs/legal-research/*.json into src/data/countries.json.
// Later files override earlier ones per country (second.json is the verified second pass).
// Usage: node scripts/build-data.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../../docs/legal-research/', import.meta.url));
const out = fileURLToPath(new URL('../src/data/countries.json', import.meta.url));
const ORDER = ['west', 'south', 'east', 'north', 'second'];

/** Names, currency, indicative standard VAT and indicative minimum retention (years). Indicative: the setup screen says so. */
const BASE = {
  AT: ['Austria', 'EUR', 20, 7], BE: ['Belgium', 'EUR', 21, 7], BG: ['Bulgaria', 'EUR', 20, 10], CH: ['Switzerland', 'CHF', 8.1, 10],
  CY: ['Cyprus', 'EUR', 19, 6], CZ: ['Czechia', 'CZK', 21, 10], DE: ['Germany', 'EUR', 19, 8], DK: ['Denmark', 'DKK', 25, 5],
  EE: ['Estonia', 'EUR', 24, 7], ES: ['Spain', 'EUR', 21, 6], FI: ['Finland', 'EUR', 25.5, 6], FR: ['France', 'EUR', 20, 6],
  GB: ['United Kingdom', 'GBP', 20, 6], GR: ['Greece', 'EUR', 24, 5], HR: ['Croatia', 'EUR', 25, 11], HU: ['Hungary', 'HUF', 27, 8],
  IE: ['Ireland', 'EUR', 23, 6], IS: ['Iceland', 'ISK', 24, 7], IT: ['Italy', 'EUR', 22, 10], LT: ['Lithuania', 'EUR', 21, 10],
  LU: ['Luxembourg', 'EUR', 17, 10], LV: ['Latvia', 'EUR', 21, 5], MT: ['Malta', 'EUR', 18, 6], NL: ['Netherlands', 'EUR', 21, 7],
  NO: ['Norway', 'NOK', 25, 5], PL: ['Poland', 'PLN', 23, 5], PT: ['Portugal', 'EUR', 23, 10], RO: ['Romania', 'RON', 21, 10],
  SE: ['Sweden', 'SEK', 25, 7], SI: ['Slovenia', 'EUR', 22, 10], SK: ['Slovakia', 'EUR', 23, 10],
};

const NAME_KEYS = new Set(['legalName', 'seller_name', 'businessName', 'vatRates']);
const ADDRESS_KEYS = new Set(['address', 'seller_address', 'storeAddress']);
const VAT_KEYS = new Set(['vat_id', 'vatNumber', 'vatId', 'btwId', 'uid', 'vat_number']);
const REG_KEYS = new Set(['kvk', 'bceNumber', 'siret', 'rcsl', 'ico', 'orgNumber', 'croNumber', 'companyNumber', 'nif', 'taxNumber', 'taxCode', 'kennitala']);

function pattern(v) {
  if (typeof v !== 'string') return undefined;
  const m = v.trim().match(/^\^.*\$$/);
  if (!m) return undefined;
  try {
    new RegExp(v);
    return v;
  } catch {
    return undefined;
  }
}
function options(v) {
  if (typeof v !== 'string') return undefined;
  const m = v.match(/^options?:\s*(.+)$/i);
  if (!m) return undefined;
  const list = m[1].split(/[,|]/).map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return list.length >= 2 && list.length <= 12 ? list : undefined;
}
function normSetting(s) {
  const type = s.type === 'boolean' ? 'boolean' : options(s.validation) ? 'select' : 'text';
  const o = {
    key: String(s.key).replace(/[^A-Za-z0-9_]/g, '_'),
    label: String(s.label ?? s.key),
    type,
    required: s.required === true,
    help: typeof s.help === 'string' ? s.help : '',
  };
  const p = type === 'text' ? pattern(s.validation) : undefined;
  if (p) o.pattern = p;
  const opts = type === 'select' ? options(s.validation) : undefined;
  if (opts) o.options = opts;
  if (!p && !opts && typeof s.validation === 'string' && s.validation.length < 140 && s.validation !== 'non-empty') o.hint = s.validation;
  return o;
}
const text = (v) => (typeof v === 'string' ? v : v == null ? 'unverified' : JSON.stringify(v));

const raw = {};
for (const f of ORDER) {
  const p = dir + f + '.json';
  if (!existsSync(p)) continue;
  Object.assign(raw, JSON.parse(readFileSync(p, 'utf8')).countries);
}

const countries = {};
for (const [code, base] of Object.entries(BASE)) {
  const r = raw[code];
  if (!r) throw new Error('no research for ' + code);
  const settings = Array.isArray(r.settingsNeeded) ? r.settingsNeeded : [];
  const vatSetting = settings.find((s) => VAT_KEYS.has(s.key));
  const regSetting = settings.find((s) => REG_KEYS.has(s.key));
  const extra = settings.filter((s) => !NAME_KEYS.has(s.key) && !ADDRESS_KEYS.has(s.key) && s !== vatSetting && s !== regSetting).map(normSetting);
  const seen = new Set();
  const unique = extra.filter((s) => (seen.has(s.key) ? false : seen.add(s.key)));
  const explicit = (k) => (r[k] && typeof r[k] === 'object' && !Array.isArray(r[k]) ? r[k] : null);
  const reg = explicit('companyIdFormat');
  const vatf = explicit('vatIdFormat');
  countries[code] = {
    code,
    name: base[0],
    currency: base[1],
    vatStandard: base[2],
    retentionYearsIndicative: base[3],
    companyId: {
      label: reg?.localName ?? regSetting?.label ?? 'Company registration number',
      pattern: pattern(reg?.regex) ?? pattern(regSetting?.validation),
      example: reg?.example,
    },
    vatId: {
      label: vatf?.localName ?? vatSetting?.label ?? 'VAT number',
      pattern: pattern(vatf?.regex) ?? pattern(vatSetting?.validation),
      example: vatf?.example,
    },
    summary: {
      receiptObligation: text(r.receiptObligation),
      digitalReceipt: text(r.digitalReceipt),
      mandatoryFields: text(r.mandatoryFields),
      fiscalSystem: text(r.fiscalSystem),
      realTimeReporting: text(r.realTimeReporting),
      receiptIdentifiers: text(r.receiptIdentifiers),
      retention: text(r.retentionYears),
      vat: text(r.vat),
      other: text(r.other),
    },
    settings: unique,
    sources: Array.isArray(r.sources) ? r.sources.filter((u) => typeof u === 'string') : [],
    confidence: ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'low',
    adviserMustVerify: text(r.adviserMustVerify ?? r.adviserVerify ?? 'Everything: not reviewed by a tax adviser.'),
    lastChecked: r.lastChecked ?? '2026-10-17',
  };
}
const eu = raw.EU ?? null;
writeFileSync(out, JSON.stringify({ generatedFrom: ORDER, countries, eu }, null, 2) + '\n');
console.log('countries:', Object.keys(countries).length, 'settings total:', Object.values(countries).reduce((n, c) => n + c.settings.length, 0));
