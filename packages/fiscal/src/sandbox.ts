import { b64url, hexToBytes, sha256Hex } from '@lr/crypto';
import { getFiscalSpec } from './specs.ts';
import type { FiscalContext, FiscalResult, StateIntegration } from './types.ts';

/**
 * Made-up fiscal data with the shape of each country's system: counters, hash chains, signature-like strings, QR
 * payloads. NOTHING is sent to an authority and nothing is a real signature. Receipts carry `extra.mode = "sandbox"` and
 * a register serial that starts with `SBX-` unless the business entered a real one, so sandbox data can never pass for
 * the real thing. Use it to develop and demo a till; replace it with `gatewayIntegration` (or a device driver) to go live.
 */

const pad = (n: number | string, width: number) => String(n).padStart(width, '0');
const money = (minor: number) => (minor / 100).toFixed(2);
const day = (iso: string) => iso.slice(0, 10);
const upper = (s: string) => s.toUpperCase();
const uuidLike = (hex: string) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;

interface Tools {
  c: FiscalContext;
  /** value of a country setting, or a sandbox register name */
  set(key: string, fallback?: string): string;
  next(name: string): Promise<number>;
  /** extend the named hash chain with `data`; returns the new hash and the previous one */
  chain(name: string, data: string): Promise<{ hash: string; previous: string }>;
  sig(...parts: Array<string | number>): string;
  hash(...parts: Array<string | number>): string;
  qr(path: string, params: Record<string, string | number>): string;
}

interface Built {
  documentNumber: string;
  registerSerial: string | null;
  extra: Record<string, string>;
}

const BUILDERS: Record<string, (t: Tools) => Promise<Built>> = {
  AT: async (t) => {
    const kasse = t.set('kassenId');
    const n = await t.next('belegNr');
    const signature = t.sig('AT', kasse, n);
    return {
      documentNumber: String(n),
      registerSerial: kasse,
      extra: { kassenId: kasse, belegNr: String(n), signature, qr: `_R1-AT1_${kasse}_${n}_${t.c.receipt.createdAt}_${t.c.receipt.totals.gross}_${signature.slice(0, 24)}` },
    };
  },
  BE: async (t) => {
    const fdm = t.set('fdmSerial');
    const n = await t.next('ticket');
    return { documentNumber: String(n), registerSerial: fdm, extra: { fdmSerial: fdm, ticketCounter: String(n), signature: t.sig('BE', fdm, n).slice(0, 40) } };
  },
  BG: async (t) => {
    const device = t.set('fiscal_device_id');
    const n = await t.next('fiscalNo');
    const fiscalNo = pad(n, 10);
    return { documentNumber: fiscalNo, registerSerial: device, extra: { deviceId: device, fiscalNo, qr: `${device}*${fiscalNo}*${day(t.c.receipt.createdAt)}*${money(t.c.receipt.totals.gross)}` } };
  },
  CY: async (t) => {
    const device = t.set('fiscalDeviceSerial');
    const n = await t.next('receiptNo');
    return { documentNumber: String(n), registerSerial: device, extra: { deviceSerial: device, receiptNo: String(n) } };
  },
  DE: async (t) => {
    const tse = t.set('tseSerial');
    const till = t.set('tillId');
    const tx = await t.next('transactionNumber');
    const counter = await t.next('signatureCounter');
    return {
      documentNumber: String(tx),
      registerSerial: tse,
      extra: {
        tseSerial: tse,
        tillId: till,
        transactionNumber: String(tx),
        signatureCounter: String(counter),
        start: t.c.receipt.createdAt,
        end: t.c.receipt.createdAt,
        signature: t.sig('DE', tse, tx, counter),
      },
    };
  },
  ES: async (t) => {
    const r = t.c.receipt;
    const n = await t.next('invoice');
    const invoiceId = `${t.set('invoiceSeries', 'T')}-${n}`;
    const { hash, previous } = await t.chain('verifactu', `${invoiceId}|${r.createdAt}|${r.totals.gross}|${r.totals.vat}`);
    const qr = t.qr('verifactu', { nif: r.merchant.vatNumber ?? r.merchant.kvkNumber, numserie: invoiceId, fecha: day(r.createdAt), importe: money(r.totals.gross) });
    return { documentNumber: invoiceId, registerSerial: null, extra: { invoiceId, hash: upper(hash), previousHash: previous === '' ? 'GENESIS' : upper(previous), qr } };
  },
  FR: async (t) => {
    const r = t.c.receipt;
    const n = await t.next('sequence');
    const { hash } = await t.chain('nf525', `${n}|${r.createdAt}|${r.totals.gross}`);
    return { documentNumber: String(n), registerSerial: null, extra: { sequence: String(n), hash: upper(hash).slice(0, 32), software: t.set('tillSoftwareCertificate', 'SANDBOX') } };
  },
  GR: async (t) => {
    const n = await t.next('mark');
    const mark = `4000${pad(n, 11)}`;
    const fim = t.set('fimRegistrationNo');
    return { documentNumber: mark, registerSerial: fim, extra: { mark, uid: upper(t.hash('GR', mark)).slice(0, 40), fimNo: fim, qr: t.qr('mydata', { mark, uid: t.hash('GR', mark).slice(0, 12) }) } };
  },
  HR: async (t) => {
    const r = t.c.receipt;
    const n = await t.next('receipt');
    const premise = t.set('premiseCode', 'POS1');
    const register = t.set('registerCode', '1');
    const receiptNo = `${n}/${premise}/${register}`;
    const zki = t.hash('HR', 'zki', receiptNo).slice(0, 32);
    const jir = uuidLike(t.hash('HR', 'jir', receiptNo));
    return { documentNumber: receiptNo, registerSerial: `${premise}/${register}`, extra: { zki, jir, receiptNo, qr: t.qr('fiskal', { jir, datv: day(r.createdAt), izn: r.totals.gross }) } };
  },
  HU: async (t) => {
    const ap = t.set('nav_register_id');
    const n = await t.next('receipt');
    return { documentNumber: pad(n, 6), registerSerial: ap, extra: { apNumber: ap, receiptNo: pad(n, 6), navId: t.hash('HU', ap, n).slice(0, 16) } };
  },
  IT: async (t) => {
    const rt = t.set('rtSerialNumber');
    const closure = day(t.c.receipt.createdAt).replace(/-/g, '').slice(2);
    const n = await t.next(`doc:${closure}`);
    const docNumber = `${closure}-${pad(n, 4)}`;
    return { documentNumber: docNumber, registerSerial: rt, extra: { rtSerial: rt, docNumber, closure } };
  },
  LT: async (t) => {
    const reg = t.set('cashRegisterNo');
    const n = await t.next('receipt');
    return { documentNumber: String(n), registerSerial: reg, extra: { registerNo: reg, receiptNo: String(n), signature: t.sig('LT', reg, n) } };
  },
  LV: async (t) => {
    const mod = t.set('fiscalModuleId');
    const n = await t.next('receipt');
    return { documentNumber: String(n), registerSerial: mod, extra: { moduleId: mod, receiptNo: String(n), signature: t.sig('LV', mod, n) } };
  },
  MT: async (t) => {
    const reg = t.set('cashRegisterSerial');
    const n = await t.next('receipt');
    return { documentNumber: String(n), registerSerial: reg, extra: { registerSerial: reg, receiptNo: String(n) } };
  },
  PL: async (t) => {
    const reg = t.set('register_unique_no');
    const n = await t.next('receipt');
    return { documentNumber: String(n), registerSerial: reg, extra: { registerNo: reg, receiptNo: String(n), crkId: t.hash('PL', reg, n).slice(0, 12) } };
  },
  PT: async (t) => {
    const r = t.c.receipt;
    const series = t.set('invoiceSeries', 'FS A');
    const validation = t.set('seriesValidationCode', 'SBX0000');
    const n = await t.next('doc');
    const docNumber = `${series}/${n}`;
    const atcud = `${validation}-${n}`;
    const { hash } = await t.chain('pt-hash', `${docNumber}|${r.createdAt}|${r.totals.gross}`);
    const nif = r.merchant.vatNumber ?? r.merchant.kvkNumber;
    const qr = `A:${nif}*B:999999990*C:PT*D:FS*E:N*F:${day(r.createdAt).replace(/-/g, '')}*G:${docNumber}*H:${atcud}*N:${money(r.totals.vat)}*O:${money(r.totals.gross)}*Q:${hash.slice(0, 4)}*R:0`;
    return { documentNumber: docNumber, registerSerial: null, extra: { atcud, docNumber, hash: upper(hash).slice(0, 40), qr } };
  },
  RO: async (t) => {
    const amef = t.set('amef_serial');
    const n = await t.next('receipt');
    return { documentNumber: String(n), registerSerial: amef, extra: { amefSerial: amef, receiptNo: String(n), anafId: t.hash('RO', amef, n).slice(0, 16) } };
  },
  SE: async (t) => {
    const unit = t.set('controlUnitId');
    const reg = t.set('registerDesignation');
    const n = await t.next('receipt');
    const code = upper(t.sig('SE', unit, n)).replace(/[^A-Z0-9]/g, '').slice(0, 16);
    return { documentNumber: String(n), registerSerial: unit, extra: { controlUnitId: unit, registerId: reg, receiptNo: String(n), controlCode: code.match(/.{1,4}/g)!.join('-') } };
  },
  SI: async (t) => {
    const r = t.c.receipt;
    const premise = t.set('premiseId', 'P1');
    const device = t.set('deviceId', 'B1');
    const n = await t.next('invoice');
    const invoiceNo = `${premise}-${device}-${n}`;
    const zoi = t.hash('SI', 'zoi', invoiceNo).slice(0, 32);
    const eor = uuidLike(t.hash('SI', 'eor', invoiceNo));
    return { documentNumber: invoiceNo, registerSerial: `${premise}-${device}`, extra: { zoi, eor, invoiceNo, qr: t.qr('furs', { zoi, issuer: r.merchant.vatNumber ?? r.merchant.kvkNumber, total: r.totals.gross }) } };
  },
  SK: async (t) => {
    const code = t.set('ekasa_cash_register_code');
    const n = await t.next('receipt');
    const uid = `O-${upper(t.hash('SK', code, n)).slice(0, 32)}`;
    return { documentNumber: uid, registerSerial: code, extra: { receiptUid: uid, okp: uuidLike(t.hash('SK', 'okp', n)), cashRegisterCode: code, qr: t.qr('ekasa', { uid }) } };
  },
};

function tools(c: FiscalContext): Tools {
  const country = c.receipt.fiscal.country;
  const short = c.terminalId.replace(/-/g, '').slice(0, 6).toUpperCase();
  return {
    c,
    set(key, fallback) {
      const v = c.settings[key];
      if (typeof v === 'string' && v.trim() !== '') return v.trim().slice(0, 60);
      return fallback ?? `SBX-${country}-${short}`;
    },
    async next(name) {
      const n = Number((await c.state.get(`ctr:${name}`)) ?? '0') + 1;
      await c.state.set(`ctr:${name}`, String(n));
      return n;
    },
    async chain(name, data) {
      const previous = (await c.state.get(`chain:${name}`)) ?? '';
      const hash = sha256Hex(`${previous}|${data}`);
      await c.state.set(`chain:${name}`, hash);
      return { hash, previous };
    },
    sig: (...parts) => b64url(hexToBytes(sha256Hex(`sig|${parts.join('|')}|${c.receipt.receiptId}`) + sha256Hex(`sig2|${parts.join('|')}|${c.receipt.receiptId}`))),
    hash: (...parts) => sha256Hex(`${parts.join('|')}|${c.receipt.receiptId}`),
    // .invalid is reserved (RFC 2606): a sandbox QR can never open a real authority page
    qr: (path, params) => `https://sandbox.invalid/${path}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}`,
  };
}

/** Sandbox integration for a country. Countries without a fiscal step get an integration that says so (`mode: 'none'`). */
export function sandboxIntegration(country: string): StateIntegration {
  const code = country.toUpperCase();
  const spec = getFiscalSpec(code);
  const build = BUILDERS[code];
  if (!spec || !build) {
    return { country: code, spec: null, mode: 'none', submit: async () => ({ ok: false, retryable: false, code: 'no_fiscal_step' }) };
  }
  return {
    country: code,
    spec,
    mode: 'sandbox',
    async submit(c): Promise<FiscalResult> {
      const built = await build(tools(c));
      return {
        ok: true,
        mode: 'sandbox',
        documentNumber: built.documentNumber,
        registerSerial: built.registerSerial,
        extra: { ...built.extra, mode: 'sandbox' },
      };
    },
  };
}

/** Countries that have a sandbox builder: tested to equal the countries with a spec. */
export const SANDBOX_COUNTRIES: readonly string[] = Object.keys(BUILDERS);
