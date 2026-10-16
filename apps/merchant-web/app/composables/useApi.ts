import { formatEuro } from '@lr/receipt-nl';

/** Human-readable message from a failed `$fetch` (Nitro puts the reason in `statusMessage`). */
export function errorMessage(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    if ('statusMessage' in e && typeof e.statusMessage === 'string' && e.statusMessage) return e.statusMessage;
    if ('data' in e && typeof e.data === 'object' && e.data !== null && 'statusMessage' in e.data && typeof e.data.statusMessage === 'string') return e.data.statusMessage;
    if ('message' in e && typeof e.message === 'string') return e.message;
  }
  return 'Something went wrong';
}

export type Role = 'owner' | 'manager' | 'accountant';

export interface SessionUser {
  email: string;
  role: Role;
  orgName: string;
}

export interface SessionState {
  state: 'anonymous' | 'mfa_enrol' | 'mfa_verify' | 'ready';
  user?: SessionUser;
}

export const sessionState = () => useState<SessionState>('dashboard-session', () => ({ state: 'anonymous' }));

export async function refreshSession(): Promise<SessionState> {
  const s = await $fetch<SessionState>('/api/dashboard/session');
  sessionState().value = s;
  return s;
}

/** Wraps a request: sets `error` on failure, returns undefined. */
export async function attempt<T>(error: Ref<string>, fn: () => Promise<T>): Promise<T | undefined> {
  error.value = '';
  try {
    return await fn();
  } catch (e) {
    error.value = errorMessage(e);
    return undefined;
  }
}

export function euro(cents: number): string {
  return formatEuro(cents);
}

export function amsterdam(iso: string | Date): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Amsterdam' }).format(new Date(iso));
}
