import { MAX_DESCRIPTION } from '@lr/schema';

export type VatRate = 21 | 9 | 0 | null;

export interface DraftLine {
  sku?: string | null;
  description: string;
  /** decimal; at most 3 decimals (weighed items). Negative for returns. */
  qty?: string | number;
  /** euro cents, VAT included */
  unitPrice: number;
  vatRate: VatRate;
  discount?: number;
  kind?: 'item' | 'discount' | 'deposit';
  category?: string | null;
}

export interface DraftPayment {
  method: 'card' | 'cash' | 'other';
  /** omitted → the amount due (single payment) */
  amount?: number;
}

export interface Draft {
  state: 'open' | 'presented' | 'paid';
  lines: DraftLine[];
  payments?: DraftPayment[];
  tip?: number;
  rounding?: number;
  documentNumber?: string | null;
}

// A masked card number (****1234, XXXX-1234, 4111 **** **** 1111) or any long digit run
// (card numbers, loyalty-card numbers) is dropped from item text before signing.
const MASKED_PAN = /(?:[*xX•#]{2,}[\s-]*)+\d{2,6}|\b\d{4}[\s-]?[*xX•]{2,4}[\s-]?[*xX•]{2,4}[\s-]?\d{4}\b/g;
const LONG_DIGITS = /\d(?:[\s-]?\d){7,}/g;

/** Remove loyalty-card numbers and masked PANs from a line description; clamp to the CRF limit. */
export function scrubDescription(text: string): string {
  const cleaned = text.replace(MASKED_PAN, ' ').replace(LONG_DIGITS, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || 'Artikel').slice(0, MAX_DESCRIPTION);
}

function toQty(q: string | number | undefined): string {
  if (q === undefined) return '1';
  const s = typeof q === 'number' ? String(Math.round(q * 1000) / 1000) : q;
  if (!/^-?\d{1,7}(\.\d{1,3})?$/.test(s)) throw new Error(`invalid qty: ${s}`);
  return s;
}

const num = (v: unknown, name: string): number => {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`${name} must be an integer number of cents`);
  return v;
};

/**
 * Map an arbitrary POS sale object to a Draft. Whitelist only: unknown fields (customerName, loyaltyCard,
 * pan, email…) are never copied, so they can never reach a signed payload.
 */
export function mapPosSale(sale: Record<string, unknown>): Draft {
  const state = sale.state === 'open' || sale.state === 'paid' ? sale.state : 'presented';
  const rawLines = Array.isArray(sale.lines) ? sale.lines : [];
  const lines: DraftLine[] = rawLines.map((raw: unknown) => {
    const l = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const rate = l.vatRate;
    if (rate !== 21 && rate !== 9 && rate !== 0 && rate !== null) throw new Error('vatRate must be 21, 9, 0 or null');
    const kind = l.kind === 'discount' || l.kind === 'deposit' ? l.kind : 'item';
    return {
      sku: typeof l.sku === 'string' ? l.sku.slice(0, 40) : null,
      description: scrubDescription(typeof l.description === 'string' ? l.description : ''),
      qty: typeof l.qty === 'string' || typeof l.qty === 'number' ? l.qty : 1,
      unitPrice: num(l.unitPrice, 'unitPrice'),
      vatRate: rate,
      discount: typeof l.discount === 'number' ? num(l.discount, 'discount') : 0,
      kind,
      category: typeof l.category === 'string' ? l.category.slice(0, 40) : null,
    };
  });
  const payments = Array.isArray(sale.payments)
    ? sale.payments.map((raw: unknown) => {
        const p = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
        const method = p.method === 'cash' || p.method === 'other' ? p.method : 'card';
        return { method, ...(typeof p.amount === 'number' ? { amount: num(p.amount, 'amount') } : {}) } as DraftPayment;
      })
    : undefined;
  return {
    state,
    lines,
    ...(payments ? { payments } : {}),
    ...(typeof sale.tip === 'number' ? { tip: num(sale.tip, 'tip') } : {}),
  };
}

export { toQty };
