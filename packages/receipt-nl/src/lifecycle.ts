import type { ReceiptState } from '@lr/schema';

/** Allowed state transitions (v2 §6). `from === null` means the receipt starts here. */
const TRANSITIONS: Record<ReceiptState, readonly ReceiptState[]> = {
  open: ['presented', 'paid', 'void'],
  presented: ['presented', 'paid', 'void'],
  paid: ['fiscalised', 'void'],
  fiscalised: ['void'],
  void: [],
};

const START_STATES: readonly ReceiptState[] = ['open', 'presented', 'paid'];

export type TransitionResult = { ok: true } | { ok: false; reason: 'bad_transition' | 'fiscalised_not_allowed_nl' };

export function checkTransition(from: ReceiptState | null, to: ReceiptState, country = 'NL'): TransitionResult {
  if (to === 'fiscalised' && country === 'NL') return { ok: false, reason: 'fiscalised_not_allowed_nl' };
  if (from === null) return START_STATES.includes(to) ? { ok: true } : { ok: false, reason: 'bad_transition' };
  return TRANSITIONS[from].includes(to) ? { ok: true } : { ok: false, reason: 'bad_transition' };
}

/** A state is final for the buyer: no further edits are expected. NL: `paid` (and `void`). */
export function isFinalState(state: ReceiptState, country = 'NL'): boolean {
  if (state === 'void') return true;
  return country === 'NL' ? state === 'paid' : state === 'fiscalised';
}

/** `open` receipts are never visible to resolvers. */
export function isVisibleToResolvers(state: ReceiptState): boolean {
  return state !== 'open';
}
