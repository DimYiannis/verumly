// `pnpm --filter @lr/terminal-sdk demo`: a till sells coffee, shows the QR, adds a beer, takes cash.
//
// With a terminal's credentials in the environment the receipt is uploaded to a running merchant-api:
//   MERCHANT_API_URL (default http://127.0.0.1:4001), TERMINAL_ID, TERMINAL_API_KEY, TERMINAL_PRIVATE_KEY,
//   MERCHANT_KVK, MERCHANT_VAT (optional), MERCHANT_LOCATION_ID, RECEIPT_HOST (default http://localhost:3001)
// Without them only the offline half runs: everything is signed and queued in a SQLite outbox, which is exactly what a
// till does while the network is down.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { generateKeyPair } from '@lr/crypto';
import { TerminalSdk } from './sdk.ts';
import { SqliteStore } from './sqlite-store.ts';

const env = (name: string): string | undefined => process.env[name] || undefined;

const credentials = {
  terminalId: env('TERMINAL_ID'),
  apiKey: env('TERMINAL_API_KEY'),
  privateKey: env('TERMINAL_PRIVATE_KEY'),
  kvk: env('MERCHANT_KVK'),
  locationId: env('MERCHANT_LOCATION_ID'),
};
const online = Object.values(credentials).every((v) => v !== undefined);
if (!online) console.log('No terminal credentials in the environment: running the offline half only (nothing is uploaded).\n');

const dir = mkdtempSync(join(tmpdir(), 'lr-demo-'));
const store = new SqliteStore(join(dir, 'outbox.db'));
const sdk = new TerminalSdk({
  apiBase: env('MERCHANT_API_URL') ?? 'http://127.0.0.1:4001',
  receiptHost: env('RECEIPT_HOST') ?? 'http://localhost:3001',
  terminalId: credentials.terminalId ?? randomUUID(),
  apiKey: credentials.apiKey ?? 'demo-key-not-registered-anywhere',
  privateKey: credentials.privateKey ?? generateKeyPair().privateKey,
  merchant: { kvkNumber: credentials.kvk ?? '12345678', vatNumber: env('MERCHANT_VAT') ?? null, name: 'Café Het Plein', locationId: credentials.locationId ?? randomUUID() },
  store,
});

try {
  const coffee = { sku: 'KOF', description: 'Koffie', qty: 2, unitPrice: 340, vatRate: 9 as const, category: 'dining' };
  const { receiptId, qrUrl } = await sdk.createReceipt({ state: 'presented', lines: [coffee] });
  console.log(`1. presented receipt ${receiptId} created locally (no network yet)`);
  console.log(`   QR URL: ${qrUrl}`);
  console.log(await QRCode.toString(qrUrl, { type: 'terminal', small: true }));
  console.log(`   outbox: ${JSON.stringify(await store.stats())}`);

  await sdk.addVersion(receiptId, { lines: [coffee, { sku: 'BIER', description: 'Bier', qty: 1, unitPrice: 389, vatRate: 21, category: 'dining' }] });
  console.log('2. added a beer (version 2)');
  await sdk.addVersion(receiptId, { state: 'paid', payments: [{ method: 'cash' }] });
  console.log('3. paid in cash with 5-cent rounding (version 3, paid = final in NL)');
  console.log(`   outbox: ${JSON.stringify(await store.stats())}`);

  if (online) {
    const result = await sdk.flush();
    console.log(`4. flushed: ${JSON.stringify(result)}`);
    console.log(`   outbox: ${JSON.stringify(await store.stats())}`);
    if (result.retry || result.rejected > 0) process.exitCode = 1;
  } else {
    console.log('4. skipped: set TERMINAL_ID, TERMINAL_API_KEY, TERMINAL_PRIVATE_KEY, MERCHANT_KVK and MERCHANT_LOCATION_ID to upload');
  }
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
