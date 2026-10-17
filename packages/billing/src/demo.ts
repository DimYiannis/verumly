import type { FirstPaymentResult, MethodInput, PaymentProvider, RenewalResult } from './provider.ts';

/** Banks on the demo iDEAL page. */
export const IDEAL_BANKS = ['ABN AMRO', 'ING', 'Rabobank', 'ASN Bank', 'bunq', 'Knab', 'SNS', 'Triodos'] as const;
/** The demo "bank" that refuses the payment. */
export const IDEAL_DECLINE_BANK = 'Demo: weigeren';

/** Demo test cards (any future expiry, any 3-digit CVC). Every other valid card number pays and renews. */
export const TEST_CARDS = {
  /** paid; renewals succeed */
  success: '4242424242424242',
  /** first payment succeeds, renewals fail (shows past_due) */
  renewalsFail: '4000000000000341',
  /** declined */
  declined: '4000000000000002',
} as const;

export type MethodProblem = 'card_number' | 'card_expiry' | 'card_cvc' | 'ideal_bank';

const digitsOf = (s: string) => s.replace(/[\s-]/g, '');

/** Luhn checksum over a string of digits. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** `MM/YY` (or `MM/YYYY`), valid through the end of that month. */
export function expiryValid(expiry: string, now: Date): boolean {
  const m = /^\s*(\d{2})\s*\/\s*(\d{2}|\d{4})\s*$/.exec(expiry);
  if (!m) return false;
  const month = Number(m[1]);
  const year = m[2]!.length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  if (month < 1 || month > 12) return false;
  return Date.UTC(year, month, 1) > now.getTime();
}

/** Format checks the checkout page and the server both run. Empty list: the input is well-formed. */
export function methodProblems(input: MethodInput, now: Date): MethodProblem[] {
  if (input.method === 'ideal') return [...IDEAL_BANKS, IDEAL_DECLINE_BANK].includes(input.bank) ? [] : ['ideal_bank'];
  const problems: MethodProblem[] = [];
  const digits = digitsOf(input.number);
  if (digits.length < 12 || digits.length > 19 || !luhnValid(digits)) problems.push('card_number');
  if (!expiryValid(input.expiry, now)) problems.push('card_expiry');
  if (!/^\d{3}$/.test(input.cvc.trim())) problems.push('card_cvc');
  return problems;
}

/** The label stored for a method: never the full card number. */
export function methodLabel(input: MethodInput): string {
  return input.method === 'ideal' ? `iDEAL · ${input.bank}` : `Card •••• ${digitsOf(input.number).slice(-4)}`;
}

/**
 * Demo provider: no money moves, nothing leaves the process. The outcome depends only on the test inputs above.
 * Inputs must have passed `methodProblems` (the caller validates first).
 */
export const demoProvider: PaymentProvider = {
  id: 'demo',
  async firstPayment(_charge, input): Promise<FirstPaymentResult> {
    if (input.method === 'ideal') {
      if (input.bank === IDEAL_DECLINE_BANK) return { status: 'failed', reason: 'ideal_declined' };
      return { status: 'paid', mandate: { method: 'ideal', label: methodLabel(input), failsRenewals: false } };
    }
    const digits = digitsOf(input.number);
    if (digits === TEST_CARDS.declined) return { status: 'failed', reason: 'card_declined' };
    return { status: 'paid', mandate: { method: 'card', label: methodLabel(input), failsRenewals: digits === TEST_CARDS.renewalsFail } };
  },
  async chargeMandate(_charge, mandate): Promise<RenewalResult> {
    return mandate.failsRenewals ? { status: 'failed', reason: 'renewal_declined' } : { status: 'paid' };
  },
};

export const BILLING_PROVIDERS = ['demo'] as const;
export type BillingProviderName = (typeof BILLING_PROVIDERS)[number];

/** The provider for `BILLING_PROVIDER` (only `demo` exists). */
export function paymentProvider(name: BillingProviderName): PaymentProvider {
  if (name !== 'demo') throw new Error(`unknown billing provider: ${String(name)}`);
  return demoProvider;
}
