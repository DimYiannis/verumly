/** Bearer session (opaque token from /v1/auth/email/verify) kept in IndexedDB. */
import { z } from 'zod';
import type { Kv, Session } from './idb.ts';

export const sessionSchema = z.object({ token: z.string().min(20), userId: z.string(), email: z.string() });

const KEY = 'session';

export function createSessionStore(kv: Kv) {
  let current: Session | null = null;
  return {
    async load(): Promise<Session | null> {
      current = (await kv.get(KEY, sessionSchema)) ?? null;
      return current;
    },
    peek: (): Session | null => current,
    async save(session: Session): Promise<void> {
      current = session;
      await kv.set(KEY, session);
    },
    async clear(): Promise<void> {
      current = null;
      await kv.delete(KEY);
    },
  };
}
export type SessionStore = ReturnType<typeof createSessionStore>;
