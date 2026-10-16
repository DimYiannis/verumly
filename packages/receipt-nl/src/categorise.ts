/**
 * Dutch keyword categoriser (v2 §11 `categorise`). Deterministic rule table: first category whose keyword list
 * matches the normalised description wins. Health lines are flagged `sensitive` (special-category data).
 */

export interface Categorised {
  category: string;
  sensitive: boolean;
}

export const FALLBACK_CATEGORY = 'overig';
export const HEALTH_CATEGORY = 'gezondheid';

/** Ordered: earlier categories win. Keywords are matched as lowercase substrings of the normalised text. */
export const CATEGORY_RULES: ReadonlyArray<{ category: string; keywords: readonly string[] }> = [
  { category: HEALTH_CATEGORY, keywords: ['paracetamol', 'ibuprofen', 'aspirine', 'pijnstiller', 'hoestsiroop', 'neusspray', 'allergie', 'antihistamine', 'voorbehoed', 'zwangerschapstest', 'medicijn', 'tablet', 'capsule', 'oogdruppel', 'wondzalf', 'pleister', 'vitamine', 'zalf', 'ontsmet'] },
  { category: 'statiegeld', keywords: ['statiegeld', 'emballage', 'pand '] },
  { category: 'dining', keywords: ['koffie', 'cappuccino', 'espresso', 'latte', 'thee', 'bier', 'pils', 'wijn', 'cola', 'fanta', 'sprite', 'limonade', 'jus d', 'whisky', 'borrel', 'appeltaart', 'taart', 'gebak', 'tosti', 'broodje', 'uitsmijter', 'soep', 'frietjes', 'friet', 'bitterbal', 'burger', 'pizza', 'pasta', 'salade', 'menu', 'diner', 'lunch', 'ontbijt', 'koek'] },
  { category: 'boodschappen', keywords: ['melk', 'kaas', 'brood', 'boter', 'eieren', 'ei ', 'yoghurt', 'yogurt', 'kip', 'gehakt', 'worst', 'vlees', 'vis', 'zalm', 'groente', 'fruit', 'appel', 'banaan', 'tomaat', 'komkommer', 'aardappel', 'rijst', 'pasta', 'meel', 'suiker', 'olie', 'chips', 'chocolade', 'snoep', 'ontbijtkoek', 'havermout', 'muesli', 'bonus'] },
  { category: 'huishouden', keywords: ['afwasmiddel', 'wasmiddel', 'toiletpapier', 'keukenrol', 'vuilniszak', 'schoonmaak', 'batterij', 'lamp', 'sponzen', 'shampoo', 'tandpasta', 'zeep', 'deodorant'] },
  { category: 'vervoer', keywords: ['parkeer', 'benzine', 'diesel', 'tanken', 'ov-chipkaart', 'ov chipkaart', 'treinkaartje', 'taxi'] },
  { category: 'kleding', keywords: ['broek', 'trui', 'jas ', 'schoenen', 'sokken', 'shirt', 't-shirt', 'jurk'] },
  { category: 'elektronica', keywords: ['kabel', 'oplader', 'usb', 'hdmi', 'koptelefoon', 'mobiel', 'laptop'] },
];

function normalise(text: string): string {
  return `${text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')} `;
}

const PHARMACY_MERCHANT = /\bapotheek\b|\bapotheker\b/;

/**
 * Categorise one line. `merchantName` matters only for health: every line sold by an `apotheek` is
 * health-related, while a `drogist` sells many things, so only health keywords flag its lines.
 */
export function categoriseLine(line: { description: string; merchantName?: string | null }): Categorised {
  const text = normalise(line.description);
  const merchant = line.merchantName ? line.merchantName.toLowerCase() : '';
  if (PHARMACY_MERCHANT.test(merchant)) return { category: HEALTH_CATEGORY, sensitive: true };
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((k) => text.includes(k))) return { category: rule.category, sensitive: rule.category === HEALTH_CATEGORY };
  }
  return { category: FALLBACK_CATEGORY, sensitive: false };
}
