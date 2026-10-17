import type { Amounts } from './money.ts';

export const PAYMENT_METHODS = ['ideal', 'card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * What the buyer of the subscription typed on the checkout page. Card details only pass through the provider call:
 * they are never stored or logged (only the method label is kept).
 */
export type MethodInput = { method: 'card'; number: string; expiry: string; cvc: string } | { method: 'ideal'; bank: string };

/** A stored recurring-payment authorisation. `failsRenewals` is a demo flag (test card 0341). */
export interface Mandate {
  method: PaymentMethod;
  /** `iDEAL · ING`, `Card •••• 4242`: the only payment detail we keep */
  label: string;
  failsRenewals: boolean;
}

export interface Charge {
  amounts: Amounts;
  currency: 'EUR';
  description: string;
}

export type FirstPaymentResult = { status: 'paid'; mandate: Mandate } | { status: 'failed'; reason: string };
export type RenewalResult = { status: 'paid' } | { status: 'failed'; reason: string };

/**
 * A payment service provider. Only the demo provider exists; a real one (Mollie: iDEAL first payment that creates a
 * SEPA mandate, then recurring charges) implements the same two calls.
 */
export interface PaymentProvider {
  readonly id: string;
  /** The first payment of a checkout; on success it also yields the mandate for renewals. */
  firstPayment(charge: Charge, input: MethodInput): Promise<FirstPaymentResult>;
  /** A renewal charged on a stored mandate, without the customer present. */
  chargeMandate(charge: Charge, mandate: Mandate): Promise<RenewalResult>;
}
