import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { sha256Hex } from '@lr/crypto';
import { runJourney } from './journey.ts';

/**
 * Privacy canary (v2 §16.E). Runs the golden journey with a unique canary e-mail, then searches everything the merchant
 * side could have seen or kept for the buyer's identity:
 *   - every captured service log line (both APIs),
 *   - a `pg_dump` of schema `merchant` (plus `ops` and `pgboss`, which merchant-api writes to),
 *   - every merchant-side response (SDK ↔ merchant-api, dashboard archive/detail/export, a terminal GET of the receipt).
 * Zero hits are allowed for: the e-mail, the claim secret, the buyer's user id and the session token.
 * Positive controls prove the search can see a leak: the buyer-side dump MUST contain the e-mail and user id, and the merchant
 * dump MUST contain the receipt id.
 */

const run = promisify(execFile);

export interface Needle {
  name: string;
  value: string;
}

export interface Haystack {
  name: string;
  text: string;
}

export interface Hit {
  needle: string;
  haystack: string;
  count: number;
}

export interface Control {
  name: string;
  ok: boolean;
  detail: string;
}

export interface CanaryReport {
  needles: Needle[];
  haystacks: Array<{ name: string; bytes: number }>;
  /** needle × haystack for the merchant side; every count must be 0 */
  hits: Hit[];
  controls: Control[];
  /** hits with count > 0 */
  leaks: Hit[];
}

/** Case-insensitive occurrences of `value` in `text`, also as URL-encoded and JSON-escaped text. */
export function countHits(text: string, value: string): number {
  const hay = text.toLowerCase();
  const forms = new Set([value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)].map((f) => f.toLowerCase()));
  let n = 0;
  for (const f of forms) {
    let from = 0;
    for (;;) {
      const at = hay.indexOf(f, from);
      if (at < 0) break;
      n++;
      from = at + f.length;
    }
  }
  return n;
}

/** pg_dump runs inside whichever container publishes the Postgres port, so it works from any checkout directory and in CI. */
async function pgDump(dbName: string, schemas: string[]): Promise<string> {
  const port = process.env.PG_PORT ?? '5433';
  const found = await run('docker', ['ps', '--filter', `publish=${port}`, '--format', '{{.ID}}']);
  const container = found.stdout.trim().split('\n')[0];
  if (!container) throw new Error(`no running container publishes port ${port}`);
  const args = ['exec', container, 'pg_dump', '-U', 'postgres', ...schemas.flatMap((s) => ['-n', s]), dbName];
  const { stdout } = await run('docker', args, { maxBuffer: 512 * 1024 * 1024 });
  return stdout;
}

export async function runCanary(opts: { print?: boolean } = {}): Promise<CanaryReport> {
  const print = opts.print ?? true;
  const email = `canary-${randomUUID()}@example.test`;
  const journey = await runJourney({ email, print });
  const { stack } = journey;
  try {
    // one more merchant-side read: the terminal fetches the receipt it uploaded
    const get = await fetch(`${stack.merchantUrl}/v1/receipts/${journey.receiptId}`, {
      headers: { authorization: `Bearer ${stack.terminal.apiKey}`, 'x-terminal-id': stack.terminal.terminalId },
    });
    const me = await fetch(`${stack.merchantUrl}/v1/terminals/me`, {
      headers: { authorization: `Bearer ${stack.terminal.apiKey}`, 'x-terminal-id': stack.terminal.terminalId },
    });
    const responses = [...journey.merchantSideResponses, await get.text(), await me.text()];

    const name = stack.testDb.name;
    const [merchantDump, opsDump, bossDump, buyerDump] = await Promise.all([pgDump(name, ['merchant']), pgDump(name, ['ops']), pgDump(name, ['pgboss']), pgDump(name, ['buyer'])]);

    const needles: Needle[] = [
      { name: 'e-mail', value: email },
      { name: 'e-mail local part', value: email.split('@')[0]! },
      { name: 'claim secret', value: journey.secret },
      { name: 'claim secret (first 16 chars)', value: journey.secret.slice(0, 16) },
      { name: 'user id', value: journey.userId },
      { name: 'session token', value: journey.sessionToken },
      { name: 'session token (first 16 chars)', value: journey.sessionToken.slice(0, 16) },
    ];
    const merchantSide: Haystack[] = [
      { name: 'service logs', text: stack.logs.lines.join('') },
      { name: 'pg_dump -n merchant', text: merchantDump },
      { name: 'pg_dump -n ops', text: opsDump },
      { name: 'pg_dump -n pgboss', text: bossDump },
      { name: 'merchant-side responses', text: responses.join('\n') },
    ];

    const hits: Hit[] = merchantSide.flatMap((h) => needles.map((n) => ({ needle: n.name, haystack: h.name, count: countHits(h.text, n.value) })));

    const controls: Control[] = [];
    const control = (cname: string, ok: boolean, detail: string) => controls.push({ name: cname, ok, detail });
    const dumpedReceipts = countHits(merchantDump, journey.receiptId);
    control('merchant dump contains the receipt id', dumpedReceipts > 0, `${dumpedReceipts} occurrences`);
    const loggedReceipts = countHits(stack.logs.lines.join(''), journey.receiptId);
    control('service logs contain the receipt id (the log is actually being read)', loggedReceipts > 0, `${loggedReceipts} occurrences, ${stack.logs.lines.length} log lines`);
    const responded = countHits(responses.join('\n'), journey.receiptId);
    control('merchant-side responses contain the receipt id', responded > 0, `${responded} occurrences in ${responses.length} responses`);
    const buyerEmail = countHits(buyerDump, email);
    const buyerUser = countHits(buyerDump, journey.userId);
    control('buyer dump DOES contain the canary e-mail and user id (the search can see a leak)', buyerEmail > 0 && buyerUser > 0, `e-mail ${buyerEmail}, user id ${buyerUser}`);
    const hashedToken = countHits(buyerDump, sha256Hex(journey.sessionToken));
    control('buyer dump holds only the HASH of the session token', hashedToken > 0 && countHits(buyerDump, journey.sessionToken) === 0, `sha256 found ${hashedToken}×, raw token 0×`);
    control('detector self-test: finds a planted e-mail, also URL-encoded and JSON-escaped', countHits(`a ${email} b`, email) === 1 && countHits(`x=${encodeURIComponent(email)}&`, email) >= 1 && countHits(JSON.stringify({ e: email }), email) >= 1, 'planted in 3 encodings');

    const leaks = hits.filter((h) => h.count > 0);
    const report: CanaryReport = { needles, haystacks: merchantSide.map((h) => ({ name: h.name, bytes: h.text.length })), hits, controls, leaks };
    if (print) printReport(report, email);
    return report;
  } finally {
    await stack.stopAll();
  }
}

function printReport(r: CanaryReport, email: string): void {
  console.log(`\nPrivacy canary — e-mail ${email}`);
  for (const h of r.haystacks) {
    const row = r.hits.filter((x) => x.haystack === h.name);
    console.log(`  ${row.every((x) => x.count === 0) ? '✔' : '✘'} ${h.name} (${h.bytes} chars): ${row.map((x) => `${x.needle}=${x.count}`).join(', ')}`);
  }
  for (const c of r.controls) console.log(`  ${c.ok ? '✔' : '✘'} control: ${c.name} — ${c.detail}`);
}

if (import.meta.main) {
  const report = await runCanary();
  const failedControls = report.controls.filter((c) => !c.ok);
  if (report.leaks.length > 0 || failedControls.length > 0) {
    console.error(`\nPRIVACY CANARY FAILED: ${report.leaks.length} leaks, ${failedControls.length} failed controls`);
    process.exit(1);
  }
  console.log(`\nPrivacy canary passed: 0 hits in ${report.hits.length} needle×haystack searches; ${report.controls.length} controls ok`);
}
