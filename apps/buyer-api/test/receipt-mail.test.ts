import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buyerCall, createReceipt, createWorld, sql, type World } from '../../../scripts/lib/testkit.ts';

let w: World;
beforeAll(async () => {
  w = await createWorld({ resolveRatePerMinute: 10_000 });
}, 120_000);
afterAll(async () => {
  await w.close();
});

const mail = (body: unknown) => buyerCall(w, 'POST', '/v1/receipts/mail', { body });

describe('POST /v1/receipts/mail: "send me this receipt" at the till', () => {
  it('sends the link (with the secret in the fragment) to the address, in the asked language', async () => {
    const r = await createReceipt(w, w.orgA, { state: 'paid' });
    const before = w.receiptMails.length;
    const res = await mail({ receiptId: r.receiptId, secret: r.secret, email: 'klant@example.test', locale: 'nl' });
    expect(res.status).toBe(202);
    expect(w.receiptMails).toHaveLength(before + 1);
    const sent = w.receiptMails.at(-1)!;
    expect(sent).toMatchObject({ to: 'klant@example.test', locale: 'nl', url: `http://localhost:3001/r/${r.receiptId}#${r.secret}` });
    expect(sent.merchantName).toBeTruthy();
  });

  it('works for a pre-bill too; an open receipt is not visible yet (409), and nothing is sent', async () => {
    const pre = await createReceipt(w, w.orgA, { state: 'presented' });
    expect((await mail({ receiptId: pre.receiptId, secret: pre.secret, email: 'a@example.test' })).status).toBe(202);
    const open = await createReceipt(w, w.orgA, { state: 'open' });
    const n = w.receiptMails.length;
    expect((await mail({ receiptId: open.receiptId, secret: open.secret, email: 'b@example.test' })).status).toBe(409);
    expect(w.receiptMails).toHaveLength(n);
  });

  it('needs the secret: a wrong one is 404 and sends nothing; so is an unknown receipt id (409 pending, like the resolver)', async () => {
    const r = await createReceipt(w, w.orgA, { state: 'paid' });
    const n = w.receiptMails.length;
    const other = await createReceipt(w, w.orgA, { state: 'paid' });
    expect((await mail({ receiptId: r.receiptId, secret: other.secret, email: 'c@example.test' })).status).toBe(404);
    expect((await mail({ receiptId: '0190a0a0-0000-7000-8000-000000000000', secret: r.secret, email: 'c@example.test' })).status).toBe(409);
    expect(w.receiptMails).toHaveLength(n);
  });

  it('validates the body strictly', async () => {
    const r = await createReceipt(w, w.orgA, { state: 'paid' });
    const base = { receiptId: r.receiptId, secret: r.secret };
    expect((await mail({ ...base, email: 'not-an-email' })).status).toBe(400);
    expect((await mail({ ...base, email: 'a@example.test', extra: 1 })).status).toBe(400);
    expect((await mail({ ...base, email: 'a@example.test', locale: 'fr' })).status).toBe(400);
    expect((await mail({ ...base })).status).toBe(400);
  });

  it('at most 3 mails per receipt per hour', async () => {
    const r = await createReceipt(w, w.orgA, { state: 'paid' });
    const send = () => mail({ receiptId: r.receiptId, secret: r.secret, email: 'many@example.test' });
    expect([(await send()).status, (await send()).status, (await send()).status]).toEqual([202, 202, 202]);
    expect((await send()).status).toBe(429);
  });

  it('keeps no trace of the address: not in the database, not in the logs, not on the merchant side', async () => {
    const r = await createReceipt(w, w.orgA, { state: 'paid' });
    const address = 'privacy-canary-7f3a@example.test';
    expect((await mail({ receiptId: r.receiptId, secret: r.secret, email: address })).status).toBe(202);
    // every text column of every schema we own, as one search
    const hits = await sql<{ t: string }>(
      w,
      `select table_schema || '.' || table_name as t from information_schema.columns
       where table_schema in ('merchant', 'buyer', 'leads', 'ops') and data_type in ('text', 'jsonb', 'character varying')`,
    );
    for (const { t } of hits) {
      const [schema, table] = t.split('.');
      const found = await sql(w, `select 1 from ${schema}."${table}" x where x::text like $1 limit 1`, [`%${address}%`]);
      expect(found, t).toHaveLength(0);
    }
    expect(w.logs.lines.join('')).not.toContain('privacy-canary-7f3a');
  });
});
