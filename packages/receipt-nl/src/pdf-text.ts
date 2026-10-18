/**
 * The text of a PDF receipt (one string per printed line, as the PDF reader found them) turned into the markdown the
 * parser reads: the lines above the total become a table (description | qty | amount | VAT), the rest stays as plain
 * lines, and the labels the parser looks for (Afronding, Betaald pinnen) are used for their English or card/cash
 * spellings. A PDF with a text layer needs no OCR; whatever this does not recognise ends in `needs_review`, where the
 * buyer corrects it by hand, exactly like a photo.
 */

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', mrt: '03', apr: '04', may: '05', mei: '05', jun: '06', jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', okt: '10', nov: '11', dec: '12',
};

const AMOUNT = String.raw`-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}-?|-?\d+[.,]\d{2}-?`;
/** labels that end the item section */
const END_OF_ITEMS = /^(sub\s*)?(totaal|total)\b|^te betalen\b|^amount due\b|^totaalbedrag\b/i;
/** lines that are never items even when they end in an amount */
const NOT_AN_ITEM = /^(sub\s*)?(totaal|total)\b|^btw\b|^vat\b|^rate\b|^tax\b|^afronding\b|^rounding\b|^tip\b|^fooi\b|^pin\b|^card\b|^cash\b|^contant\b|^betaald\b|^betaling\b|^gepind\b|^terug\b|^wisselgeld\b|^change\b|^kvk\b|^tel\b|^datum\b|^date\b/i;

/** `17 Oct 2026`, `17 okt. 2026` -> `17-10-2026`: the parser reads numeric dates. */
function numericDates(line: string): string {
  return line.replace(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/g, (m, d: string, mon: string, y: string) => {
    const mm = MONTHS[mon.toLowerCase().slice(0, 4)] ?? MONTHS[mon.toLowerCase().slice(0, 3)];
    return mm ? `${d}-${mm}-${y}` : m;
  });
}

interface Item {
  description: string;
  qty: string;
  amount: string;
  vat: string;
}

const clean = (s: string) => s.replace(/[€]/g, ' ').replace(/\s+/g, ' ').trim();

function asItem(line: string): Item | null {
  const l = line.replace(/\s+/g, ' ').trim();
  // "2 × Koffie  €6,80  9%" (this platform's own PDF): quantity first
  let m = new RegExp(String.raw`^(\d+(?:[.,]\d+)?)\s*[x×]\s+(.+?)\s+€?\s*(${AMOUNT})(?:\s+(\d{1,2})(?:[.,]0+)?\s*%)?$`, 'i').exec(l);
  if (m) return { description: clean(m[2]!), qty: m[1]!, amount: m[3]!, vat: m[4] ?? '' };
  // "Koffie 2 x 3,40 6,80": quantity and unit price after the description
  m = new RegExp(String.raw`^(.+?)\s+(\d+(?:[.,]\d+)?)\s*[x×]\s*€?\s*(?:${AMOUNT})\s+€?\s*(${AMOUNT})(?:\s+(\d{1,2})(?:[.,]0+)?\s*%)?$`, 'i').exec(l);
  if (m) return { description: clean(m[1]!), qty: m[2]!, amount: m[3]!, vat: m[4] ?? '' };
  // "Koffie 3,40": one piece
  m = new RegExp(String.raw`^(.+?)\s+€?\s*(${AMOUNT})(?:\s+(\d{1,2})(?:[.,]0+)?\s*%)?$`, 'i').exec(l);
  if (m && /\p{L}{2}/u.test(m[1]!)) return { description: clean(m[1]!), qty: '1', amount: m[2]!, vat: m[3] ?? '' };
  return null;
}

const cents = (v: string): number => {
  const neg = v.includes('-');
  const digits = v.replace(/[^\d.,]/g, '');
  const m = /^(.*)[.,](\d{2})$/.exec(digits);
  const n = m ? Number(m[1]!.replace(/[.,]/g, '')) * 100 + Number(m[2]) : NaN;
  return neg ? -n : n;
};

/** The gross per VAT rate that the printed VAT rows give: `21% 3,21 0,68 3,89` (net, VAT, gross) or `BTW 21% 3,21 0,68` (net, VAT). */
function printedGross(tail: string[]): Array<{ rate: string; gross: number[] }> {
  const out: Array<{ rate: string; gross: number[] }> = [];
  for (const line of tail) {
    const m = /^(?:btw\s+|vat\s+)?(\d{1,2})(?:[.,]0+)?\s*%\s+(.*)$/i.exec(line);
    if (!m) continue;
    const amounts = (m[2]!.match(new RegExp(AMOUNT, 'g')) ?? []).map(cents).filter((n) => !Number.isNaN(n));
    if (amounts.length >= 3) out.push({ rate: m[1]!, gross: [amounts[2]!] });
    else if (amounts.length === 2) out.push({ rate: m[1]!, gross: [amounts[0]! + amounts[1]!, amounts[0]!] });
  }
  return out;
}

/**
 * Item lines without a printed VAT rate (the slip prints only a VAT table) get theirs from that table: with one rate they all
 * have it; with two, the split of the items that adds up to the gross of the first rate is the one. Anything else is left for the reader.
 */
function inferRates(items: Item[], tail: string[]): void {
  const open = items.filter((i) => i.vat === '');
  if (open.length === 0) return;
  const rows = printedGross(tail);
  if (rows.length === 1) {
    for (const i of open) i.vat = rows[0]!.rate;
    return;
  }
  if (rows.length !== 2 || open.length !== items.length || open.length > 40) return;
  const amounts = open.map((i) => cents(i.amount));
  if (amounts.some((a) => Number.isNaN(a))) return;
  for (const target of rows[0]!.gross) {
    // subset sum with the chosen indexes remembered
    let reach = new Map<number, number[]>([[0, []]]);
    amounts.forEach((a, idx) => {
      const next = new Map(reach);
      for (const [sum, picked] of reach) if (!next.has(sum + a)) next.set(sum + a, [...picked, idx]);
      reach = next;
    });
    const hit = reach.get(target);
    if (hit) {
      open.forEach((i, idx) => {
        i.vat = hit.includes(idx) ? rows[0]!.rate : rows[1]!.rate;
      });
      return;
    }
  }
}

/** Receipt lines of a PDF text layer -> markdown for `parseExtraction`. */
export function pdfTextToMarkdown(rawLines: string[]): string {
  const lines = rawLines.map((l) => numericDates(l.replace(/\s+/g, ' ').trim())).filter((l) => l !== '');
  const head: string[] = [];
  const items: Item[] = [];
  const tail: string[] = [];
  let section: 'head' | 'items' | 'tail' = 'head';
  for (const line of lines) {
    if (section === 'tail') {
      tail.push(line);
      continue;
    }
    if (END_OF_ITEMS.test(line)) {
      section = 'tail';
      tail.push(line);
      continue;
    }
    const item = NOT_AN_ITEM.test(line) ? null : asItem(line);
    if (item) {
      section = 'items';
      items.push(item);
    } else if (section === 'head') head.push(line);
    else tail.push(line);
  }
  inferRates(items, tail);
  const out = [...head];
  if (items.length > 0) {
    out.push('', '| Omschrijving | Aantal | Bedrag | BTW |', '| --- | --- | --- | --- |');
    for (const i of items) out.push(`| ${i.description.replace(/\|/g, '/')} | ${i.qty} | ${i.amount} | ${i.vat} |`);
    out.push('');
  }
  for (const line of tail) {
    if (/^(rounding|afronding)\b/i.test(line)) out.push(line.replace(/^rounding/i, 'Afronding'));
    else if (/^(card|pin|debit|visa|mastercard|maestro)\b/i.test(line)) out.push(`Betaald pinnen ${line}`);
    else if (/^(cash|contant)\b/i.test(line)) out.push(`Betaald contant ${line}`);
    else out.push(line);
  }
  return out.join('\n');
}
