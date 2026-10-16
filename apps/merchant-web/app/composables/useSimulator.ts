import { z } from 'zod';
import { generateKeyPair } from '@lr/crypto';
import type { Crf } from '@lr/schema';
import { TerminalSdk, type Draft, type DraftLine } from '@lr/terminal-sdk';
import { IndexedDbStore } from '@lr/terminal-sdk/idb';

export const PRODUCTS = [
  { sku: 'koffie', label: 'Koffie', unitPrice: 340, vatRate: 9 },
  { sku: 'appeltaart', label: 'Appeltaart', unitPrice: 395, vatRate: 9 },
  { sku: 'bier', label: 'Bier', unitPrice: 389, vatRate: 21 },
  { sku: 'wijn', label: 'Wijn', unitPrice: 495, vatRate: 21 },
] as const;

const credsSchema = z.object({
  terminalId: z.string(),
  apiKey: z.string(),
  privateKey: z.string(),
  merchant: z.object({ kvkNumber: z.string(), vatNumber: z.string().nullable(), name: z.string(), locationId: z.string() }),
});
export type SimCreds = z.infer<typeof credsSchema>;

const CREDS_KEY = 'lr.sim.terminal';
const CURRENT_KEY = 'lr.sim.current';

interface CartLine {
  sku: string;
  description: string;
  unitPrice: number;
  vatRate: 9 | 21;
  qty: number;
}

interface Current {
  receiptId: string;
  qrUrl: string;
  crf: Crf;
}

function readCreds(): SimCreds | null {
  try {
    const raw = localStorage.getItem(CREDS_KEY);
    const r = raw ? credsSchema.safeParse(JSON.parse(raw)) : null;
    return r?.success ? r.data : null;
  } catch {
    return null;
  }
}

/**
 * The browser terminal: `@lr/terminal-sdk` on an IndexedDB outbox, talking to merchant-api through the same-origin
 * `/sim-api` proxy. Credentials (terminal id, API key, signing key) live in localStorage — this is a demo POS.
 */
export function useSimulator() {
  const { t: tr } = useLocale();
  const creds = ref<SimCreds | null>(null);
  const cart = ref<CartLine[]>([]);
  const current = ref<Current | null>(null);
  const qrSvg = ref('');
  const offline = ref(false);
  const stats = ref({ pending: 0, rejected: 0 });
  const error = ref('');
  const busy = ref(false);
  let sdk: TerminalSdk | null = null;
  let store: IndexedDbStore | null = null;
  let poll: ReturnType<typeof setInterval> | undefined;
  let receiptHost = 'http://localhost:3001';

  const lines = computed<DraftLine[]>(() => cart.value.map((l) => ({ sku: l.sku, description: l.description, unitPrice: l.unitPrice, vatRate: l.vatRate, qty: l.qty })));
  const state = computed(() => current.value?.crf.state ?? null);
  const total = computed(() => (current.value ? current.value.crf.totals.gross : cart.value.reduce((s, l) => s + l.unitPrice * l.qty, 0)));
  const rounding = computed(() => current.value?.crf.totals.rounding ?? 0);
  const editable = computed(() => state.value === null || state.value === 'presented');

  async function show(receiptId: string, qrUrl?: string) {
    const r = await store?.getReceipt(receiptId);
    if (!r || !sdk) return;
    const url = qrUrl ?? sdk.qrUrl(receiptId, r.secret);
    if (current.value?.qrUrl !== url) qrSvg.value = await sdk.qrSvg(url);
    current.value = { receiptId, qrUrl: url, crf: r.crf };
    localStorage.setItem(CURRENT_KEY, receiptId);
  }

  async function run(fn: () => Promise<void>) {
    busy.value = true;
    error.value = '';
    try {
      await fn();
    } catch (e) {
      error.value = e instanceof Error ? e.message : tr('sim.errFailed');
    } finally {
      busy.value = false;
    }
  }

  function start(c: SimCreds) {
    creds.value = c;
    store = new IndexedDbStore(`lr-sim-${c.terminalId}`);
    sdk = new TerminalSdk({
      apiBase: '/sim-api',
      receiptHost,
      terminalId: c.terminalId,
      apiKey: c.apiKey,
      privateKey: c.privateKey,
      merchant: c.merchant,
      store,
      // the Offline toggle fails every request, exactly like a dead network
      fetch: (input, init) => (offline.value ? Promise.reject(new TypeError('Simulated offline')) : fetch(input, init)),
    });
    if (!offline.value) sdk.startFlusher({ idleMs: 500 });
    poll = setInterval(async () => {
      if (store) stats.value = await store.stats();
    }, 400);
  }

  async function init() {
    const cfg = await $fetch<{ receiptHost: string }>('/api/simulator/config');
    receiptHost = cfg.receiptHost;
    const c = readCreds();
    if (!c) return;
    start(c);
    const id = localStorage.getItem(CURRENT_KEY);
    if (id) await show(id);
  }

  function dispose() {
    clearInterval(poll);
    sdk?.stopFlusher();
    void store?.close();
  }

  /** Creates a terminal through the dashboard API: keypair generated here, only the public key is sent. */
  function setupDemoTerminal() {
    return run(async () => {
      const s = await $fetch<{ state: string }>('/api/dashboard/session');
      if (s.state !== 'ready') throw new Error(tr('sim.errLogin'));
      const [org, locs] = await Promise.all([
        $fetch<{ legalName: string; kvkNumber: string; vatNumber: string | null }>('/api/dashboard/org'),
        $fetch<Array<{ id: string }>>('/api/dashboard/locations'),
      ]);
      const location = locs[0];
      if (!location) throw new Error(tr('sim.errLocation'));
      const keys = generateKeyPair();
      const t = await $fetch<{ terminalId: string; apiKey: string }>('/api/dashboard/terminals', {
        method: 'POST',
        body: { locationId: location.id, label: `Simulator ${new Date().toISOString().slice(0, 16)}`, publicKey: keys.publicKey },
      });
      const c: SimCreds = { terminalId: t.terminalId, apiKey: t.apiKey, privateKey: keys.privateKey, merchant: { kvkNumber: org.kvkNumber, vatNumber: org.vatNumber, name: org.legalName, locationId: location.id } };
      localStorage.setItem(CREDS_KEY, JSON.stringify(c));
      dispose();
      start(c);
    });
  }

  function forgetTerminal() {
    dispose();
    localStorage.removeItem(CREDS_KEY);
    localStorage.removeItem(CURRENT_KEY);
    creds.value = null;
    newSale();
  }

  function newSale() {
    cart.value = [];
    current.value = null;
    qrSvg.value = '';
    localStorage.removeItem(CURRENT_KEY);
  }

  /** Add item. While the bill is presented, the change goes out as a new live version. */
  function addItem(sku: string) {
    return run(async () => {
      const p = PRODUCTS.find((x) => x.sku === sku);
      if (!p || !editable.value) return;
      const line = cart.value.find((l) => l.sku === sku);
      if (line) line.qty += 1;
      else cart.value.push({ sku: p.sku, description: p.label, unitPrice: p.unitPrice, vatRate: p.vatRate, qty: 1 });
      if (current.value && sdk) {
        await sdk.addVersion(current.value.receiptId, { state: 'presented', lines: lines.value });
        await show(current.value.receiptId, current.value.qrUrl);
      }
    });
  }

  function present() {
    return run(async () => {
      if (!sdk || cart.value.length === 0) return;
      const draft: Draft = { state: 'presented', lines: lines.value };
      if (current.value) {
        await sdk.addVersion(current.value.receiptId, draft);
        await show(current.value.receiptId, current.value.qrUrl);
      } else {
        await show((await sdk.createReceipt(draft)).receiptId);
      }
    });
  }

  function pay(method: 'card' | 'cash') {
    return run(async () => {
      if (!sdk || cart.value.length === 0 || !editable.value) return;
      const draft: Draft = { state: 'paid', lines: lines.value, payments: [{ method }] };
      if (current.value) {
        await sdk.addVersion(current.value.receiptId, draft);
        await show(current.value.receiptId, current.value.qrUrl);
      } else {
        await show((await sdk.createReceipt(draft)).receiptId);
      }
    });
  }

  function voidSale() {
    return run(async () => {
      if (!sdk || !current.value || state.value === 'void') return;
      await sdk.voidReceipt(current.value.receiptId);
      await show(current.value.receiptId, current.value.qrUrl);
    });
  }

  function setOffline(value: boolean) {
    offline.value = value;
    if (!sdk) return;
    if (value) sdk.stopFlusher();
    else sdk.startFlusher({ idleMs: 500 });
  }

  return { creds, cart, current, qrSvg, offline, stats, error, busy, state, total, rounding, editable, init, dispose, setupDemoTerminal, forgetTerminal, newSale, addItem, present, pay, voidSale, setOffline };
}
