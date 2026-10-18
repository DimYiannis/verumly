import QRCode from 'qrcode';
import { generateSecret, hashSecret, newReceiptId, signBytes, signPayload } from '@lr/crypto';
import { getFormat } from '@lr/compliance';
import { MemoryFiscalState, sandboxIntegration, type FiscalSettings, type FiscalStateStore, type StateIntegration } from '@lr/fiscal';
import { cashRounding, checkTransition, deriveVatSummary, lineTotal, validateCrf, type Issue } from '@lr/receipt-nl';
import type { Crf, CrfLine } from '@lr/schema';
import { scrubCode, scrubDescription, toQty, type Draft, type DraftLine } from './mapping.ts';
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
  /** `kvkNumber` is the company registry number of `country` (KvK, SIRET, Steuernummer, ...) */
  merchant: { kvkNumber: string; vatNumber: string | null; name: string; locationId: string };
  /** the organisation's country, ISO 3166-1 alpha-2 (default NL): decides currency, VAT rates, cash rounding and the fiscal step */
  country?: string;
  /**
   * The state integration for countries where a receipt is final only after a fiscal step (DE, IT, PL, ...). Defaults to
   * the sandbox (made-up data, `extra.mode = "sandbox"`); pass `gatewayIntegration(...)` or your own to go live.
   * `settings` are the business's country settings from the setup screen; `state` keeps counters and hash chains.
   */
  fiscal?: {
    integration?: StateIntegration;
    settings?: FiscalSettings;
    state?: FiscalStateStore;
    /** fiscalise right after a receipt is paid (default true) */
    auto?: boolean;
  };
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

/** The state integration refused or could not be reached. A retryable failure leaves the receipt `paid`: call `fiscalise` again. */
export class FiscalError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, retryable: boolean) {
    super(`fiscalisation failed: ${code}`);
    this.code = code;
    this.retryable = retryable;
  }
}

export interface FlushResult {
  sent: number;
  rejected: number;
  /** true when the pass stopped on a network/5xx/gap error and should be retried with backoff */
  retry: boolean;
}

/** What the server said about one queued item. */
interface SendOutcome {
  item: StoredOutboxItem;
  status: 'ok' | 'retry' | 'rejected';
  reason?: string;
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
  private readonly country: string;
  private readonly integration: StateIntegration;
  private readonly fiscalState: FiscalStateStore;
  /** fiscal submissions run one after the other: counters and hash chains must not interleave */
  private fiscalQueue: Promise<unknown> = Promise.resolve();

  constructor(cfg: SdkConfig) {
    this.cfg = cfg;
    this.country = (cfg.country ?? 'NL').toUpperCase();
    if (!getFormat(this.country)) throw new Error(`unsupported country ${this.country}`);
    this.integration = cfg.fiscal?.integration ?? sandboxIntegration(this.country);
    this.fiscalState = cfg.fiscal?.state ?? new MemoryFiscalState();
  }

  /** Does a paid receipt of this till still need the fiscal step before it is final? */
  get needsFiscalStep(): boolean {
    return getFormat(this.country)?.fiscal === 'required';
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
    await this.fiscaliseIfDue(receiptId, crf.state);
    return { receiptId, secret, qrUrl: this.qrUrl(receiptId, secret) };
  }

  /** Build, validate, sign and queue the next version. `patch` overrides fields of the previous version's draft. */
  async addVersion(receiptId: string, patch: Partial<Draft>): Promise<{ version: number; state: Crf['state'] }> {
    const prev = await this.cfg.store.getReceipt(receiptId);
    if (!prev) throw new Error(`unknown receipt ${receiptId}`);
    const draft = this.draftFrom(prev.crf, patch);
    const crf = this.buildCrf(receiptId, prev.crf.version + 1, draft, prev.crf.voidOf);
    this.assertValid(crf, prev.crf.state);
    const done = await this.commitVersion(prev, crf);
    return (await this.fiscaliseIfDue(receiptId, crf.state)) ?? done;
  }

  /**
   * Run the country's fiscal step for a `paid` receipt and queue the `fiscalised` version with what it returns. Throws
   * `FiscalError` when the integration fails (a retryable failure leaves the receipt paid: call this again later).
   */
  fiscalise(receiptId: string): Promise<{ version: number; state: Crf['state'] }> {
    const run = this.fiscalQueue.then(() => this.fiscaliseNow(receiptId));
    this.fiscalQueue = run.catch(() => undefined);
    return run;
  }

  private async fiscaliseNow(receiptId: string) {
    const prev = await this.cfg.store.getReceipt(receiptId);
    if (!prev) throw new Error(`unknown receipt ${receiptId}`);
    if (prev.crf.state === 'fiscalised') return { version: prev.crf.version, state: prev.crf.state };
    if (prev.crf.state !== 'paid') throw new Error(`only a paid receipt can be fiscalised (it is ${prev.crf.state})`);
    if (getFormat(this.country)?.fiscal === 'none') throw new FiscalError('no_fiscal_step', false);
    const res = await this.integration.submit({ receipt: prev.crf, settings: this.cfg.fiscal?.settings ?? {}, state: this.fiscalState, terminalId: this.cfg.terminalId });
    if (!res.ok) throw new FiscalError(res.code, res.retryable);
    const crf: Crf = {
      ...prev.crf,
      version: prev.crf.version + 1,
      state: 'fiscalised',
      createdAt: this.now(),
      fiscal: { country: this.country, registerSerial: res.registerSerial, documentNumber: res.documentNumber, extra: res.extra },
    };
    this.assertValid(crf, prev.crf.state);
    return this.commitVersion(prev, crf);
  }

  /** After a version was committed as `paid`: fiscalise it when the country needs that and `auto` is not off. A retryable failure is left for a later `fiscalise`. */
  private async fiscaliseIfDue(receiptId: string, state: Crf['state']) {
    if (state !== 'paid' || !this.needsFiscalStep || this.cfg.fiscal?.auto === false) return undefined;
    try {
      return await this.fiscalise(receiptId);
    } catch (e) {
      if (e instanceof FiscalError && e.retryable) return undefined;
      throw e;
    }
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
    const issues = validateCrf(crf, { country: this.country });
    const t = checkTransition(from, crf.state, this.country);
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
        sku: scrubCode(l.sku),
        description: scrubDescription(l.description),
        qty,
        unitPrice: l.unitPrice,
        vatRate: kind === 'deposit' ? null : l.vatRate,
        discount,
        total: lineTotal(qty, l.unitPrice, discount),
        category: scrubCode(l.category),
      };
    });
    const gross = lines.reduce((s, l) => s + l.total, 0);
    const vatSummary = deriveVatSummary(lines);
    const tip = draft.tip ?? 0;
    const format = getFormat(this.country)!;

    let payments: Crf['payments'] = [];
    let rounding = 0;
    if (draft.state === 'paid') {
      const given = draft.payments ?? [{ method: 'card' as const }];
      const onlyCash = given.length === 1 && given[0]!.method === 'cash' && given[0]!.amount === undefined;
      rounding = draft.rounding ?? (onlyCash && format.cashRoundingStep ? cashRounding(gross + tip, format.cashRoundingStep) : 0);
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
      currency: format.currency,
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
      fiscal: { country: this.country, registerSerial: null, documentNumber: draft.documentNumber ?? null, extra: {} },
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
      let outcomes: SendOutcome[];
      try {
        outcomes = items.length === 1 ? [await this.sendOne(items[0]!)] : await this.sendBatch(items);
      } catch {
        out.retry = true; // network failure: nothing was acknowledged, keep everything queued
        return out;
      }
      const done = outcomes.filter((o) => o.status === 'ok').map((o) => o.item.seq);
      await this.cfg.store.remove(done);
      out.sent += done.length;
      const dead = new Set<number>();
      for (const o of outcomes.filter((x) => x.status === 'rejected')) {
        if (dead.has(o.item.seq)) continue; // already dead-lettered as a later version of an earlier rejection
        const cascade = await this.cfg.store.pendingAfter(o.item.receiptId, o.item.version);
        const seqs = [o.item.seq, ...cascade.map((c) => c.seq)];
        await this.cfg.store.reject(seqs, o.reason ?? 'rejected');
        for (const s of seqs) dead.add(s);
        out.rejected += seqs.length;
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

  private async sendEach(items: StoredOutboxItem[]) {
    const outcomes: SendOutcome[] = [];
    for (const item of items) {
      outcomes.push(await this.sendOne(item).catch(() => ({ item, status: 'retry' as const, reason: 'network error' })));
      if (outcomes.at(-1)?.status === 'retry') {
        // stop at the first transient failure: later items must not overtake it
        for (const rest of items.slice(outcomes.length)) outcomes.push({ item: rest, status: 'retry' as const, reason: 'not attempted' });
        break;
      }
    }
    return outcomes;
  }

  private async sendBatch(items: StoredOutboxItem[]) {
    const body = JSON.stringify({ items: items.map((i) => ({ idempotencyKey: i.idempotencyKey, body: i.body })) });
    const res = await this.post('/v1/receipts:batch', body);
    if (!res.ok) {
      if (this.classify(res.status, undefined) === 'retry') throw new Error(`batch ${res.status}`);
      // The server refused the whole batch for a reason retrying cannot fix (401 revoked or rotated key, 400 because one
      // item is malformed, 413…). Retrying for ever would block every later receipt behind it, so deliver item by item:
      // each item gets the verdict a single upload would get, the offender is dead-lettered together with its later
      // versions, and everything else still flows.
      return this.sendEach(items);
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
