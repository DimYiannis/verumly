import Database from 'better-sqlite3';
import type { Crf } from '@lr/schema';
import type { LocalReceipt, OutboxItem, OutboxStore, StoredOutboxItem } from './store.ts';

interface ItemRow {
  seq: number;
  receipt_id: string;
  version: number;
  idempotency_key: string;
  body: string;
}

/** Durable SQLite outbox (WAL, synchronous=FULL) so a crash never loses a signed version. */
export class SqliteStore implements OutboxStore {
  private db: Database.Database;

  constructor(file: string) {
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.exec(`
      create table if not exists receipts (receipt_id text primary key, secret text not null, crf text not null);
      create table if not exists outbox (
        seq integer primary key autoincrement,
        receipt_id text not null, version integer not null,
        idempotency_key text not null, body text not null
      );
      create table if not exists rejected (
        seq integer primary key, receipt_id text not null, version integer not null,
        idempotency_key text not null, body text not null, reason text not null
      );
    `);
  }

  close() {
    this.db.close();
  }

  async commit(receipt: LocalReceipt, item: OutboxItem) {
    const tx = this.db.transaction(() => {
      this.db
        .prepare('insert into receipts (receipt_id, secret, crf) values (?, ?, ?) on conflict(receipt_id) do update set crf = excluded.crf')
        .run(receipt.receiptId, receipt.secret, JSON.stringify(receipt.crf));
      this.db
        .prepare('insert into outbox (receipt_id, version, idempotency_key, body) values (?, ?, ?, ?)')
        .run(item.receiptId, item.version, item.idempotencyKey, JSON.stringify(item.body));
    });
    tx();
  }

  async getReceipt(receiptId: string): Promise<LocalReceipt | undefined> {
    const row = this.db.prepare('select secret, crf from receipts where receipt_id = ?').get(receiptId) as { secret: string; crf: string } | undefined;
    if (!row) return undefined;
    return { receiptId, secret: row.secret, crf: JSON.parse(row.crf) as Crf };
  }

  private map(r: ItemRow): StoredOutboxItem {
    return {
      seq: r.seq,
      receiptId: r.receipt_id,
      version: r.version,
      idempotencyKey: r.idempotency_key,
      body: JSON.parse(r.body),
    };
  }

  async pending(limit: number) {
    return (this.db.prepare('select * from outbox order by seq limit ?').all(limit) as ItemRow[]).map((r) => this.map(r));
  }

  async remove(seqs: number[]) {
    const del = this.db.prepare('delete from outbox where seq = ?');
    this.db.transaction(() => seqs.forEach((s) => del.run(s)))();
  }

  async reject(seqs: number[], reason: string) {
    const ins = this.db.prepare('insert into rejected select seq, receipt_id, version, idempotency_key, body, ? from outbox where seq = ?');
    const del = this.db.prepare('delete from outbox where seq = ?');
    this.db.transaction(() =>
      seqs.forEach((s) => {
        ins.run(reason, s);
        del.run(s);
      }),
    )();
  }

  async pendingAfter(receiptId: string, version: number) {
    return (this.db.prepare('select * from outbox where receipt_id = ? and version > ? order by seq').all(receiptId, version) as ItemRow[]).map((r) =>
      this.map(r),
    );
  }

  async stats() {
    const p = this.db.prepare('select count(*) c from outbox').get() as { c: number };
    const r = this.db.prepare('select count(*) c from rejected').get() as { c: number };
    return { pending: p.c, rejected: r.c };
  }
}
