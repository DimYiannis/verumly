import { netPrice, type Interval, type Plan } from './plans.ts';

/** Dutch standard BTW rate on the subscription (B2B, the Netherlands). EU reverse charge is not handled. */
export const VAT_RATE = 21;

export interface Amounts {
  net: number;
  vat: number;
  gross: number;
}

/** `vat = round(net × 21 / 100)` half-up (cents are non-negative), `gross = net + vat`. */
export function vatSplit(net: number, rate = VAT_RATE): Amounts {
  if (!Number.isInteger(net) || net < 0) throw new Error('net must be a non-negative integer number of cents');
  const vat = Math.floor((net * rate * 2 + 100) / 200);
  return { net, vat, gross: net + vat };
}

/** Net, BTW and total for one period of a plan. */
export function priceFor(plan: Plan, interval: Interval): Amounts {
  return vatSplit(netPrice(plan, interval));
}
