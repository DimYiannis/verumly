import { describe, expect, it } from 'vitest';
import {
  addInterval,
  amsterdamYear,
  annualSaving,
  CATALOGUE,
  checkLimit,
  daysLeft,
  demoProvider,
  effectivePlan,
  expiryValid,
  IDEAL_BANKS,
  IDEAL_DECLINE_BANK,
  luhnValid,
  methodLabel,
  methodProblems,
  monthlyEquivalent,
  paymentProvider,
  priceFor,
  TEST_CARDS,
  vatSplit,
  type Charge,
} from '../src/index.ts';

const NOW = new Date('2026-10-17T10:00:00Z');
const charge: Charge = { amounts: priceFor('business', 'monthly'), currency: 'EUR', description: 'test' };

describe('prices and BTW', () => {
  it('catalogue: starter €19 / €190, business €49 / €490 excl. BTW; annual is two months free', () => {
    expect(CATALOGUE.starter.prices).toEqual({ monthly: 1900, annual: 19000 });
    expect(CATALOGUE.business.prices).toEqual({ monthly: 4900, annual: 49000 });
    expect(annualSaving('starter')).toBe(2 * 1900);
    expect(annualSaving('business')).toBe(2 * 4900);
    expect(monthlyEquivalent('starter')).toBe(1583); // 190 / 12 = 15.8333
    expect(monthlyEquivalent('business')).toBe(4083); // 490 / 12 = 40.8333
  });

  it('BTW 21% on top, half-up, gross = net + vat', () => {
    expect(priceFor('starter', 'monthly')).toEqual({ net: 1900, vat: 399, gross: 2299 });
    expect(priceFor('starter', 'annual')).toEqual({ net: 19000, vat: 3990, gross: 22990 });
    expect(priceFor('business', 'monthly')).toEqual({ net: 4900, vat: 1029, gross: 5929 });
    expect(priceFor('business', 'annual')).toEqual({ net: 49000, vat: 10290, gross: 59290 });
    expect(vatSplit(50)).toEqual({ net: 50, vat: 11, gross: 61 }); // 10.5 → 11 (half-up)
    expect(vatSplit(2)).toEqual({ net: 2, vat: 0, gross: 2 }); // 0.42 → 0
    expect(vatSplit(0)).toEqual({ net: 0, vat: 0, gross: 0 });
    expect(() => vatSplit(-1)).toThrow();
    expect(() => vatSplit(1.5)).toThrow();
  });
});

describe('period math (Europe/Amsterdam wall clock)', () => {
  const ams = (iso: string) => new Date(iso); // iso strings below carry their own offset
  it('monthly adds one calendar month, clamped to the end of the month', () => {
    expect(addInterval(ams('2026-01-31T10:00:00+01:00'), 'monthly').toISOString()).toBe(new Date('2026-02-28T10:00:00+01:00').toISOString());
    expect(addInterval(ams('2028-01-31T10:00:00+01:00'), 'monthly').toISOString()).toBe(new Date('2028-02-29T10:00:00+01:00').toISOString());
    expect(addInterval(ams('2026-03-31T10:00:00+02:00'), 'monthly').toISOString()).toBe(new Date('2026-04-30T10:00:00+02:00').toISOString());
    expect(addInterval(ams('2026-12-15T09:30:00+01:00'), 'monthly').toISOString()).toBe(new Date('2027-01-15T09:30:00+01:00').toISOString());
  });

  it('keeps the Amsterdam wall time across summer time, and uses the Amsterdam date near midnight', () => {
    // 15 Mar 12:00 CET → 15 Apr 12:00 CEST (one hour less in UTC)
    expect(addInterval(ams('2026-03-15T12:00:00+01:00'), 'monthly').toISOString()).toBe('2026-04-15T10:00:00.000Z');
    // 31 Jan 00:30 Amsterdam is still 30 Jan in UTC: the Amsterdam date decides (→ 28 Feb, not 2 Mar or 28 Feb UTC)
    expect(addInterval(ams('2026-01-31T00:30:00+01:00'), 'monthly').toISOString()).toBe(new Date('2026-02-28T00:30:00+01:00').toISOString());
  });

  it('annual adds one year; 29 Feb becomes 28 Feb', () => {
    expect(addInterval(ams('2028-02-29T10:00:00+01:00'), 'annual').toISOString()).toBe(new Date('2029-02-28T10:00:00+01:00').toISOString());
    expect(addInterval(ams('2026-10-17T12:00:00+02:00'), 'annual').toISOString()).toBe(new Date('2027-10-17T12:00:00+02:00').toISOString());
  });

  it('Amsterdam year and days left', () => {
    expect(amsterdamYear(new Date('2026-12-31T23:30:00Z'))).toBe(2027);
    expect(daysLeft(new Date(NOW.getTime() + 2.5 * 86_400_000), NOW)).toBe(3);
    expect(daysLeft(new Date(NOW.getTime() - 1000), NOW)).toBe(0);
  });
});

describe('plan limits', () => {
  it('starter: 1 location, 2 active terminals; business unlimited; trial gets business; canceled gets nothing', () => {
    const starter = { status: 'active', plan: 'starter' } as const;
    expect(checkLimit(starter, 'locations', 0)).toEqual({ ok: true });
    expect(checkLimit(starter, 'locations', 1)).toEqual({ ok: false, reason: 'plan_limit', limit: 1 });
    expect(checkLimit(starter, 'activeTerminals', 1)).toEqual({ ok: true });
    expect(checkLimit(starter, 'activeTerminals', 2)).toEqual({ ok: false, reason: 'plan_limit', limit: 2 });
    expect(checkLimit({ status: 'active', plan: 'business' }, 'activeTerminals', 500)).toEqual({ ok: true });
    expect(checkLimit({ status: 'trialing', plan: 'starter' }, 'locations', 10)).toEqual({ ok: true });
    expect(checkLimit({ status: 'past_due', plan: 'starter' }, 'locations', 1)).toMatchObject({ reason: 'plan_limit' });
    expect(checkLimit({ status: 'canceled', plan: 'business' }, 'locations', 0)).toEqual({ ok: false, reason: 'plan_inactive' });
    expect(effectivePlan({ status: 'trialing', plan: 'starter' })).toBe('business');
    expect(effectivePlan({ status: 'canceled', plan: 'business' })).toBeNull();
  });
});

describe('demo test inputs', () => {
  it('validates card format: Luhn, future expiry, 3-digit CVC', () => {
    for (const n of Object.values(TEST_CARDS)) expect(luhnValid(n), n).toBe(true);
    expect(luhnValid('4242424242424241')).toBe(false);
    expect(methodProblems({ method: 'card', number: '4242 4242 4242 4242', expiry: '12/30', cvc: '123' }, NOW)).toEqual([]);
    expect(methodProblems({ method: 'card', number: '4242 4242 4242 4241', expiry: '12/30', cvc: '123' }, NOW)).toEqual(['card_number']);
    expect(methodProblems({ method: 'card', number: '4242', expiry: '09/26', cvc: '12' }, NOW)).toEqual(['card_number', 'card_expiry', 'card_cvc']);
    expect(expiryValid('10/26', NOW)).toBe(true); // valid through the end of October
    expect(expiryValid('09/26', NOW)).toBe(false);
    expect(expiryValid('13/30', NOW)).toBe(false);
    expect(expiryValid('12/2030', NOW)).toBe(true);
    expect(methodProblems({ method: 'card', number: '4242424242424242', expiry: '12/30', cvc: '1234' }, NOW)).toEqual(['card_cvc']);
  });

  it('validates the iDEAL bank against the list (plus the decline bank)', () => {
    for (const bank of [...IDEAL_BANKS, IDEAL_DECLINE_BANK]) expect(methodProblems({ method: 'ideal', bank }, NOW)).toEqual([]);
    expect(methodProblems({ method: 'ideal', bank: 'Unknown Bank' }, NOW)).toEqual(['ideal_bank']);
  });

  it('labels never hold the full card number', () => {
    expect(methodLabel({ method: 'card', number: '4242 4242 4242 4242', expiry: '12/30', cvc: '123' })).toBe('Card •••• 4242');
    expect(methodLabel({ method: 'ideal', bank: 'ING' })).toBe('iDEAL · ING');
  });

  it('card 4242 pays and renews; 0341 pays but renewals fail; 0002 is declined', async () => {
    const card = (number: string) => ({ method: 'card' as const, number, expiry: '12/30', cvc: '123' });
    const ok = await demoProvider.firstPayment(charge, card('4242 4242 4242 4242'));
    expect(ok).toEqual({ status: 'paid', mandate: { method: 'card', label: 'Card •••• 4242', failsRenewals: false } });
    if (ok.status === 'paid') expect(await demoProvider.chargeMandate(charge, ok.mandate)).toEqual({ status: 'paid' });

    const flaky = await demoProvider.firstPayment(charge, card('4000 0000 0000 0341'));
    expect(flaky).toEqual({ status: 'paid', mandate: { method: 'card', label: 'Card •••• 0341', failsRenewals: true } });
    if (flaky.status === 'paid') expect(await demoProvider.chargeMandate(charge, flaky.mandate)).toEqual({ status: 'failed', reason: 'renewal_declined' });

    expect(await demoProvider.firstPayment(charge, card('4000 0000 0000 0002'))).toEqual({ status: 'failed', reason: 'card_declined' });
  });

  it('iDEAL: any listed bank pays, "Demo: weigeren" declines', async () => {
    expect(await demoProvider.firstPayment(charge, { method: 'ideal', bank: 'Rabobank' })).toEqual({ status: 'paid', mandate: { method: 'ideal', label: 'iDEAL · Rabobank', failsRenewals: false } });
    expect(await demoProvider.firstPayment(charge, { method: 'ideal', bank: IDEAL_DECLINE_BANK })).toEqual({ status: 'failed', reason: 'ideal_declined' });
  });

  it('only the demo provider exists', () => {
    expect(paymentProvider('demo')).toBe(demoProvider);
    expect(() => paymentProvider('mollie' as never)).toThrow(/unknown billing provider/);
  });
});
