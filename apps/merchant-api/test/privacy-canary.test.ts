import { describe, expect, it } from 'vitest';
import { countHits, runCanary } from '../../../scripts/privacy-canary.ts';

describe('privacy canary (v2 §16.E): zero hits for e-mail, secret, user id and session token on the merchant side', () => {
  it('journey with a unique canary e-mail: logs, pg_dump of merchant/ops/pgboss and every merchant-side response are clean', async () => {
    const report = await runCanary({ print: false });
    expect(report.leaks).toEqual([]);
    // 7 needles × 5 haystacks, each actually searched
    expect(report.hits).toHaveLength(35);
    for (const h of report.haystacks) expect(h.bytes, `${h.name} is empty: nothing was searched`).toBeGreaterThan(500);
    // positive controls: the search can see a leak, the logs/dumps/responses really were read
    expect(report.controls.filter((c) => !c.ok)).toEqual([]);
    expect(report.controls.length).toBeGreaterThanOrEqual(6);
  }, 120_000);

  it('the detector finds needles in plain, URL-encoded, JSON-escaped and differently-cased text, and nothing in unrelated text', () => {
    const email = 'Canary+tag@Example.test';
    expect(countHits(`x ${email} y`, email)).toBe(1);
    expect(countHits(`?e=${encodeURIComponent(email)}`, email)).toBeGreaterThanOrEqual(1);
    expect(countHits(JSON.stringify({ a: 'q"uote', e: email }), email)).toBeGreaterThanOrEqual(1);
    expect(countHits(email.toLowerCase(), email)).toBe(1);
    expect(countHits('nothing to see here', email)).toBe(0);
    expect(countHits(`${email} and ${email}`, email)).toBe(2);
  });
});
