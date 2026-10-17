/** Pure helpers for the "people first" part of the receipt page. */

export interface ShareRow {
  id: string;
  name: string;
  amountMinor: number;
  settled: boolean;
  isMe: boolean;
  lineNos: number[];
}

/** Cents still unsettled across all shares. */
export function openAmount(rows: ShareRow[]): number {
  return rows.filter((r) => !r.settled).reduce((a, r) => a + r.amountMinor, 0);
}

/** Who still owes: for the creator the other people with an open share, for a participant just themselves. */
export function splitHeadline(rows: ShareRow[], creatorIsMe: boolean): { names: string[] } {
  const owing = rows.filter((r) => !r.settled);
  return { names: creatorIsMe ? owing.filter((r) => !r.isMe).map((r) => r.name) : owing.filter((r) => r.isMe).map((r) => r.name) };
}

/** "Koffie ×1, Bier ×1", or the fallback when the share is not tied to lines (equal and custom splits). */
export function describeShare(parts: string[], fallback: string): string {
  return parts.length > 0 ? parts.join(', ') : fallback;
}
