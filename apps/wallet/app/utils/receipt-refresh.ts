/** How an open receipt page notices a new version (a void, a correction) without a manual reload. */

/** Modest: the buyer sees a void within a few seconds, and only a visible, online page asks at all. */
export const RECEIPT_REFRESH_MS = 5_000;

export interface RefreshContext {
  /** `document.visibilityState === 'visible'` */
  visible: boolean;
  online: boolean;
}

/** A hidden page or a dead network never polls; the visibility/online events trigger one fetch on return. */
export function shouldPollReceipt(ctx: RefreshContext): boolean {
  return ctx.visible && ctx.online;
}

/** Only a strictly newer version replaces what is on screen (an older response is a stale replica or a retry). */
export function isNewerVersion(current: { receipt: { version: number } } | null, fresh: { receipt: { version: number } }): boolean {
  return current === null || fresh.receipt.version > current.receipt.version;
}
