import { describe, expect, it } from 'vitest';
import { parseExtraction, type ParsedReceipt } from '../src/index.ts';

type KieInput = Record<string, unknown>;

const line = (description: string, qty: string | number, unit: string | number | null, total: string | number, rate: string | number | null) => ({
  description,
  qty,
  unit_price: unit,
  total,
  btw_rate: rate,
});
const vat = (rate: string | number, base: string | number, btw: string | number) => ({ rate, base, btw });

/** A clean card receipt: 2 × Koffie 3,40 (9%) + Bier 4,20 (21%) = 11,00. 9%: 680 → vat 56 (net 624). 21%: 420 → vat 73 (net 347). */
const clean = (): KieInput => ({
  merchant_name: 'Café Het Plein',
  kvk_number: '34567801',
  btw_number: 'NL123456782B01',
  postcode: '1012 AB',
  date: '10-10-2026',
  time: '20:47',
  lines: [line('Koffie', '2', '3,40', '6,80', '9%'), line('Bier', '1', '4,20', '4,20', '21%')],
  btw_breakdown: [vat('9', '6,24', '0,56'), vat('21', '3,47', '0,73')],
  total: '11,00',
  rounding: null,
  payment_method: 'PIN',
});

const run = (kie: KieInput, markdown = ''): ParsedReceipt => parseExtraction({ markdown, kie: JSON.stringify(kie) });

describe('parseExtraction: contract', () => {
  it('a clean receipt is done with no failed checks', () => {
    const p = run(clean());
    expect(p.failures).toEqual([]);
    expect(p.status).toBe('done');
    expect(p.gross).toBe(1100);
    expect(p.merchantKey).toBe('vat:NL123456782B01');
    expect(p.printedAtUtc).toBe('2026-10-10T18:47:00Z');
    expect(p.paymentMethod).toBe('card');
    expect(p.vatBreakdown).toEqual([
      { rate: 21, base: 347, vat: 73 },
      { rate: 9, base: 624, vat: 56 },
    ]);
    expect(p.lines.map((l) => [l.total, l.vatRate, l.kind])).toEqual([[680, 9, 'item'], [420, 21, 'item']]);
  });

  it('never throws on garbage and reports needs_review', () => {
    for (const kie of ['', 'null', '[]', '{', 'not json at all', '{"lines": 5}', '{"total": {"a": 1}}']) {
      const p = parseExtraction({ markdown: '|||\n\u0000 ??? 12,5,5', kie });
      expect(p.status).toBe('needs_review');
      expect(p.failures.length).toBeGreaterThan(0);
    }
  });

  it('accepts a KIE answer wrapped in a code fence and chatter', () => {
    const p = parseExtraction({ markdown: '', kie: `Hier is de JSON:\n\`\`\`json\n${JSON.stringify(clean())}\n\`\`\`\nKlaar.` });
    expect(p.status).toBe('done');
  });

  it('accepts JSON numbers for amounts and a numeric KvK', () => {
    const k = {
      ...clean(),
      kvk_number: 34567801,
      total: 11,
      lines: [line('Koffie', 2, 3.4, 6.8, 9), line('Bier', 1, 4.2, 4.2, 21)],
      btw_breakdown: [vat(9, 6.24, 0.56), vat(21, 3.47, 0.73)],
    };
    expect(run(k).status).toBe('done');
  });
});

describe('parseExtraction: exactness of the done gate', () => {
  it('printed total 1 cent off the line sum is needs_review (no tolerance on the total)', () => {
    const p = run({ ...clean(), total: '11,01' });
    expect(p.status).toBe('needs_review');
    expect(p.failures).toContain('gross_sum');
  });

  it('printed BTW 1 cent off the rule is needs_review', () => {
    expect(run({ ...clean(), btw_breakdown: [vat('9', '6,24', '0,57'), vat('21', '3,47', '0,73')] }).failures).toContain('vat_mismatch');
  });

  it('a printed BTW base that is neither excl nor incl is needs_review', () => {
    expect(run({ ...clean(), btw_breakdown: [vat('9', '6,25', '0,56'), vat('21', '3,47', '0,73')] }).failures).toContain('vat_base');
  });

  it('a missing BTW row, an extra BTW row and a missing breakdown are needs_review', () => {
    expect(run({ ...clean(), btw_breakdown: [vat('9', '6,24', '0,56')] }).failures).toContain('vat_missing_rate');
    expect(run({ ...clean(), btw_breakdown: [vat('9', '6,24', '0,56'), vat('21', '3,47', '0,73'), vat('0', '1,00', '0,00')] }).failures).toContain('vat_extra_rate');
    expect(run({ ...clean(), btw_breakdown: null }).status).toBe('needs_review');
  });

  it('line arithmetic has a 2-cent tolerance, 3 cents fails', () => {
    const withUnit = (unit: string) => ({ ...clean(), lines: [line('Koffie', '2', unit, '6,80', '9%'), line('Bier', '1', '4,20', '4,20', '21%')] });
    expect(run(withUnit('3,41')).status).toBe('done'); // 2 × 3,41 = 6,82 vs 6,80
    expect(run(withUnit('3,42')).failures).toContain('line_total'); // 6,84 vs 6,80
  });
});

describe('parseExtraction: a printed date in the future', () => {
  // clean() is printed 10-10-2026 20:47 Amsterdam = 18:47 UTC
  const parse = (iso: string) => parseExtraction({ markdown: '', kie: JSON.stringify(clean()) }, { now: new Date(iso) });

  it('is needs_review with date_future when more than a day after the caller clock', () => {
    const p = parse('2026-10-09T12:00:00Z');
    expect(p.status).toBe('needs_review');
    expect(p.failures).toEqual(['date_future']);
    expect(p.printedAtUtc).toBe('2026-10-10T18:47:00Z');
  });

  it('allows a day of clock skew, and any past date', () => {
    expect(parse('2026-10-09T18:47:00Z').status).toBe('done'); // exactly one day ahead
    expect(parse('2026-10-09T18:46:59Z').failures).toEqual(['date_future']);
    expect(parse('2027-01-01T00:00:00Z').status).toBe('done');
  });

  it('is not checked without a clock (the parser never reads one)', () => {
    expect(parseExtraction({ markdown: '', kie: JSON.stringify(clean()) }).status).toBe('done');
  });
});

describe('parseExtraction: line kinds', () => {
  it('statiegeld is a deposit outside the BTW rows; a bonus line takes the rate of the item above it', () => {
    const k = {
      ...clean(),
      lines: [line('Pak koffie', '1', '5,99', '5,99', '9%'), line('BONUS Pak koffie', '1', null, '-1,50', null), line('Statiegeld fles', '2', '0,25', '0,50', null)],
      btw_breakdown: [vat('9', '4,12', '0,37')], // 449 → 449×9/109 = 37,07 → 37
      total: '4,99',
    };
    const p = run(k);
    expect(p.failures).toEqual([]);
    expect(p.lines.map((l) => [l.kind, l.vatRate, l.total])).toEqual([['item', 9, 599], ['discount', 9, -150], ['deposit', null, 50]]);
  });

  it('a return: negative qty stays an item; a printed minus on a "Retour" line moves to the quantity', () => {
    const ret = (qty: string) => ({ ...clean(), lines: [line('Retour sneakers', qty, '89,95', '-89,95', '21%')], btw_breakdown: [vat('21', '-74,34', '-15,61')], total: '-89,95' }); // 8995×21/121 = 15,61
    const p = run(ret('1'));
    expect(p.failures).toEqual([]);
    expect(p.lines[0]).toMatchObject({ kind: 'item', qty: '-1', total: -8995 });
    expect(run(ret('-1')).lines[0]).toMatchObject({ kind: 'item', qty: '-1' });
  });

  it('weighed item: qty with a decimal comma and kg unit, half-up rounding of the total', () => {
    // 0,350 × 7,10 = 2,485 → 2,49 (tie rounds up); BTW 249×9/109 = 20,56 → 21
    const weighed = (btw: string, base: string) => ({ ...clean(), lines: [line('Serranoham', '0,350 kg', '7,10', '2,49', '9%')], btw_breakdown: [vat('9', base, btw)], total: '2,49' });
    expect(run(weighed('0,20', '2,29')).lines[0]).toMatchObject({ qty: '0.35', total: 249 });
    expect(run(weighed('0,20', '2,29')).failures).toContain('vat_mismatch');
    expect(run(weighed('0,21', '2,28')).failures).toEqual([]);
  });
});

describe('parseExtraction: cash rounding', () => {
  const cash = (gross: string, rounding: string | null, base: string, btw: string): KieInput => ({
    ...clean(),
    lines: [line('Brood', '1', gross, gross, '9%')],
    btw_breakdown: [vat('9', base, btw)],
    total: gross,
    rounding,
    payment_method: 'Contant',
  });

  it('12,37 cash → rounding -0,02 is accepted', () => {
    expect(run(cash('12,37', '-0,02', '11,35', '1,02')).failures).toEqual([]);
  });
  it('cash with an unrounded total and no rounding line is needs_review', () => {
    expect(run(cash('12,37', null, '11,35', '1,02')).failures).toContain('rounding_missing');
  });
  it('a multiple of 5 cents needs no rounding line', () => {
    expect(run(cash('12,35', null, '11,33', '1,02')).failures).toEqual([]); // 1235×9/109 = 101,97 → 102
  });
  it('wrong rounding value, rounding with a card and |rounding| > 2 are rejected', () => {
    expect(run(cash('12,37', '-0,05', '11,35', '1,02')).failures).toContain('rounding_rule');
    expect(run({ ...cash('12,37', '-0,02', '11,35', '1,02'), payment_method: 'PIN' }).failures).toContain('rounding_without_cash');
    expect(run(cash('12,37', '-0,07', '11,35', '1,02')).failures).toContain('rounding_range');
  });
});

describe('parseExtraction: merchant identity', () => {
  it('KvK without a BTW-id gives a kvk key', () => {
    const p = run({ ...clean(), btw_number: null });
    expect(p.merchant.vatNumber).toBeNull();
    expect(p.merchantKey).toBe('kvk:34567801');
    expect(p.status).toBe('done');
  });
  it('a 7-digit KvK or a malformed BTW-id is reported, not guessed', () => {
    const a = run({ ...clean(), kvk_number: '3456780', btw_number: null });
    expect(a.failures).toContain('kvk_format');
    expect(a.merchantKey).toBe('name:cafe het plein|1012AB');
    expect(run({ ...clean(), btw_number: 'NL12345678B01' }).failures).toContain('btw_id_format');
  });
  it('no identity at all is needs_review', () => {
    const p = run({ ...clean(), merchant_name: null, kvk_number: null, btw_number: null });
    expect(p.failures).toContain('merchant_missing');
    expect(p.merchantKey).toBeNull();
  });
  it('missing or impossible date/time and missing payment are reported', () => {
    expect(run({ ...clean(), time: null }).failures).toContain('printed_at');
    expect(run({ ...clean(), date: '2026-03-29', time: '02:30' }).failures).toContain('printed_at');
    expect(run({ ...clean(), payment_method: null }).failures).toContain('payment_missing');
  });
});

describe('parseExtraction: the two model outputs must agree', () => {
  it('markdown total differing from the KIE total is needs_review', () => {
    const p = run(clean(), 'TOTAAL EUR 17,00\n');
    expect(p.failures).toContain('total_disagree');
  });
  it('markdown BTW differing from the KIE BTW is needs_review', () => {
    const p = run(clean(), 'TOTAAL EUR 11,00\n\n| 9% | 6,24 | 0,55 |\n| 21% | 3,47 | 0,73 |');
    expect(p.failures).toContain('vat_source_disagree');
  });
  it('agreeing markdown is fine, and fills what the KIE answer left null', () => {
    const md = '# Café Het Plein\n\nKvK 34567801\n\nDatum 10-10-2026 Tijd 20:47\nTOTAAL EUR 11,00\n| 9% | 6,24 | 0,56 |\n| 21% | 3,47 | 0,73 |';
    const p = run({ ...clean(), kvk_number: null, btw_number: null, date: null, time: null }, md);
    expect(p.failures).toEqual([]);
    expect(p.merchantKey).toBe('kvk:34567801');
    expect(p.printedAtUtc).toBe('2026-10-10T18:47:00Z');
  });
});

describe('parseExtraction: markdown only (KIE has no lines)', () => {
  const md = [
    '# Bakkerij Gouden Korst',
    'Dorpsstraat 3',
    '3811 AB Amersfoort',
    'KvK 52345671',
    'BTW-id NL345678912B01',
    'Datum 25-10-2026 Tijd 08:10',
    '',
    '| Omschrijving | Aantal | Prijs | Bedrag | BTW |',
    '|---|---|---|---|---|',
    '| Volkoren brood | 1 | 3,45 | 3,45 | 9% |',
    '| Croissant | 3 | 1,35 | 4,05 | 9% |',
    '| Boterkoek | 1 | 4,87 | 4,87 | 9% |',
    '',
    'TOTAAL EUR 12,37',
    'Afronding -0,02',
    'Te betalen 12,35',
    'Contant 12,35',
    '',
    '| BTW % | Over | BTW |',
    '|---|---|---|',
    '| 9% | 11,35 | 1,02 |',
  ].join('\n');

  it('parses header, table lines, total, rounding, payment and BTW from markdown alone', () => {
    const p = parseExtraction({ markdown: md, kie: '{}' });
    expect(p.failures).toEqual([]);
    expect(p.lines.map((l) => l.total)).toEqual([345, 405, 487]);
    expect(p).toMatchObject({ gross: 1237, rounding: -2, paymentMethod: 'cash', merchantKey: 'vat:NL345678912B01', printedAtUtc: '2026-10-25T07:10:00Z' });
  });

  it('unparseable KIE JSON stays needs_review even if the markdown is complete', () => {
    expect(parseExtraction({ markdown: md, kie: 'sorry' }).failures).toContain('kie_unparseable');
  });
});
