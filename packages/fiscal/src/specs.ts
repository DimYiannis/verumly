import type { FiscalSpec } from './types.ts';

/**
 * Per country: the fiscal system a final receipt has to go through, and the values it adds to the receipt. Written from
 * the legal research in `docs/legal-research` (`needs` are keys of that country's setup settings). The research is not
 * reviewed by a tax adviser: the real field list and formats come from the certification documents of the device or
 * service you integrate.
 *
 * Countries whose format says `fiscal: 'none'` (NL, GB, IE, DK, ...) have no spec: a paid receipt is final there.
 */
const s = (spec: FiscalSpec): FiscalSpec => spec;

export const FISCAL_SPECS: FiscalSpec[] = [
  s({
    country: 'AT',
    system: 'RKSV (Registrierkassensicherheitsverordnung)',
    authority: 'BMF / FinanzOnline',
    kind: 'signature_device',
    how: 'A signature creation unit signs every receipt; the signed data prints as a QR code.',
    needs: ['kassenId', 'seeType', 'certificateSerial', 'finanzOnlineRegistered'],
    fields: [
      { key: 'kassenId', label: 'Kassen-ID' },
      { key: 'belegNr', label: 'Belegnummer' },
      { key: 'signature', label: 'Signatur' },
      { key: 'qr', label: 'QR-Code' },
    ],
  }),
  s({
    country: 'BE',
    system: 'GKS / SCE (Geregistreerd Kassasysteem)',
    authority: 'FOD Financiën',
    kind: 'signature_device',
    how: 'A certified fiscal data module (FDM) signs the ticket (horeca; optional for other businesses).',
    needs: ['isHoreca', 'fdmSerial', 'vscId'],
    fields: [
      { key: 'fdmSerial', label: 'FDM' },
      { key: 'ticketCounter', label: 'Ticket' },
      { key: 'signature', label: 'Handtekening' },
    ],
  }),
  s({
    country: 'BG',
    system: 'Фискално устройство (NRA)',
    authority: 'НАП (NRA)',
    kind: 'realtime_report',
    how: 'A fiscal device registered with the NRA prints the fiscal receipt and sends the data to the NRA.',
    needs: ['fiscal_device_id', 'site_code'],
    fields: [
      { key: 'deviceId', label: 'ИН на ФУ' },
      { key: 'fiscalNo', label: 'Фискален бон №' },
      { key: 'qr', label: 'QR код' },
    ],
  }),
  s({
    country: 'CY',
    system: 'Fiscal device (ETR)',
    authority: 'Tax Department',
    kind: 'signature_device',
    how: 'A fiscal device approved by the EMS records and numbers every sale.',
    needs: ['fiscalDeviceModel', 'fiscalDeviceSerial'],
    fields: [
      { key: 'deviceSerial', label: 'Device' },
      { key: 'receiptNo', label: 'Receipt no.' },
    ],
  }),
  s({
    country: 'DE',
    system: 'TSE (KassenSichV, DSFinV-K)',
    authority: 'Finanzamt / BSI',
    kind: 'signature_device',
    how: 'A certified technical security system (TSE) signs the transaction; the signature data prints on the receipt.',
    needs: ['tseSerial', 'tillId', 'tillRegisteredAt'],
    fields: [
      { key: 'tseSerial', label: 'TSE-Seriennummer' },
      { key: 'tillId', label: 'Kassen-ID' },
      { key: 'transactionNumber', label: 'Transaktionsnummer' },
      { key: 'signatureCounter', label: 'Signaturzähler' },
      { key: 'start', label: 'Start' },
      { key: 'end', label: 'Ende' },
      { key: 'signature', label: 'Prüfwert' },
    ],
  }),
  s({
    country: 'ES',
    system: 'Verifactu (Ley 11/2021, RD 1007/2023)',
    authority: 'AEAT',
    kind: 'chained_software',
    how: 'The invoicing software chains each record by hash, prints a verification QR and (in Verifactu mode) sends the record to the AEAT.',
    needs: ['verifactuMode', 'invoiceSeries', 'ticketMode'],
    fields: [
      { key: 'invoiceId', label: 'Nº factura' },
      { key: 'hash', label: 'Huella' },
      { key: 'previousHash', label: 'Huella anterior' },
      { key: 'qr', label: 'QR tributario' },
    ],
  }),
  s({
    country: 'FR',
    system: 'Certified till software (anti-fraud law, art. 286 I-3° bis CGI)',
    authority: 'DGFiP',
    kind: 'chained_software',
    how: 'Certified software numbers and chains every receipt so it cannot be changed afterwards.',
    needs: ['vatLiable', 'tillSoftwareCertificate'],
    fields: [
      { key: 'sequence', label: 'N° de ticket' },
      { key: 'hash', label: 'Empreinte' },
      { key: 'software', label: 'Logiciel' },
    ],
  }),
  s({
    country: 'GR',
    system: 'myDATA / FIM (ΦΗΜ) and ΠΥΡ',
    authority: 'ΑΑΔΕ (IAPR)',
    kind: 'realtime_report',
    how: 'The receipt is sent to myDATA; the authority returns a MARK and UID that print on the receipt.',
    needs: ['afm', 'fimType', 'fimRegistrationNo'],
    fields: [
      { key: 'mark', label: 'ΜΑΡΚ' },
      { key: 'uid', label: 'UID' },
      { key: 'fimNo', label: 'ΦΗΜ' },
      { key: 'qr', label: 'QR' },
    ],
  }),
  s({
    country: 'HR',
    system: 'Fiskalizacija (CIS)',
    authority: 'Porezna uprava',
    kind: 'realtime_report',
    how: 'The till computes a ZKI, reports the receipt to the CIS and gets back a JIR; both print on the receipt with a QR.',
    needs: ['oib', 'premiseCode', 'registerCode', 'fiscalCertificate', 'operatorOib'],
    fields: [
      { key: 'zki', label: 'ZKI' },
      { key: 'jir', label: 'JIR' },
      { key: 'receiptNo', label: 'Broj računa' },
      { key: 'qr', label: 'QR' },
    ],
  }),
  s({
    country: 'HU',
    system: 'Online pénztárgép (NAV)',
    authority: 'NAV',
    kind: 'realtime_report',
    how: 'An approved online cash register reports every receipt to NAV in real time.',
    needs: ['nav_register_id', 'register_type'],
    fields: [
      { key: 'apNumber', label: 'AP szám' },
      { key: 'receiptNo', label: 'Nyugtaszám' },
      { key: 'navId', label: 'NAV azonosító' },
    ],
  }),
  s({
    country: 'IT',
    system: 'Registratore Telematico / Documento commerciale',
    authority: 'Agenzia delle Entrate',
    kind: 'chained_software',
    how: 'A telematic register (RT) or the AdE web procedure issues the "documento commerciale" and sends the daily totals to the AdE.',
    needs: ['rtSerialNumber', 'fiscalMode'],
    fields: [
      { key: 'rtSerial', label: 'Matricola RT' },
      { key: 'docNumber', label: 'Documento commerciale n.' },
      { key: 'closure', label: 'Chiusura n.' },
    ],
  }),
  s({
    country: 'LT',
    system: 'i.EKA',
    authority: 'VMI',
    kind: 'signature_device',
    how: 'A certified cash register (or a virtual fiscalisation device) with a security module reports each receipt to the VMI.',
    needs: ['cashRegisterNo', 'fiscalizationMode', 'securityModuleId'],
    fields: [
      { key: 'registerNo', label: 'KA Nr.' },
      { key: 'receiptNo', label: 'Čekio Nr.' },
      { key: 'signature', label: 'Parašas' },
    ],
  }),
  s({
    country: 'LV',
    system: 'Kases aparāts ar fiskālo moduli',
    authority: 'VID',
    kind: 'signature_device',
    how: 'A certified cash register with a fiscal memory module numbers and stores every receipt.',
    needs: ['cashRegisterChassisNo', 'fiscalModuleId'],
    fields: [
      { key: 'moduleId', label: 'Fiskālais modulis' },
      { key: 'receiptNo', label: 'Čeka Nr.' },
      { key: 'signature', label: 'Paraksts' },
    ],
  }),
  s({
    country: 'MT',
    system: 'Fiscal cash register (approved model)',
    authority: 'CFR',
    kind: 'signature_device',
    how: 'A fiscal register of an approved model records the receipt in its fiscal memory and prints the fiscal logo.',
    needs: ['cashRegisterSerial', 'approvedRegisterModel', 'taxLogo'],
    fields: [
      { key: 'registerSerial', label: 'Register' },
      { key: 'receiptNo', label: 'Receipt no.' },
    ],
  }),
  s({
    country: 'PL',
    system: 'Kasa fiskalna / kasa online (CRK)',
    authority: 'KAS',
    kind: 'realtime_report',
    how: 'A fiscal or online register numbers each receipt and (online) transmits it to the Central Repository of Cash Registers.',
    needs: ['register_type', 'register_unique_no'],
    fields: [
      { key: 'registerNo', label: 'Nr unikatowy kasy' },
      { key: 'receiptNo', label: 'Nr wydruku' },
      { key: 'crkId', label: 'Nr CRK' },
    ],
  }),
  s({
    country: 'PT',
    system: 'Certified invoicing software (ATCUD, QR code)',
    authority: 'AT (Autoridade Tributária)',
    kind: 'chained_software',
    how: 'Certified software numbers documents in a validated series, signs them with a hash chain and prints the ATCUD and a QR code.',
    needs: ['softwareCertNumber', 'invoiceSeries', 'seriesValidationCode'],
    fields: [
      { key: 'atcud', label: 'ATCUD' },
      { key: 'docNumber', label: 'Documento' },
      { key: 'hash', label: 'Hash' },
      { key: 'qr', label: 'QR' },
    ],
  }),
  s({
    country: 'RO',
    system: 'AMEF (casă de marcat fiscală)',
    authority: 'ANAF',
    kind: 'realtime_report',
    how: 'A fiscal electronic cash register (AMEF) numbers each bon fiscal and transmits the data to ANAF.',
    needs: ['cui', 'amef_serial'],
    fields: [
      { key: 'amefSerial', label: 'AMEF' },
      { key: 'receiptNo', label: 'Bon fiscal nr.' },
      { key: 'anafId', label: 'ID ANAF' },
    ],
  }),
  s({
    country: 'SE',
    system: 'Kontrollenhet (Skatteverket)',
    authority: 'Skatteverket',
    kind: 'signature_device',
    how: 'A certified control unit connected to the cash register signs every receipt and prints a control code.',
    needs: ['controlUnitId', 'registerDesignation', 'skatteverketRegistered'],
    fields: [
      { key: 'controlUnitId', label: 'Kontrollenhet' },
      { key: 'registerId', label: 'Kassaregister' },
      { key: 'receiptNo', label: 'Kvittonr' },
      { key: 'controlCode', label: 'Kontrollkod' },
    ],
  }),
  s({
    country: 'SI',
    system: 'Davčne blagajne (FURS)',
    authority: 'FURS',
    kind: 'realtime_report',
    how: 'The till computes a ZOI, reports the invoice to FURS and gets back an EOR; both print on the receipt.',
    needs: ['premiseId', 'deviceId', 'certificateRef', 'issuerTaxNumber'],
    fields: [
      { key: 'zoi', label: 'ZOI' },
      { key: 'eor', label: 'EOR' },
      { key: 'invoiceNo', label: 'Št. računa' },
      { key: 'qr', label: 'QR' },
    ],
  }),
  s({
    country: 'SK',
    system: 'eKasa',
    authority: 'Finančná správa',
    kind: 'realtime_report',
    how: 'The cash register sends each receipt to the eKasa system, which returns a receipt ID (and a QR code to check it).',
    needs: ['ekasa_cash_register_code', 'ekasa_mode'],
    fields: [
      { key: 'receiptUid', label: 'Identifikátor dokladu' },
      { key: 'okp', label: 'OKP' },
      { key: 'cashRegisterCode', label: 'Kód pokladnice' },
      { key: 'qr', label: 'QR' },
    ],
  }),
];

const BY_COUNTRY = new Map(FISCAL_SPECS.map((x) => [x.country, x]));

/** The fiscal spec of a country, or null when its receipts need no fiscal step (or the country is unknown). */
export function getFiscalSpec(country: string): FiscalSpec | null {
  return BY_COUNTRY.get(country.toUpperCase()) ?? null;
}

/** Labels for `fiscal.extra` keys of a country, for showing them on the receipt. Unknown keys keep their key as label. */
export function fiscalLabels(country: string): Record<string, string> {
  return Object.fromEntries((getFiscalSpec(country)?.fields ?? []).map((f) => [f.key, f.label]));
}

/** Keys the country's `fiscalised` receipt must carry in `fiscal.extra`. */
export function requiredFiscalKeys(country: string): string[] {
  return (getFiscalSpec(country)?.fields ?? []).filter((f) => f.key !== 'qr' && f.key !== 'previousHash').map((f) => f.key);
}

/** The required keys of the country that `extra` does not have. */
export function missingFiscalKeys(country: string, extra: Record<string, string>): string[] {
  return requiredFiscalKeys(country).filter((k) => !extra[k]);
}
