// Child process for crash.test.ts: runs the real SDK against a real merchant API with a SQLite outbox file.
// The parent kills it with SIGKILL at awkward moments. Configuration comes from LR_* environment variables.
import { SqliteStore } from '../src/sqlite-store.ts';
import { TerminalSdk } from '../src/index.ts';

const env = (name: string): string => {
  const v = process.env[name];
  if (v === undefined) throw new Error(`missing ${name}`);
  return v;
};

const store = new SqliteStore(env('LR_FILE'));
const sdk = new TerminalSdk({
  apiBase: env('LR_API_BASE'),
  receiptHost: 'https://receipts.example',
  terminalId: env('LR_TERMINAL_ID'),
  apiKey: env('LR_API_KEY'),
  privateKey: env('LR_PRIVATE_KEY'),
  merchant: { kvkNumber: env('LR_KVK'), vatNumber: env('LR_VAT'), name: 'Café Het Plein', locationId: env('LR_LOCATION_ID') },
  store,
  batchSize: Number(env('LR_BATCH')),
  random: () => 0.5,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mode = env('LR_MODE');

if (mode === 'flush') {
  for (let i = 0; i < 600; i++) {
    await sdk.flush();
    if ((await store.stats()).pending === 0) break;
    await sleep(50);
  }
  const stats = await store.stats();
  store.close();
  console.log(`flushed pending=${stats.pending} rejected=${stats.rejected}`);
} else if (mode === 'enqueue') {
  // Create receipts with three versions each until killed. A line is printed only AFTER the commit returned,
  // so every printed (receiptId, version) must survive the kill.
  for (let i = 0; ; i++) {
    const { receiptId } = await sdk.createReceipt({ state: 'presented', lines: [{ description: 'Koffie', unitPrice: 340, vatRate: 9, qty: 2 }] });
    console.log(`committed ${receiptId} 1`);
    await sdk.addVersion(receiptId, { state: 'presented' });
    console.log(`committed ${receiptId} 2`);
    await sdk.addVersion(receiptId, { state: 'paid' });
    console.log(`committed ${receiptId} 3`);
  }
} else {
  throw new Error(`unknown mode ${mode}`);
}
