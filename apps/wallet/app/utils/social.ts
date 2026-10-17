/** Small helpers shared by the friends, share and split pages. */
import type { MessageKey } from '../i18n/index.ts';
import { ApiError } from './api.ts';
import type { PublicUser } from './api-schemas.ts';

export const AVATARS = ['😀', '😎', '🤓', '🥳', '🦊', '🐼', '🐸', '🦄', '🍕', '🌵', '🚲', '⭐'] as const;

/** Mirrors the HANDLE_RE hint: what is wrong with this handle, or null when fine. */
export function handleHint(raw: string): 'tooShort' | 'tooLong' | 'chars' | null {
  if (!/^[a-z0-9_]*$/.test(raw)) return 'chars';
  if (raw.length < 3) return 'tooShort';
  if (raw.length > 20) return 'tooLong';
  return null;
}

export function userName(u: Pick<PublicUser, 'displayName' | 'handle'>): string {
  return u.displayName ?? (u.handle ? `@${u.handle}` : '?');
}

const CODES: Record<string, MessageKey> = {
  handle_taken: 'social.err.handleTaken',
  no_such_handle: 'social.err.noSuchHandle',
  already_friends: 'social.err.alreadyFriends',
  already_requested: 'social.err.alreadyRequested',
  self: 'social.err.self',
  invalid_invite: 'social.err.invalidInvite',
};

/** Message key for any error thrown by the api client. */
export function errorKey(e: unknown): MessageKey {
  if (e instanceof ApiError) {
    if (e.isNetwork) return 'social.offline';
    return CODES[e.code] ?? 'social.err.generic';
  }
  return 'social.err.generic';
}

export function isOffline(e: unknown): boolean {
  return e instanceof ApiError && e.isNetwork;
}

/** Copy to the clipboard; false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function inviteLink(receiptHost: string, code: string): string {
  return `${receiptHost.replace(/\/+$/, '')}/i/${code}`;
}
