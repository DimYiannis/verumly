import { allowsFiscalised, endsInFiscalised } from '@lr/compliance';
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

export type TransitionResult = { ok: true } | { ok: false; reason: 'bad_transition' | 'fiscalised_not_allowed_nl' | 'fiscalised_not_allowed' };

export function checkTransition(from: ReceiptState | null, to: ReceiptState, country = 'NL'): TransitionResult {
  if (to === 'fiscalised' && !allowsFiscalised(country)) return { ok: false, reason: country === 'NL' ? 'fiscalised_not_allowed_nl' : 'fiscalised_not_allowed' };
  if (from === null) return START_STATES.includes(to) ? { ok: true } : { ok: false, reason: 'bad_transition' };
  return TRANSITIONS[from].includes(to) ? { ok: true } : { ok: false, reason: 'bad_transition' };
}

/**
 * A state is final for the buyer: no further edits are expected. `paid` where the country has no fiscal step (NL, GB, ...),
 * `fiscalised` where it has one (DE, IT, ...), either where the step is optional (BE). `void` is always final.
 */
export function isFinalState(state: ReceiptState, country = 'NL'): boolean {
  if (state === 'void') return true;
  if (state === 'fiscalised') return allowsFiscalised(country);
  return state === 'paid' && !endsInFiscalised(country);
}

/** `open` receipts are never visible to resolvers. */
export function isVisibleToResolvers(state: ReceiptState): boolean {
  return state !== 'open';
}
