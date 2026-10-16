import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSecret, newReceiptId } from '@lr/crypto';
import type { Crf } from '@lr/schema';
import { buildCrf, createWorld, submit, sql, type OrgFixture, type World } from '../../../scripts/lib/testkit.ts';

type State = Crf['state'];
const STATES: State[] = ['open', 'presented', 'paid', 'fiscalised', 'void'];

/**
 * v2 §6, written down independently of `@lr/receipt-nl`:
 *   open→presented, presented→presented, open|presented→paid, paid→fiscalised (non-NL only), any→void.
 *   A receipt may start at open, presented or paid.
 */
const ALLOWED: Record<string, State[]> = {
  open: ['presented', 'paid', 'void'],
  presented: ['presented', 'paid', 'void'],
  paid: ['fiscalised', 'void'],
  fiscalised: ['void'],
  void: [],
};
const START: State[] = ['open', 'presented', 'paid'];

let w: World;
let de: OrgFixture;

beforeAll(async () => {
  w = await createWorld();
  de = await w.addOrg({ country: 'DE' });
}, 120_000);
afterAll(async () => {
  await w.close();
});

/** Put a receipt into `target` through the real API by walking the shortest legal path. */
async function receiptIn(org: OrgFixture, target: State): Promise<{ receiptId: string; version: number }> {
  const receiptId = newReceiptId();
  const secret = generateSecret();
  const path: Record<State, State[]> = {
    open: ['open'],
    presented: ['presented'],
    paid: ['paid'],
    fiscalised: ['paid', 'fiscalised'],
    void: ['presented', 'void'],
  };
  let version = 0;
  for (const state of path[target]) {
    version++;
    const res = await submit(w.merchant, org, buildCrf({ receiptId, version, state, org }), version === 1 ? { secret } : {});
    expect(res.status, `setup ${state} v${version}: ${res.text}`).toBe(201);
  }
  return { receiptId, version };
}

async function stored(receiptId: string) {
  const [r] = await sql<{ state: string; current_version: number }>(w, 'select state, current_version from merchant.receipts where id = $1', [receiptId]);
  const [v] = await sql<{ n: number }>(w, 'select count(*)::int n from merchant.receipt_versions where receipt_id = $1', [receiptId]);
  return { state: r?.state, currentVersion: r?.current_version, versions: v?.n };
}

describe('lifecycle: NL organisation', () => {
  const pairs = (['open', 'presented', 'paid', 'void'] as const).flatMap((from) => STATES.map((to) => ({ from, to })));

  it.each(pairs)('$from → $to', async ({ from, to }) => {
    const start = await receiptIn(w.orgA, from);
    const res = await submit(w.merchant, w.orgA, buildCrf({ receiptId: start.receiptId, version: start.version + 1, state: to, org: w.orgA }));
    const before = { state: from, currentVersion: start.version, versions: start.version };

    if (to === 'fiscalised') {
      // §5/§6: fiscalised is rejected for NL organisations, from every state
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ error: 'invalid_receipt', issues: [{ code: 'fiscalised_not_allowed_nl' }] });
      expect(await stored(start.receiptId)).toEqual(before);
    } else if (ALLOWED[from]?.includes(to)) {
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ receiptId: start.receiptId, version: start.version + 1, status: 'created' });
      expect(await stored(start.receiptId)).toEqual({ state: to, currentVersion: start.version + 1, versions: start.version + 1 });
    } else {
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: 'bad_transition' });
      expect(await stored(start.receiptId)).toEqual(before);
    }
  });

  it.each(STATES)('a receipt starting at %s', async (state) => {
    const receiptId = newReceiptId();
    const crf = buildCrf({ receiptId, version: 1, state, org: w.orgA, voidOf: state === 'void' ? newReceiptId() : null });
    const res = await submit(w.merchant, w.orgA, crf, { secret: generateSecret() });
    if (START.includes(state)) {
      expect(res.status).toBe(201);
      expect((await stored(receiptId)).state).toBe(state);
    } else {
      expect(res.status).toBe(422);
      expect(await stored(receiptId)).toEqual({ state: undefined, currentVersion: undefined, versions: 0 });
    }
  });

  it('presented → presented repeatedly keeps creating versions', async () => {
    const start = await receiptIn(w.orgA, 'presented');
    for (let v = 2; v <= 4; v++) {
      const res = await submit(w.merchant, w.orgA, buildCrf({ receiptId: start.receiptId, version: v, state: 'presented', org: w.orgA, lines: [{ unitPrice: 100 * v, vatRate: 21 }] }));
      expect(res.status).toBe(201);
    }
    expect(await stored(start.receiptId)).toEqual({ state: 'presented', currentVersion: 4, versions: 4 });
  });

  it('a rejected transition does not consume the version number', async () => {
    const start = await receiptIn(w.orgA, 'void');
    const bad = await submit(w.merchant, w.orgA, buildCrf({ receiptId: start.receiptId, version: 3, state: 'paid', org: w.orgA }));
    expect(bad.status).toBe(409);
    // a void receipt is terminal: nothing can follow it
    const again = await submit(w.merchant, w.orgA, buildCrf({ receiptId: start.receiptId, version: 3, state: 'void', org: w.orgA }));
    expect(again.status).toBe(409);
    expect((await stored(start.receiptId)).currentVersion).toBe(2);
  });

  it('void is reachable from every non-void state (any → void)', async () => {
    for (const from of ['open', 'presented', 'paid'] as const) {
      const start = await receiptIn(w.orgA, from);
      const res = await submit(w.merchant, w.orgA, buildCrf({ receiptId: start.receiptId, version: start.version + 1, state: 'void', org: w.orgA }));
      expect(res.status, `${from} → void`).toBe(201);
    }
  });

  it('each accepted version after v1 enqueues exactly one notify-version job; rejected ones enqueue none', async () => {
    const before = w.jobs.length;
    const start = await receiptIn(w.orgA, 'presented'); // v1: no job
    expect(w.jobs.length).toBe(before);
    await submit(w.merchant, w.orgA, buildCrf({ receiptId: start.receiptId, version: 2, state: 'paid', org: w.orgA }));
    expect(w.jobs.length).toBe(before + 1);
    expect(w.jobs.at(-1)).toMatchObject({ name: 'notify-version', data: { receiptId: start.receiptId, version: 2, state: 'paid' } });
    await submit(w.merchant, w.orgA, buildCrf({ receiptId: start.receiptId, version: 3, state: 'presented', org: w.orgA })); // paid → presented: rejected
    expect(w.jobs.length).toBe(before + 1);
  });
});

describe('lifecycle: non-NL organisation keeps fiscalised', () => {
  const pairs = STATES.flatMap((from) => STATES.map((to) => ({ from, to })));

  it.each(pairs)('DE: $from → $to', async ({ from, to }) => {
    const start = await receiptIn(de, from);
    const res = await submit(w.merchant, de, buildCrf({ receiptId: start.receiptId, version: start.version + 1, state: to, org: de }));
    if (ALLOWED[from]?.includes(to)) {
      expect(res.status).toBe(201);
      expect((await stored(start.receiptId)).state).toBe(to);
    } else {
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: 'bad_transition' });
    }
  });

  it('DE: a receipt cannot start at fiscalised', async () => {
    const res = await submit(w.merchant, de, buildCrf({ receiptId: newReceiptId(), version: 1, state: 'fiscalised', org: de }), { secret: generateSecret() });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'bad_transition' });
  });
});
