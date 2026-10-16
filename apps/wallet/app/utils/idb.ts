/** IndexedDB persistence for the wallet: pending claims, offline receipt cache, session. Uses `idb`. */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { z } from 'zod';
import type { ClaimStorage, StoredClaim } from './pending-claims.ts';
import type { ReceiptDetail, ReceiptListItem } from './api-schemas.ts';

export interface Session {
  token: string;
  userId: string;
  email: string;
}

interface WalletSchema extends DBSchema {
  pendingClaims: { key: string; value: StoredClaim };
  receipts: { key: string; value: { receiptId: string; detail: ReceiptDetail; cachedAt: number } };
  receiptList: { key: string; value: ReceiptListItem };
  kv: { key: string; value: unknown };
}

export type WalletDb = IDBPDatabase<WalletSchema>;

export function openWalletDb(name = 'lr-wallet'): Promise<WalletDb> {
  return openDB<WalletSchema>(name, 1, {
    upgrade(db) {
      db.createObjectStore('pendingClaims', { keyPath: 'receiptId' });
      db.createObjectStore('receipts', { keyPath: 'receiptId' });
      db.createObjectStore('receiptList', { keyPath: 'receiptId' });
      db.createObjectStore('kv');
    },
  });
}

export function createIdbClaimStorage(db: Promise<WalletDb>): ClaimStorage {
  return {
    get: async (id) => (await db).get('pendingClaims', id),
    getAll: async () => (await db).getAll('pendingClaims'),
    async put(claim) {
      await (await db).put('pendingClaims', claim);
    },
    async delete(id) {
      await (await db).delete('pendingClaims', id);
    },
  };
}

/** Receipts the buyer has saved, readable offline. */
export function createReceiptCache(db: Promise<WalletDb>, now: () => number = Date.now) {
  return {
    async putDetail(detail: ReceiptDetail): Promise<void> {
      await (await db).put('receipts', { receiptId: detail.receipt.receiptId, detail, cachedAt: now() });
    },
    async getDetail(receiptId: string): Promise<ReceiptDetail | undefined> {
      return (await (await db).get('receipts', receiptId))?.detail;
    },
    /** Replace the cached wallet list with the first page just fetched. */
    async replaceList(items: ReceiptListItem[]): Promise<void> {
      const tx = (await db).transaction('receiptList', 'readwrite');
      await tx.store.clear();
      for (const item of items) await tx.store.put(item);
      await tx.done;
    },
    async addToList(items: ReceiptListItem[]): Promise<void> {
      const tx = (await db).transaction('receiptList', 'readwrite');
      for (const item of items) await tx.store.put(item);
      await tx.done;
    },
    async getList(): Promise<ReceiptListItem[]> {
      return (await (await db).getAll('receiptList')).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    /** Called on logout and account deletion: a shared phone must not keep someone's receipts. */
    async clear(): Promise<void> {
      const d = await db;
      await Promise.all([d.clear('receipts'), d.clear('receiptList')]);
    },
  };
}
export type ReceiptCache = ReturnType<typeof createReceiptCache>;

export function createKv(db: Promise<WalletDb>) {
  return {
    async get<T extends z.ZodType>(key: string, schema: T): Promise<z.infer<T> | undefined> {
      const raw = await (await db).get('kv', key);
      const parsed = schema.safeParse(raw);
      return parsed.success ? parsed.data : undefined;
    },
    async set(key: string, value: unknown): Promise<void> {
      await (await db).put('kv', value, key);
    },
    async delete(key: string): Promise<void> {
      await (await db).delete('kv', key);
    },
  };
}
export type Kv = ReturnType<typeof createKv>;
