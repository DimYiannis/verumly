import { randomUUID } from 'node:crypto';
import { generateKeyPair } from '@lr/crypto';
import { TerminalSdk, type OutboxStore, type SdkConfig } from '../src/index.ts';

export function sdkFor(store: OutboxStore, overrides: Partial<SdkConfig> = {}): TerminalSdk {
  const keys = generateKeyPair();
  return new TerminalSdk({
    apiBase: 'http://merchant.test',
    receiptHost: 'https://receipts.example',
    terminalId: randomUUID(),
    apiKey: 'k'.repeat(40),
    privateKey: keys.privateKey,
    merchant: { kvkNumber: '12345678', vatNumber: 'NL123456789B01', name: 'Café Het Plein', locationId: randomUUID() },
    store,
    random: () => 0.5,
    ...overrides,
  });
}

export const simpleDraft = { state: 'presented' as const, lines: [{ description: 'Koffie', unitPrice: 340, vatRate: 9 as const, qty: 2 }] };

interface Wire {
  receiptId: string;
  version: number;
}

/** Narrow `{version: {receiptId, version}}` out of an untyped request body. */
function wireOf(body: unknown): Wire {
  if (typeof body === 'object' && body !== null && 'version' in body) {
    const v = body.version;
    if (typeof v === 'object' && v !== null && 'receiptId' in v && 'version' in v && typeof v.receiptId === 'string' && typeof v.version === 'number') {
      return { receiptId: v.receiptId, version: v.version };
    }
  }
  throw new Error('unexpected request body');
}

function batchItems(body: unknown): Array<{ key: string; wire: Wire }> {
  if (typeof body === 'object' && body !== null && 'items' in body && Array.isArray(body.items)) {
    return body.items.map((i: unknown) => {
      if (typeof i === 'object' && i !== null && 'idempotencyKey' in i && typeof i.idempotencyKey === 'string' && 'body' in i) return { key: i.idempotencyKey, wire: wireOf(i.body) };
      throw new Error('unexpected batch item');
    });
  }
  throw new Error('unexpected batch body');
}

export interface RecordedRequest {
  path: string;
  headers: Record<string, string>;
  text: string;
  /** `receiptId:version` of each item carried by the request, in order */
  items: string[];
  keys: string[];
}

export type Verdict = { httpStatus: number; error: string } | undefined;

export interface FakeServerOptions {
  /** per item, before it is stored: return a verdict to reject it */
  reject?: (item: { receiptId: string; version: number; key: string }) => Verdict;
  /** per request (1-based): throw a network error, or answer with a bare HTTP status */
  request?: (n: number, path: string) => 'network' | number | undefined;
  /** drop the response of a request that WAS processed (lost acknowledgement) */
  loseAck?: (n: number) => boolean;
}

/**
 * A tiny merchant-API double with the same ordering rules as the real one (contiguous versions, idempotent
 * replay by Idempotency-Key). Used where the test needs to inject failures the real server cannot be made to produce.
 */
export function fakeServer(opts: FakeServerOptions = {}) {
  const requests: RecordedRequest[] = [];
  const stored = new Map<string, number>();
  const keys = new Set<string>();
  /** every (receiptId:version) the server accepted, in acceptance order */
  const accepted: string[] = [];

  function process(receiptId: string, version: number, key: string): { status: 'created' | 'replayed' } | { httpStatus: number; error: string } {
    const verdict = opts.reject?.({ receiptId, version, key });
    if (verdict) return verdict;
    if (keys.has(key)) return { status: 'replayed' };
    const have = stored.get(receiptId) ?? 0;
    if (version !== have + 1) return { httpStatus: 409, error: 'version_gap' };
    stored.set(receiptId, version);
    keys.add(key);
    accepted.push(`${receiptId}:${version}`);
    return { status: 'created' };
  }

  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const text = typeof init?.body === 'string' ? init.body : '';
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const path = url.pathname;
    const n = requests.length + 1;
    const isBatch = path === '/v1/receipts::batch' || path === '/v1/receipts:batch';
    const parsed = text ? JSON.parse(text) : {};
    const items = isBatch
      ? batchItems(parsed).map((i) => ({ id: i.wire.receiptId, v: i.wire.version, key: i.key }))
      : [{ id: wireOf(parsed).receiptId, v: wireOf(parsed).version, key: headers['idempotency-key'] ?? '' }];
    requests.push({ path, headers, text, items: items.map((i) => `${i.id}:${i.v}`), keys: items.map((i) => i.key) });

    const injected = opts.request?.(n, path);
    if (injected === 'network') throw new TypeError('fetch failed');
    if (typeof injected === 'number') return json(injected, { error: 'injected' });

    let response: Response;
    if (isBatch) {
      const results = items.map((i) => {
        const r = process(i.id, i.v, i.key);
        return 'status' in r ? { idempotencyKey: i.key, status: r.status, receiptId: i.id, version: i.v } : { idempotencyKey: i.key, status: 'error', ...r };
      });
      response = json(200, { results });
    } else {
      const i = items[0]!;
      const r = process(i.id, i.v, i.key);
      response = 'status' in r ? json(r.status === 'created' ? 201 : 200, { receiptId: i.id, version: i.v, status: r.status }) : json(r.httpStatus, { error: r.error });
    }
    if (opts.loseAck?.(n)) throw new TypeError('fetch failed');
    return response;
  };

  return { fetch: fetchImpl, requests, stored, accepted };
}
