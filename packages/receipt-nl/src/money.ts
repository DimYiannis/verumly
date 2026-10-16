/** Integer euro-cent arithmetic. Rounding is half away from zero (symmetric for returns). */

/** round(num/den) to nearest integer, ties away from zero. den > 0. */
export function divRoundHalfUp(num: bigint, den: bigint): number {
  if (den <= 0n) throw new Error('denominator must be positive');
  const neg = num < 0n;
  const n = neg ? -num : num;
  const q = (2n * n + den) / (2n * den);
  return Number(neg ? -q : q);
}

/** qty is a decimal string with at most 3 decimals; returns milli-units. */
export function qtyToMilli(qty: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(qty);
  if (!m) throw new Error(`invalid qty: ${qty}`);
  const milli = BigInt(m[2]!) * 1000n + BigInt((m[3] ?? '').padEnd(3, '0') || '0');
  return m[1] ? -milli : milli;
}

/** total = roundHalfUp(qty × unitPrice) − discount. Prices include VAT. */
export function lineTotal(qty: string, unitPrice: number, discount: number): number {
  return divRoundHalfUp(qtyToMilli(qty) * BigInt(unitPrice), 1000n) - discount;
}

/** vat = roundHalfUp(rateGross × r / (100 + r)); net = rateGross − vat. Rounded per rate total. */
export function vatFromGross(gross: number, rate: number): { net: number; vat: number } {
  const vat = divRoundHalfUp(BigInt(gross) * BigInt(rate), BigInt(100 + rate));
  return { net: gross - vat, vat };
}

/** Round cents to nearest 5 cents (Dutch cash rounding); returns the signed rounding delta. */
export function cashRounding(gross: number): number {
  const rounded = divRoundHalfUp(BigInt(gross), 5n) * 5;
  return rounded - gross;
}

export function formatEuro(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}€${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}
