import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, sql, type World } from '../../../scripts/lib/testkit.ts';

const run = promisify(execFile);
const DEMO = fileURLToPath(new URL('../src/demo.ts', import.meta.url));

let w: World;
let apiBase = '';
beforeAll(async () => {
  w = await createWorld();
  await w.merchant.listen({ port: 0, host: '127.0.0.1' });
  const addr = w.merchant.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  apiBase = `http://127.0.0.1:${addr.port}`;
}, 120_000);
afterAll(async () => {
  await w.close();
});

describe('pnpm --filter @lr/terminal-sdk demo (v2 §8)', () => {
  it('without credentials: runs offline, prints the QR URL and leaves three versions queued', async () => {
    const { stdout } = await run(process.execPath, [DEMO], { env: { PATH: process.env.PATH ?? '' } });
    expect(stdout).toMatch(/QR URL: http:\/\/localhost:3001\/r\/[0-9a-f-]{36}#[A-Za-z0-9_-]{43}/);
    expect(stdout).toContain('outbox: {"pending":3,"rejected":0}');
    expect(stdout).toContain('skipped');
  });

  it('with a terminal’s credentials: uploads all three versions to the real merchant API and empties the outbox', async () => {
    const org = w.orgA;
    const { stdout } = await run(process.execPath, [DEMO], {
      env: {
        PATH: process.env.PATH ?? '',
        MERCHANT_API_URL: apiBase,
        TERMINAL_ID: org.terminal.terminalId,
        TERMINAL_API_KEY: org.terminal.apiKey,
        TERMINAL_PRIVATE_KEY: org.terminal.keys.privateKey,
        MERCHANT_KVK: org.kvk,
        MERCHANT_VAT: org.vat,
        MERCHANT_LOCATION_ID: org.locationId,
      },
    });
    expect(stdout).toContain('flushed: {"sent":3,"rejected":0,"retry":false}');
    expect(stdout).toContain('outbox: {"pending":0,"rejected":0}');
    const rows = await sql<{ version: number; state: string }>(w, 'select version, state from merchant.receipt_versions where org_id = $1 order by version', [org.orgId]);
    expect(rows).toEqual([
      { version: 1, state: 'presented' },
      { version: 2, state: 'presented' },
      { version: 3, state: 'paid' },
    ]);
  });
});
