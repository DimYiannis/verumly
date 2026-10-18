import type { Crf } from '@lr/schema';

/** One value the country's fiscal system puts on the receipt. It is stored in `crf.fiscal.extra[key]`. */
export interface FiscalField {
  key: string;
  /** printed next to the value on the receipt, in the language of the country */
  label: string;
}

/**
 * How a country's "state" side works, in terms of what the receipt needs from it.
 * - `signature_device`: a certified local device or module signs each receipt (DE TSE, SE control unit, AT, BE, LT, LV, MT, ...)
 * - `realtime_report`: the receipt is reported to the tax authority as it is issued and comes back with an id (HU, PL, SK, HR, RO, GR, SI, BG, CY)
 * - `chained_software`: certified software chains receipts by hash and prints a code (FR, PT, ES Verifactu, IT RT)
 */
export type FiscalKind = 'signature_device' | 'realtime_report' | 'chained_software';

export interface FiscalSpec {
  country: string;
  /** name of the system, as the business knows it */
  system: string;
  authority: string;
  kind: FiscalKind;
  /** one plain sentence: what has to happen before the receipt is final */
  how: string;
  /** keys of the country's legal settings (`@lr/compliance`) this integration reads */
  needs: string[];
  fields: FiscalField[];
}

export type FiscalSettings = Record<string, string | boolean>;

/** Small durable key-value store for counters and hash chains. The terminal keeps it; the default lives in memory. */
export interface FiscalStateStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export class MemoryFiscalState implements FiscalStateStore {
  private m = new Map<string, string>();
  async get(key: string) {
    return this.m.get(key);
  }
  async set(key: string, value: string) {
    this.m.set(key, value);
  }
}

export interface FiscalContext {
  /** the receipt version in state `paid`, about to become `fiscalised` */
  receipt: Crf;
  settings: FiscalSettings;
  state: FiscalStateStore;
  /** terminal identity, used to name sandbox registers */
  terminalId: string;
}

export type FiscalResult =
  | {
      ok: true;
      /** `sandbox`: made up locally, nothing was sent to any authority. `live`: the authority or a certified device answered. */
      mode: 'sandbox' | 'live';
      /** goes to `fiscal.documentNumber` / `fiscal.registerSerial` */
      documentNumber: string | null;
      registerSerial: string | null;
      /** goes to `fiscal.extra`; keys are the country's `FiscalField.key`s */
      extra: Record<string, string>;
    }
  | { ok: false; retryable: boolean; code: string };

/**
 * The integration point with the state, per country. The terminal calls `submit` for a paid receipt, and signs the
 * `fiscalised` version with what comes back. Implementations: `sandboxIntegration` (made-up data, for development and
 * demos), `gatewayIntegration` (a certified provider or a local fiscal service behind HTTP), or your own.
 */
export interface StateIntegration {
  country: string;
  spec: FiscalSpec | null;
  mode: 'sandbox' | 'live' | 'none';
  submit(ctx: FiscalContext): Promise<FiscalResult>;
}
