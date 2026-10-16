/** Web Push payload from the worker's `notify-version` job. Contains no receipt content: title, text and the receipt id. */
import { UUIDV7_RE } from './receipt-link.ts';

export interface PushPayload {
  title: string;
  body: string;
  receiptId: string | null;
  version: number | null;
  final: boolean;
}

const FALLBACK: PushPayload = { title: 'Bonnen', body: 'Je hebt een nieuwe update.', receiptId: null, version: null, final: false };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Never throws: a malformed push still shows a generic notification (browsers require one per push). */
export function parsePushPayload(raw: string | null): PushPayload {
  if (!raw) return FALLBACK;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return FALLBACK;
  }
  if (!isRecord(data)) return FALLBACK;
  const str = (key: string): string | null => {
    const v = data[key];
    return typeof v === 'string' && v.length > 0 ? v.slice(0, 200) : null;
  };
  const id = str('receiptId');
  const version = data.version;
  return {
    title: str('title') ?? FALLBACK.title,
    body: str('body') ?? FALLBACK.body,
    receiptId: id && UUIDV7_RE.test(id) ? id : null,
    version: typeof version === 'number' && Number.isInteger(version) ? version : null,
    final: data.final === true,
  };
}

/** Where a notification click goes: the receipt's detail page, or the wallet. */
export function notificationTarget(data: unknown): string {
  const id = typeof data === 'object' && data !== null && 'receiptId' in data ? data.receiptId : null;
  return typeof id === 'string' && UUIDV7_RE.test(id) ? `/receipts/${id}` : '/';
}
