import { expect, it } from 'vitest';
import { runJourney } from '../../../scripts/journey.ts';

it('golden journey (v2 §16.A): all six hops pass against real Postgres, Mailpit and real HTTP services', async () => {
  const r = await runJourney({ print: false });
  try {
    expect(r.hops).toHaveLength(6);
    expect(r.hops.map((h) => h.status)).not.toContain('FAILED');
    expect(r.hops[0]?.name).toMatch(/^1\. /);
    expect(r.hops[5]?.status).toContain('BTW 9%: 680/624/56');
    expect(r.hops[4]?.status).toContain('2 notify-version jobs');
    expect(r.merchantSideResponses.length).toBeGreaterThan(3);
  } finally {
    await r.stack.stopAll();
  }
}, 120_000);
