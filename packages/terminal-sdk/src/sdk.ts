import QRCode from 'qrcode';
import { generateSecret, hashSecret, newReceiptId, signBytes, signPayload } from '@lr/crypto';
import { cashRounding, checkTransition, deriveVatSummary, lineTotal, validateCrf, type Issue } from '@lr/receipt-nl';
import type { Crf, CrfLine } from '@lr/schema';
import { scrubDescription, toQty, type Draft, type DraftLine } from './mapping.ts';
import type { LocalReceipt, OutboxItem, OutboxStore, StoredOutboxItem } from './store.ts';

export interface SdkConfig {
  /** merchant-api base URL, no trailing slash */
  apiBase: string;
  /** e.g. https://receipts.example — used for the QR URL */
  receiptHost: string;
  terminalId: string;
  /** Bearer API key shown once in the dashboard */
  apiKey: string;
  /** base64url Ed25519 seed; the matching public key is registered with the dashboard */
  privateKey: string;
  merchant: { kvkNumber: string; vatNumber: string | null; name: string; locationId: string };
  store: OutboxStore;
  fetch?: typeof fetch;
  now?: () => Date;
  /** random in [0,1) for backoff jitter */
  random?: () => number;
  batchSize?: number;
}

export class SdkValidationError extends Error {
  readonly issues: Issue[];
  constructor(issues: Issue[]) {
    super(`receipt failed validation: ${issues.map((i) => i.code).join(', ')}`);
    this.issues = issues;
  }
}

export interface FlushResult {
  sent: number;
  rejected: number;
  /** true when the pass stopped on a network/5xx/gap error and should be retried with backoff */
  retry: boolean;
}

/** Exponential backoff with jitter: min(cap, base·2^attempt) scaled into [50%, 100%]. */
export function backoffMs(attempt: number, random: number, base = 500, cap = 30_000): number {
  return Math.round(Math.min(cap, base * 2 ** attempt) * (0.5 + random * 0.5));
}

export function buildQrUrl(receiptHost: string, receiptId: string, secret: string): string {
  return `${receiptHost.replace(/\/$/, '')}/r/${receiptId}#${secret}`;
}

export class TerminalSdk {
  private cfg: SdkConfig;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private attempt = 0;
  private flushing: Promise<FlushResult> | undefined;

  constructor(cfg: SdkConfig) {
    this.cfg = cfg;
  }

  qrUrl(receiptId: string, secret: string): string {
    return buildQrUrl(this.cfg.receiptHost, receiptId, secret);
  }

  /** SVG QR for the customer display. Sized by the viewBox; scale with CSS. */
  async qrSvg(url: string): Promise<string> {
    return QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
  }

  /** Create + sign v1 and queue it. Returns before any network call. */
  async createReceipt(draft: Draft): Promise<{ receiptId: string; secret: string; qrUrl: string }> {
    const receiptId = newReceiptId();
    const secret = generateSecret();
    const crf = this.buildCrf(receiptId, 1, draft, null);
    this.assertValid(crf, null);
    const signature = signPayload(this.cfg.privateKey, crf);
    await this.cfg.store.commit(
      { receiptId, secret, crf },
      {
        receiptId,
        version: 1,
        idempotencyKey: `${receiptId}:1`,
        body: { version: crf, signature, claimSecretHash: hashSecret(secret) },
      },
    );
    return { receiptId, secret, qrUrl: this.qrUrl(receiptId, secret) };
  }

  /** Build, validate, sign and queue the next version. `patch` overrides fields of the previous version's draft. */
  async addVersion(receiptId: string, patch: Partial<Draft>): Promise<{ version: number; state: Crf['state'] }> {
    const prev = await this.cfg.store.getReceipt(receiptId);
    if (!prev) throw new Error(`unknown receipt ${receiptId}`);
    const draft = this.draftFrom(prev.crf, patch);
    const crf = this.buildCrf(receiptId, prev.crf.version + 1, draft, prev.crf.voidOf);
    this.assertValid(crf, prev.crf.state);
    return this.commitVersion(prev, crf);
  }

  async voidReceipt(receiptId: string): Promise<{ version: number; state: Crf['state'] }> {
    const prev = await this.cfg.store.getReceipt(receiptId);
    if (!prev) throw new Error(`unknown receipt ${receiptId}`);
    const crf: Crf = { ...prev.crf, version: prev.crf.version + 1, state: 'void', createdAt: this.now() };
    this.assertValid(crf, prev.crf.state);
    return this.commitVersion(prev, crf);
  }

  private async commitVersion(prev: LocalReceipt, crf: Crf) {
    const signature = signPayload(this.cfg.privateKey, crf);
    await this.cfg.store.commit(
      { receiptId: prev.receiptId, secret: prev.secret, crf },
      { receiptId: prev.receiptId, version: crf.version, idempotencyKey: `${prev.receiptId}:${crf.version}`, body: { version: crf, signature } },
    );
    return { version: crf.version, state: crf.state };
  }

  private now(): string {
    return (this.cfg.now?.() ?? new Date()).toISOString();
  }

  private assertValid(crf: Crf, from: Crf['state'] | null) {
    const issues = validateCrf(crf, { country: 'NL' });
    const t = checkTransition(from, crf.state);
    if (!t.ok) issues.push({ path: 'state', code: t.reason, message: `cannot go ${from ?? 'start'} → ${crf.state}` });
    if (issues.length) throw new SdkValidationError(issues);
  }

  private draftFrom(crf: Crf, patch: Partial<Draft>): Draft {
    const lines: DraftLine[] =
      patch.lines ??
      crf.lines.map((l) => ({
        sku: l.sku,
        description: l.description,
        qty: l.qty,
        unitPrice: l.unitPrice,
        vatRate: l.vatRate,
        discount: l.discount,
        kind: l.kind,
        category: l.category,
      }));
    return {
      state: patch.state ?? (crf.state === 'void' || crf.state === 'fiscalised' ? 'paid' : crf.state),
      lines,
      payments: patch.payments,
      tip: patch.tip ?? crf.totals.tip,
      rounding: patch.rounding,
      documentNumber: patch.documentNumber ?? crf.fiscal.documentNumber,
    };
  }

  private buildCrf(receiptId: string, version: number, draft: Draft, voidOf: string | null): Crf {
    const lines: CrfLine[] = draft.lines.map((l, i) => {
      const qty = toQty(l.qty);
      const discount = l.discount ?? 0;
      const kind = l.kind ?? 'item';
      return {
        lineNo: i + 1,
        kind,
        sku: l.sku ?? null,
        description: scrubDescription(l.description),
        qty,
        unitPrice: l.unitPrice,
        vatRate: kind === 'deposit' ? null : l.vatRate,
        discount,
        total: lineTotal(qty, l.unitPrice, discount),
        category: l.category ?? null,
      };
    });
    const gross = lines.reduce((s, l) => s + l.total, 0);
    const vatSummary = deriveVatSummary(lines);
    const tip = draft.tip ?? 0;

    let payments: Crf['payments'] = [];
    let rounding = 0;
    if (draft.state === 'paid') {
      const given = draft.payments ?? [{ method: 'card' as const }];
      const onlyCash = given.length === 1 && given[0]!.method === 'cash' && given[0]!.amount === undefined;
      rounding = draft.rounding ?? (onlyCash ? cashRounding(gross + tip) : 0);
      const due = gross + tip + rounding;
      payments = given.map((p) => ({ method: p.method, amount: p.amount ?? due }));
    }

    return {
      crf: '1',
      receiptId,
      version,
      state: draft.state,
      merchant: {
        kvkNumber: this.cfg.merchant.kvkNumber,
        vatNumber: this.cfg.merchant.vatNumber,
        name: this.cfg.merchant.name,
        locationId: this.cfg.merchant.locationId,
        terminalId: this.cfg.terminalId,
      },
      createdAt: this.now(),
      currency: 'EUR',
      lines,
      vatSummary,
      totals: {
        gross,
        net: vatSummary.reduce((s, v) => s + v.net, 0),
        vat: vatSummary.reduce((s, v) => s + v.vat, 0),
        tip,
        rounding,
      },
      payments,
      fiscal: { country: 'NL', registerSerial: null, documentNumber: draft.documentNumber ?? null, extra: {} },
      voidOf,
    };
  }

  // ------------------------------------------------------------- uploading

  private async post(path: string, bodyText: string, idempotencyKey?: string): Promise<Response> {
    const f = this.cfg.fetch ?? fetch;
    return f(`${this.cfg.apiBase}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.cfg.apiKey}`,
        'x-terminal-id': this.cfg.terminalId,
        'x-signature': signBytes(this.cfg.privateKey, new TextEncoder().encode(bodyText)),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: bodyText,
    });
  }

  /** One ordered upload pass. Never throws on network errors; reports `retry` instead. Passes never overlap. */
  flush(): Promise<FlushResult> {
    this.flushing ??= this.flushOnce().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }

  private async flushOnce(): Promise<FlushResult> {
    const out: FlushResult = { sent: 0, rejected: 0, retry: false };
    const batchSize = Math.min(this.cfg.batchSize ?? 500, 500);
    for (;;) {
      const items = await this.cfg.store.pending(batchSize);
      if (items.length === 0) return out;
      let outcomes: Array<{ item: StoredOutboxItem; status: 'ok' | 'retry' | 'rejected'; reason?: string }>;
      try {
        outcomes = items.length === 1 ? [await this.sendOne(items[0]!)] : await this.sendBatch(items);
      } catch {
        out.retry = true; // network failure: nothing was acknowledged, keep everything queued
        return out;
      }
      const done = outcomes.filter((o) => o.status === 'ok').map((o) => o.item.seq);
      await this.cfg.store.remove(done);
      out.sent += done.length;
      for (const o of outcomes.filter((x) => x.status === 'rejected')) {
        const cascade = await this.cfg.store.pendingAfter(o.item.receiptId, o.item.version);
        await this.cfg.store.reject([o.item.seq, ...cascade.map((c) => c.seq)], o.reason ?? 'rejected');
        out.rejected += 1 + cascade.length;
      }
      if (outcomes.some((o) => o.status === 'retry')) {
        out.retry = true;
        return out;
      }
      if (done.length === 0 && out.rejected === 0) return out;
    }
  }

  private classify(httpStatus: number, error: string | undefined): 'retry' | 'rejected' {
    if (httpStatus >= 500 || httpStatus === 429 || httpStatus === 408) return 'retry';
    if (httpStatus === 409 && error === 'version_gap') return 'retry';
    return 'rejected';
  }

  private async sendOne(item: StoredOutboxItem) {
    const create = 'claimSecretHash' in item.body;
    const path = create ? '/v1/receipts' : `/v1/receipts/${item.receiptId}/versions`;
    const res = await this.post(path, JSON.stringify(item.body), item.idempotencyKey);
    if (res.ok) return { item, status: 'ok' as const };
    const err = await res.json().then(
      (j: unknown) => (typeof j === 'object' && j !== null && 'error' in j && typeof j.error === 'string' ? j.error : undefined),
      () => undefined,
    );
    return { item, status: this.classify(res.status, err), reason: `${res.status} ${err ?? ''}`.trim() };
  }

  private async sendBatch(items: StoredOutboxItem[]) {
    const body = JSON.stringify({ items: items.map((i) => ({ idempotencyKey: i.idempotencyKey, body: i.body })) });
    const res = await this.post('/v1/receipts:batch', body);
    if (!res.ok) {
      const status = this.classify(res.status, undefined);
      if (status === 'retry') throw new Error(`batch ${res.status}`);
      // whole batch rejected (e.g. 401): treat as retryable; the key may be rotated
      throw new Error(`batch ${res.status}`);
    }
    const json: unknown = await res.json();
    const results = typeof json === 'object' && json !== null && 'results' in json && Array.isArray(json.results) ? json.results : [];
    return items.map((item, idx) => {
      const r: unknown = results[idx];
      const rec = typeof r === 'object' && r !== null ? (r as Record<string, unknown>) : {};
      if (rec.status === 'created' || rec.status === 'replayed') return { item, status: 'ok' as const };
      const httpStatus = typeof rec.httpStatus === 'number' ? rec.httpStatus : 500;
      const error = typeof rec.error === 'string' ? rec.error : undefined;
      return { item, status: this.classify(httpStatus, error), reason: `${httpStatus} ${error ?? ''}`.trim() };
    });
  }

  // ------------------------------------------------------------- flusher loop

  /** Background flusher: drains the queue, then retries with exponential backoff + jitter after failures. */
  startFlusher(opts: { idleMs?: number } = {}): void {
    if (this.running) return;
    this.running = true;
    const idle = opts.idleMs ?? 1000;
    const tick = async () => {
      if (!this.running) return;
      let delay = idle;
      try {
        const r = await this.flush();
        if (r.retry) delay = backoffMs(this.attempt++, (this.cfg.random ?? Math.random)());
        else this.attempt = 0;
      } catch {
        delay = backoffMs(this.attempt++, (this.cfg.random ?? Math.random)());
      }
      if (this.running) this.timer = setTimeout(tick, delay);
    };
    void tick();
  }

  stopFlusher(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }
}

export type { OutboxItem };
