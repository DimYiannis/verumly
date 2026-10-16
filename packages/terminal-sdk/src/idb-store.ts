import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { LocalReceipt, OutboxItem, OutboxStore, StoredOutboxItem } from './store.ts';

interface RejectedItem extends StoredOutboxItem {
  reason: string;
}

function stored(item: OutboxItem): StoredOutboxItem {
  if (item.seq === undefined) throw new Error('outbox item without seq');
  return { ...item, seq: item.seq };
}

interface TerminalDb extends DBSchema {
  receipts: { key: string; value: LocalReceipt };
  /** `seq` is assigned by the auto-increment key generator on insert */
  outbox: { key: number; value: OutboxItem; indexes: { byReceipt: string } };
  rejected: { key: number; value: RejectedItem };
}

/**
 * Browser outbox in IndexedDB (the simulator's terminal). Same contract as `SqliteStore`/`MemoryStore`:
 * `commit` writes the receipt state and its outbox item in ONE transaction, so a closed tab never leaves
 * a signed version without its queue entry (or the reverse). `seq` comes from an auto-increment key.
 */
export class IndexedDbStore implements OutboxStore {
  private db: Promise<IDBPDatabase<TerminalDb>>;

  constructor(name = 'lr-terminal') {
    this.db = openDB<TerminalDb>(name, 1, {
      upgrade(db) {
        db.createObjectStore('receipts', { keyPath: 'receiptId' });
        const outbox = db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
        outbox.createIndex('byReceipt', 'receiptId');
        db.createObjectStore('rejected', { keyPath: 'seq' });
      },
    });
  }

  async close() {
    (await this.db).close();
  }

  async commit(receipt: LocalReceipt, item: OutboxItem) {
    const tx = (await this.db).transaction(['receipts', 'outbox'], 'readwrite');
    const { seq: _seq, ...rest } = item;
    const writes: Array<Promise<unknown>> = [tx.done];
    try {
      writes.push(tx.objectStore('receipts').put(receipt));
      writes.push(tx.objectStore('outbox').add(rest));
      await Promise.all(writes);
    } catch (e) {
      // a synchronous failure (e.g. DataCloneError on the second write) would otherwise still commit the first
      try {
        tx.abort();
      } catch {
        // already finished
      }
      await Promise.allSettled(writes);
      throw e;
    }
  }

  async getReceipt(receiptId: string) {
    return (await this.db).get('receipts', receiptId);
  }

  async pending(limit: number) {
    return (await (await this.db).getAll('outbox', null, limit)).map(stored);
  }

  async remove(seqs: number[]) {
    const tx = (await this.db).transaction('outbox', 'readwrite');
    await Promise.all([...seqs.map((s) => tx.store.delete(s)), tx.done]);
  }

  async reject(seqs: number[], reason: string) {
    const tx = (await this.db).transaction(['outbox', 'rejected'], 'readwrite');
    for (const seq of seqs) {
      const row = await tx.objectStore('outbox').get(seq);
      if (!row) continue;
      await tx.objectStore('rejected').put({ ...stored(row), reason });
      await tx.objectStore('outbox').delete(seq);
    }
    await tx.done;
  }

  async pendingAfter(receiptId: string, version: number) {
    const items = await (await this.db).getAllFromIndex('outbox', 'byReceipt', receiptId);
    return items
      .map(stored)
      .filter((i) => i.version > version)
      .sort((a, b) => a.seq - b.seq);
  }

  async stats() {
    const db = await this.db;
    return { pending: await db.count('outbox'), rejected: await db.count('rejected') };
  }
}
