import { describe, expect, it } from 'vitest';
import { generateKeyPair, hashSecret, jcsString, verifyPayload } from '@lr/crypto';
import { validateCrf } from '@lr/receipt-nl';
import { FORBIDDEN_CRF_KEYS } from '@lr/schema';
import { mapPosSale, MemoryStore, scrubCode, scrubDescription } from '../src/index.ts';
import { sdkFor } from './support.ts';

/** Every string the CRF carries, with its path; ids, timestamps and signatures are skipped (random hex could collide with a digit run). */
function leaves(value: unknown, path = ''): Array<{ path: string; text: string }> {
  if (typeof value === 'string') return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (typeof value === 'object' && value !== null) return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}
const isIdOrTime = (text: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(text) || /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(text);
const keysOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.flatMap(keysOf) : typeof value === 'object' && value !== null ? Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]) : [];

// A POS sale as a till might export it: identifiers everywhere the mapping must not copy or must scrub.
const POS_SALE = {
  state: 'paid',
  customerName: 'Jan Jansen',
  customer: { name: 'Jan Jansen', email: 'jan.jansen@example.test', phone: '+31612345678' },
  loyaltyCard: '2900012345678',
  loyaltyCardNumber: '2900012345678',
  note: 'klant: Jan Jansen, pas 2900012345678',
  cardPan: '4111111111111111',
  maskedPan: '****7391',
  lines: [
    { sku: 'KOF', description: 'Koffie ****7391', qty: 2, unitPrice: 340, vatRate: 9, category: 'dining', customerName: 'Jan Jansen', loyaltyCard: '2900012345678' },
    { sku: '8712345678906', description: 'Bonus pas 2900 0123 4567 8', qty: 1, unitPrice: 450, vatRate: 21, category: 'dining' },
    { sku: '****7391', description: '4111 **** **** 1111', qty: 1, unitPrice: 100, vatRate: 21, category: 'card XXXX-XXXX-XXXX-7391' },
  ],
  payments: [{ method: 'card', amount: 1230, pan: '4111 **** **** 1111', maskedPan: '****7391', cardholder: 'J JANSEN', last4: '7391', loyaltyCard: '2900012345678' }],
};
const FORBIDDEN_TEXT = ['Jan', 'Jansen', 'JANSEN', '4111', '1111', '7391', '2900012345678', '2900 0123', '****', 'XXXX', 'jan.jansen', 'example.test', '+316', 'klant', 'cardholder'];

describe('POS sale → draft: whitelist mapping', () => {
  it('copies only known fields; unknown keys never reach the draft', () => {
    const draft = mapPosSale(POS_SALE);
    expect(Object.keys(draft).sort()).toEqual(['lines', 'payments', 'state']);
    for (const l of draft.lines) expect(Object.keys(l).sort()).toEqual(['category', 'description', 'discount', 'kind', 'qty', 'sku', 'unitPrice', 'vatRate']);
    expect(draft.payments?.map((p) => Object.keys(p).sort())).toEqual([['amount', 'method']]);
    expect(JSON.stringify(draft)).not.toMatch(/Jansen|2900012345678|4111|jan\.jansen/);
  });
});

describe('stripped before signing (v2 §2.2 / §16.E)', () => {
  async function signedFromPos() {
    const keys = generateKeyPair();
    const store = new MemoryStore();
    const sdk = sdkFor(store, { privateKey: keys.privateKey });
    const { receiptId, secret } = await sdk.createReceipt(mapPosSale(POS_SALE));
    const [item] = await store.pending(1);
    return { keys, item: item!, receiptId, secret };
  }

  it('the signed CRF JSON contains none of the card number, masked PANs, loyalty number, name, e-mail or phone', async () => {
    const { item } = await signedFromPos();
    const crfText = JSON.stringify(item.body.version);
    const canonical = jcsString(item.body.version);
    const wholeBody = JSON.stringify(item.body);
    const texts = leaves(item.body.version).filter((l) => !isIdOrTime(l.text));
    for (const needle of FORBIDDEN_TEXT) {
      for (const l of texts) expect(l.text, `"${needle}" found in ${l.path}`).not.toContain(needle);
    }
    // the digits of the card/loyalty numbers must not appear anywhere in the serialised payload either (numbers included)
    for (const digits of ['4111111111111111', '2900012345678', '29000123', '7391']) {
      expect(crfText.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '')).not.toContain(digits);
      expect(canonical.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '')).not.toContain(digits);
    }
    expect(wholeBody).not.toMatch(/Jansen/);
  });

  it('no forbidden key name appears anywhere in the signed payload', async () => {
    const { item } = await signedFromPos();
    const keys = keysOf(item.body.version).map((k) => k.toLowerCase());
    for (const forbidden of [...FORBIDDEN_CRF_KEYS, 'loyaltycardnumber', 'maskedpan', 'cardholder', 'last4']) expect(keys).not.toContain(forbidden.toLowerCase());
  });

  it('the stripped payload is what was signed: the signature verifies, and the CRF is valid', async () => {
    const { item, keys } = await signedFromPos();
    expect(verifyPayload(keys.publicKey, item.body.version, item.body.signature)).toBe(true);
    expect(validateCrf(item.body.version)).toEqual([]);
    // names/PANs removed, real content kept
    expect(item.body.version.lines.map((l) => l.description)).toEqual(['Koffie', 'Bonus pas', 'Artikel']);
    expect(item.body.version.totals.gross).toBe(2 * 340 + 450 + 100);
  });

  it('a long-digit sku (EAN-13) is kept, a masked-PAN sku or category is scrubbed', async () => {
    const { item } = await signedFromPos();
    expect(item.body.version.lines.map((l) => l.sku)).toEqual(['KOF', '8712345678906', null]);
    expect(item.body.version.lines.map((l) => l.category)).toEqual(['dining', 'dining', 'card']);
  });

  it('the claim secret never enters the payload or the outbox body: only its sha256 does', async () => {
    const { item, secret } = await signedFromPos();
    expect(JSON.stringify(item.body)).not.toContain(secret);
    expect(item.body.claimSecretHash).toBe(hashSecret(secret));
    expect(item.idempotencyKey).not.toContain(secret);
  });

  it('later versions are re-scrubbed too (addVersion with a patched line carrying a PAN)', async () => {
    const store = new MemoryStore();
    const sdk = sdkFor(store);
    const { receiptId } = await sdk.createReceipt({ state: 'presented', lines: [{ description: 'Koffie', unitPrice: 340, vatRate: 9 }] });
    await sdk.addVersion(receiptId, { lines: [{ description: 'Koffie pas 4111 **** **** 1111', sku: 'XXXX1111', unitPrice: 340, vatRate: 9, category: '****7391' }] });
    const v2 = (await store.pending(2))[1]!;
    expect(v2.body.version.lines[0]).toMatchObject({ description: 'Koffie pas', sku: null, category: null });
  });
});

describe('scrubDescription / scrubCode', () => {
  it.each([
    ['Koffie ****1234', 'Koffie'],
    ['Kaart XXXX-XXXX-XXXX-1234', 'Kaart'],
    ['Visa **** **** **** 1111', 'Visa'],
    ['Pas 4111 **** **** 1111 pin', 'Pas pin'],
    ['Koffie •••• 1234', 'Koffie'],
    ['xxxx1234 Bier', 'Bier'],
    ['Bonuskaart 2900012345678', 'Bonuskaart'],
    ['Bonuskaart 2900 0123 4567 8', 'Bonuskaart'],
    ['Pas 4111-1111-1111-1111', 'Pas'],
    ['PAN 4111111111111111', 'PAN'],
    ['Appel 3 stuks 1,50', 'Appel 3 stuks 1,50'],
    ['EAN 8712345', 'EAN 8712345'],
    ['EAN 87123456', 'EAN'],
    ['', 'Artikel'],
    ['****7391', 'Artikel'],
    ['   ', 'Artikel'],
  ])('%j → %j', (input, expected) => {
    expect(scrubDescription(input)).toBe(expected);
  });

  it('clamps to 80 characters after scrubbing', () => {
    expect(scrubDescription('x'.repeat(200))).toHaveLength(80);
    expect(scrubDescription(`${'x'.repeat(70)} ****1234 ${'y'.repeat(30)}`).length).toBeLessThanOrEqual(80);
  });

  it('scrubCode keeps EAN-length digits but drops masked PANs; empty → null', () => {
    expect(scrubCode('8712345678906')).toBe('8712345678906');
    expect(scrubCode('****7391')).toBeNull();
    expect(scrubCode(null)).toBeNull();
    expect(scrubCode('  ')).toBeNull();
    expect(scrubCode('x'.repeat(60))).toHaveLength(40);
  });

  it('documented limit: a customer NAME typed into the description text cannot be recognised and is kept', () => {
    // the name is dropped when it arrives as a field (see the whitelist test) but free prose cannot be detected
    expect(scrubDescription('Taart voor Jan Jansen')).toBe('Taart voor Jan Jansen');
  });

  it('a masked PAN that keeps its BIN leaves only the 6 BIN digits (never the last four)', () => {
    const out = scrubDescription('Koffie 4111 11** **** 1111');
    expect(out).not.toContain('1111');
  });
});

describe('scrubbing cannot hang the till', () => {
  it.each(['x', 'X', '*', '•', '#', 'x ', '* ', 'x-', '1 ', '1-'])('%j repeated thousands of times is scrubbed in well under a second', (unit) => {
    for (const text of [unit.repeat(5000), `${unit.repeat(3000)}!`, `${unit.repeat(3000)}1`]) {
      const t0 = performance.now();
      scrubDescription(text);
      scrubCode(text);
      expect(performance.now() - t0).toBeLessThan(500);
    }
  });
});
