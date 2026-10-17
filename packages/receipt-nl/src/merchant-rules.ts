/**
 * Shop-type fallback for the categoriser (MCC-like): which category a line gets when its own keywords match nothing,
 * judged by the shop name. Line keywords always win over the shop name (see `categoriseLine`).
 */

import type { Categorised } from './categorise.ts';
import { normaliseName } from './text.ts';

export interface MerchantRule {
  category: string;
  /** health shops: every fallback line is health data */
  sensitive?: boolean;
  /** shop names or abbreviations, matched on whole words of the normalised shop name (`normaliseName`: lowercase, no accents, no punctuation) ("AH", "albert heijn") */
  names: readonly string[];
}

/** Ordered: earlier rules win when a shop name matches more than one. */
export const MERCHANT_RULES: ReadonlyArray<MerchantRule> = [
  { category: 'gezondheid', sensitive: true, names: ['kruidvat', 'etos', 'apotheek', 'apotheker', 'trekpleister', 'da drogist'] },
  { category: 'boodschappen', names: ['albert heijn', 'ah', 'ah to go', 'jumbo', 'lidl', 'aldi', 'plus', 'dirk', 'dirk van den broek', 'spar', 'coop', 'vomar', 'hoogvliet', 'deen', 'poiesz', 'ekoplaza', 'picnic'] },
  { category: 'huishouden', names: ['hema', 'action', 'blokker', 'ikea', 'gamma', 'praxis', 'karwei', 'xenos'] },
  { category: 'vervoer', names: ['shell', 'bp', 'esso', 'texaco', 'tamoil', 'tango', 'q8', 'ns', 'gvb', 'ret', 'htm', 'arriva', 'q park', 'parkeergarage'] },
  { category: 'kleding', names: ['zara', 'h&m', 'c&a', 'primark', 'zeeman', 'wibra'] },
  { category: 'elektronica', names: ['mediamarkt', 'media markt', 'coolblue', 'bcc', 'apple store'] },
  { category: 'dining', names: ['mcdonalds', 'mcdonald s', 'burger king', 'starbucks', 'subway', 'kfc', 'domino s'] },
];

const PREPARED: ReadonlyArray<{ rule: MerchantRule; padded: readonly string[] }> = MERCHANT_RULES.map((rule) => ({
  rule,
  padded: rule.names.map((n) => ` ${normaliseName(n)} `),
}));

/** The category of a shop by name, or null when no rule knows it. Whole-word, case- and accent-insensitive. */
export function categoriseMerchant(merchantName: string | null | undefined): Categorised | null {
  if (!merchantName) return null;
  const haystack = ` ${normaliseName(merchantName)} `;
  for (const { rule, padded } of PREPARED) {
    if (padded.some((n) => haystack.includes(n))) return { category: rule.category, sensitive: rule.sensitive === true };
  }
  return null;
}
