import { z } from 'zod';
import { getFormat } from '@lr/compliance/formats';
import { generateKeyPair } from '@lr/crypto';
import type { FiscalStateStore } from '@lr/fiscal';
import { getFiscalSpec } from '@lr/fiscal/specs';
import type { Crf } from '@lr/schema';
import { TerminalSdk, type Draft, type DraftLine } from '@lr/terminal-sdk';
import { IndexedDbStore } from '@lr/terminal-sdk/idb';

/** Roughly what a coffee costs in each currency, relative to the euro: keeps the demo prices believable. */
const PRICE_FACTOR: Record<string, number> = { EUR: 1, GBP: 1, CHF: 1, SEK: 11, NOK: 11, DKK: 7.5, PLN: 4.3, CZK: 25, HUF: 400, RON: 5, ISK: 150 };

export interface Product {
  sku: string;
  label: string;
  unitPrice: number;
  vatRate: number;
}

/** The demo menu of a country: coffee and cake at the reduced rate, beer and wine at the standard one, priced in its currency. */
export function productsFor(country: string): Product[] {
  const f = getFormat(country) ?? getFormat('NL')!;
  const standard = f.vatRates[0]!;
  const reduced = f.vatRates[1] ?? standard;
  const k = PRICE_FACTOR[f.currency] ?? 1;
  // euro, pound and franc keep the euro prices; others are rounded to 0.10 of the currency, or to whole units where there are no small coins
  const price = (eurCents: number) => (k === 1 ? eurCents : k >= 100 ? Math.round((eurCents * k) / 100) * 100 : Math.round((eurCents * k) / 10) * 10);
  const nl = f.code === 'NL';
  return [
    { sku: 'koffie', label: nl ? 'Koffie' : 'Coffee', unitPrice: price(340), vatRate: reduced },
    { sku: 'appeltaart', label: nl ? 'Appeltaart' : 'Apple pie', unitPrice: price(395), vatRate: reduced },
    { sku: 'bier', label: nl ? 'Bier' : 'Beer', unitPrice: price(389), vatRate: standard },
    { sku: 'wijn', label: nl ? 'Wijn' : 'Wine', unitPrice: price(495), vatRate: standard },
  ];
}

/** Counters and hash chains of the sandbox fiscal device, kept in the browser so a reload does not restart the numbering. */
class LocalFiscalState implements FiscalStateStore {
  constructor(private readonly terminalId: string) {}
  async get(key: string) {
    try {
      return localStorage.getItem(`lr.sim.fiscal.${this.terminalId}.${key}`) ?? undefined;
    } catch {
      return undefined;
    }
  }
  async set(key: string, value: string) {
    try {
      localStorage.setItem(`lr.sim.fiscal.${this.terminalId}.${key}`, value);
    } catch {
      // private mode: the numbering restarts with the page, it is only a sandbox
    }
  }
}

const credsSchema = z.object({
  terminalId: z.string(),
  apiKey: z.string(),
  privateKey: z.string(),
  merchant: z.object({ kvkNumber: z.string(), vatNumber: z.string().nullable(), name: z.string(), locationId: z.string() }),
  /** the organisation's country and its legal settings (TSE serial, register id, ...) as set up in the dashboard */
  country: z.string().default('NL'),
  settings: z.record(z.string(), z.union([z.string(), z.boolean()])).default({}),
});
export type SimCreds = z.infer<typeof credsSchema>;

const CREDS_KEY = 'lr.sim.terminal';
const CURRENT_KEY = 'lr.sim.current';

interface CartLine {
  sku: string;
  description: string;
  unitPrice: number;
  vatRate: number;
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

  const products = computed(() => productsFor(creds.value?.country ?? 'NL'));
  /** the country's state integration, for the panel next to the receipt (null: no fiscal step there) */
  const fiscal = computed(() => getFiscalSpec(creds.value?.country ?? 'NL'));
  const lines = computed<DraftLine[]>(() => cart.value.map((l) => ({ sku: l.sku, description: l.description, unitPrice: l.unitPrice, vatRate: l.vatRate, qty: l.qty })));
  const state = computed(() => current.value?.crf.state ?? null);
  const total = computed(() => (current.value ? current.value.crf.totals.gross : cart.value.reduce((s, l) => s + l.unitPrice * l.qty, 0)));
  const rounding = computed(() => current.value?.crf.totals.rounding ?? 0);
  // a receipt is issued once, already paid: nothing is edited afterwards
  const editable = computed(() => state.value === null);

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
      country: c.country,
      fiscal: { settings: c.settings, state: new LocalFiscalState(c.terminalId) },
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
    let c = readCreds();
    if (!c) return;
    // the business may have changed its country or its numbers since this terminal was set up: the till follows the setup
    const org = await $fetch<{ kvkNumber: string; vatNumber: string | null; country: string; compliance: { values?: Record<string, string | boolean> } }>('/api/dashboard/org').catch(() => null);
    if (org) {
      c = { ...c, country: org.country, settings: org.compliance?.values ?? {}, merchant: { ...c.merchant, kvkNumber: org.kvkNumber, vatNumber: org.vatNumber } };
      localStorage.setItem(CREDS_KEY, JSON.stringify(c));
    }
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
        $fetch<{ legalName: string; kvkNumber: string; vatNumber: string | null; country: string; compliance: { values?: Record<string, string | boolean> } }>('/api/dashboard/org'),
        $fetch<Array<{ id: string }>>('/api/dashboard/locations'),
      ]);
      const location = locs[0];
      if (!location) throw new Error(tr('sim.errLocation'));
      const keys = generateKeyPair();
      const t = await $fetch<{ terminalId: string; apiKey: string }>('/api/dashboard/terminals', {
        method: 'POST',
        body: { locationId: location.id, label: `Simulator ${new Date().toISOString().slice(0, 16)}`, publicKey: keys.publicKey },
      });
      const c: SimCreds = { terminalId: t.terminalId, apiKey: t.apiKey, privateKey: keys.privateKey, merchant: { kvkNumber: org.kvkNumber, vatNumber: org.vatNumber, name: org.legalName, locationId: location.id }, country: org.country, settings: org.compliance?.values ?? {} };
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

  function addItem(sku: string) {
    const p = products.value.find((x) => x.sku === sku);
    if (!p || !editable.value) return;
    const line = cart.value.find((l) => l.sku === sku);
    if (line) line.qty += 1;
    else cart.value.push({ sku: p.sku, description: p.label, unitPrice: p.unitPrice, vatRate: p.vatRate, qty: 1 });
  }

  /** Issues the receipt: the sale is taken as paid (the shop only issues a receipt after it was paid). */
  function issue() {
    return run(async () => {
      if (!sdk || cart.value.length === 0 || !editable.value) return;
      const draft: Draft = { state: 'paid', lines: lines.value, payments: [{ method: 'card' }] };
      await show((await sdk.createReceipt(draft)).receiptId);
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

  return { creds, products, fiscal, cart, current, qrSvg, offline, stats, error, busy, state, total, rounding, editable, init, dispose, setupDemoTerminal, forgetTerminal, newSale, addItem, issue, voidSale, setOffline };
}
