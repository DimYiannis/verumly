/** Receipt link parsing and fragment handling (v2 §2.5). Pure: no Vue, no Nuxt, no globals. */

export const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** 256-bit secret, base64url without padding */
export const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
const RECEIPT_PATH_RE = /^\/r\/([^/]+)\/?$/;

export interface ReceiptLink {
  receiptId: string;
  secret: string;
}

/** Parse `https://host/r/<uuidv7>#<43 base64url>`; also accepts a bare path. Anything off-spec returns null. */
export function parseReceiptLink(url: string): ReceiptLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url, 'http://wallet.invalid');
  } catch {
    return null;
  }
  const path = RECEIPT_PATH_RE.exec(parsed.pathname);
  const receiptId = path?.[1];
  if (!receiptId || !UUIDV7_RE.test(receiptId)) return null;
  const secret = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : '';
  if (!SECRET_RE.test(secret)) return null;
  return { receiptId, secret };
}

export interface FragmentEnv {
  location: { pathname: string; search: string; hash: string };
  history: { state: unknown; replaceState(data: unknown, unused: string, url?: string | null): void };
}

/**
 * On a receipt path: remember a well-formed secret in `vault` (memory only), then remove the fragment from
 * the address bar with history.replaceState. Any fragment on /r/ is stripped, valid or not.
 */
export function consumeReceiptFragment(env: FragmentEnv, vault: Record<string, string>): ReceiptLink | null {
  const { pathname, search, hash } = env.location;
  if (!RECEIPT_PATH_RE.test(pathname) || hash === '') return null;
  const link = parseReceiptLink(`${pathname}${hash}`);
  if (link) vault[link.receiptId] = link.secret;
  env.history.replaceState(env.history.state, '', `${pathname}${search}`);
  return link;
}
