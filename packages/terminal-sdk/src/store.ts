import type { Crf } from '@lr/schema';

/** Latest local state of a receipt on the terminal. The secret never leaves the terminal except in the QR URL. */
export interface LocalReceipt {
  receiptId: string;
  secret: string;
  crf: Crf;
}

export interface OutboxItem {
  /** assigned by the store; defines upload order */
  seq?: number;
  receiptId: string;
  version: number;
  idempotencyKey: string;
  /** the exact body to POST: `{version, signature, claimSecretHash?}` */
  body: { version: Crf; signature: string; claimSecretHash?: string };
}

export interface StoredOutboxItem extends OutboxItem {
  seq: number;
}

/**
 * Durable terminal-side storage. SQLite in Node (`SqliteStore`), IndexedDB in the browser simulator;
 * both implement this interface. `commit` MUST be atomic: a receipt state and its outbox item are
 * stored together or not at all.
 */
export interface OutboxStore {
  commit(receipt: LocalReceipt, item: OutboxItem): Promise<void>;
  getReceipt(receiptId: string): Promise<LocalReceipt | undefined>;
  /** oldest-first */
  pending(limit: number): Promise<StoredOutboxItem[]>;
  remove(seqs: number[]): Promise<void>;
  /** move to the dead-letter list (non-retryable server rejection) */
  reject(seqs: number[], reason: string): Promise<void>;
  /** pending items for receipt that have a version greater than `version`; used to cascade rejections */
  pendingAfter(receiptId: string, version: number): Promise<StoredOutboxItem[]>;
  stats(): Promise<{ pending: number; rejected: number }>;
}

export class MemoryStore implements OutboxStore {
  private receipts = new Map<string, LocalReceipt>();
  private items: StoredOutboxItem[] = [];
  private rejected: Array<{ item: StoredOutboxItem; reason: string }> = [];
  private seq = 0;

  async commit(receipt: LocalReceipt, item: OutboxItem) {
    this.receipts.set(receipt.receiptId, structuredClone(receipt));
    this.items.push({ ...structuredClone(item), seq: ++this.seq });
  }
  async getReceipt(receiptId: string) {
    const r = this.receipts.get(receiptId);
    return r ? structuredClone(r) : undefined;
  }
  async pending(limit: number) {
    return this.items.slice(0, limit).map((i) => structuredClone(i));
  }
  async remove(seqs: number[]) {
    this.items = this.items.filter((i) => !seqs.includes(i.seq));
  }
  async reject(seqs: number[], reason: string) {
    for (const i of this.items.filter((x) => seqs.includes(x.seq))) this.rejected.push({ item: i, reason });
    this.items = this.items.filter((i) => !seqs.includes(i.seq));
  }
  async pendingAfter(receiptId: string, version: number) {
    return this.items.filter((i) => i.receiptId === receiptId && i.version > version);
  }
  async stats() {
    return { pending: this.items.length, rejected: this.rejected.length };
  }
}
