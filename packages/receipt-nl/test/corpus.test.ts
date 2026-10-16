import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkTruth, QUIRKS, quirkPresent, truthPrintedAtUtc, vatFromGross } from '../src/index.ts';
import { FIXTURES_DIR, loadCorpus, loadKnownMisfits, readRecorded } from '../../../scripts/lib/corpus.ts';
import { MOCK_RECEIPTS, mockTruth, simulateQianfan } from '../../../scripts/lib/mock-receipts.ts';
import { evaluate } from '../../../scripts/lib/eval.ts';

const corpus = loadCorpus();

describe('C. Dutch corpus: receipt-nl reproduces what is printed', () => {
  const misfits = corpus.entries.flatMap((e) => checkTruth(e.truth).map((m) => ({ id: e.id, rule: m.rule, message: m.message })));
  const actual = misfits.map((m) => `${m.id}:${m.rule}`).sort();
  const known = loadKnownMisfits();
  const expected = known.map((k) => `${k.id}:${k.rule}`).sort();

  it('has at least one receipt', () => {
    expect(corpus.entries.length).toBeGreaterThan(0);
  });

  it('actual misfits equal the list in known-misfits.json, in both directions', () => {
    const unexpected = actual.filter((m) => !expected.includes(m));
    const stale = expected.filter((m) => !actual.includes(m));
    expect({ unexpected, stale }, `unexpected misfits: ${JSON.stringify(misfits.filter((m) => unexpected.includes(`${m.id}:${m.rule}`)))}`).toEqual({ unexpected: [], stale: [] });
  });

  it('every known misfit has a written reason and names a receipt in the corpus', () => {
    for (const k of known) {
      expect(k.reason.trim().length).toBeGreaterThan(10);
      expect(corpus.entries.some((e) => e.id === k.id), `${k.id} is not in the ${corpus.kind} corpus`).toBe(true);
    }
  });

  it('every line kind has a passing receipt (else it is listed as uncovered in FINDINGS)', () => {
    const failing = new Set(misfits.map((m) => m.id));
    const uncovered = QUIRKS.filter((q) => !corpus.entries.some((e) => !failing.has(e.id) && quirkPresent(e.truth, q)));
    console.log(`Line-kind coverage (${corpus.kind}): ${QUIRKS.map((q) => `${q}=${uncovered.includes(q) ? 'UNCOVERED' : 'ok'}`).join(' ')}`);
    if (corpus.kind === 'mock') expect(uncovered).toEqual([]);
  });

  it('every declared quirk is visible in the truth lines', () => {
    for (const e of corpus.entries) {
      for (const q of QUIRKS.filter((x) => e.truth.quirks.includes(x))) expect(quirkPresent(e.truth, q), `${e.id} declares ${q}`).toBe(true);
    }
  });
});

describe('C. independent oracle for the §5 BTW rule on the mock corpus', () => {
  // Floating-point recomputation straight from the lines, no receipt-nl code involved except for the comparison.
  it.each(MOCK_RECEIPTS.map((r) => [r.id, r] as const))('%s: printed BTW = round(rate gross × r / (100+r))', (_id, r) => {
    for (const row of r.vat) {
      const gross = r.lines.filter((l) => l.vatRate === row.rate).reduce((s, l) => s + l.total, 0);
      const exact = (Math.abs(gross) * row.rate) / (100 + row.rate);
      expect(Math.abs(row.vat)).toBe(Math.round(exact));
      expect(Math.sign(row.vat)).toBe(Math.sign(gross));
      expect(vatFromGross(gross, row.rate).vat).toBe(row.vat);
    }
    expect(r.lines.reduce((s, l) => s + l.total, 0)).toBe(r.gross);
  });
});

describe('mock corpus integrity', () => {
  const mockDir = join(FIXTURES_DIR, 'mock');
  it('has the 6 required receipts, one per scenario', () => {
    const mock = loadCorpus({ quiet: true });
    if (mock.kind !== 'mock') return; // a real corpus is in use; mock/ is still checked below by file
    const q = (id: string) => mock.entries.find((e) => e.id === id)!.truth;
    expect(mock.entries).toHaveLength(6);
    expect(q('mock-horeca-gemengd').vat.map((v) => v.rate).sort()).toEqual([21, 9]);
    expect(q('mock-supermarkt-statiegeld-bonus').quirks).toEqual(['statiegeld', 'bonus']);
    expect(q('mock-weegschaal').quirks).toEqual(['weighed']);
    expect(q('mock-contant-afronding').rounding).toBe(-2);
    expect(q('mock-retour').gross).toBeLessThan(0);
    expect(q('mock-zonder-btw-id').merchant).toMatchObject({ vatNumber: null, kvk: '74567123' });
  });

  it.each(MOCK_RECEIPTS.map((r) => [r.id, r] as const))('%s: files on disk match scripts/lib/mock-receipts.ts (regenerate with node scripts/render-mock-corpus.ts)', (id, r) => {
    const png = readFileSync(join(mockDir, `${id}.png`));
    const sha = createHash('sha256').update(png).digest('hex');
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(JSON.parse(readFileSync(join(mockDir, `${id}.truth.json`), 'utf8'))).toEqual(JSON.parse(JSON.stringify(mockTruth(r, sha))));
    expect(JSON.parse(readFileSync(join(mockDir, `${sha}.qianfan.json`), 'utf8'))).toEqual(simulateQianfan(r));
    expect(simulateQianfan(r).modelRevision).toBe('mock');
  });

  it('the recorded outputs look like Qianfan: Dutch decimals, BTW lines, KIE as a raw string', () => {
    const mock = loadCorpus({ quiet: true });
    if (mock.kind !== 'mock') return;
    const retour = readRecorded(mock.entries.find((e) => e.id === 'mock-retour')!)!;
    expect(retour.markdown).toContain('-1.249,00');
    expect(retour.kie).toContain('"-1.249,00"');
    expect(typeof retour.kie).toBe('string');
    expect(truthPrintedAtUtc(mock.entries.find((e) => e.id === 'mock-contant-afronding')!.truth)).toBe('2026-10-25T07:10:00Z');
  });
});

describe('corpus selection: real files win, mock/ is the fallback', () => {
  const mockDir = join(FIXTURES_DIR, 'mock');
  const withTmpFixtures = (copyTopLevel: boolean, fn: (root: string) => void) => {
    const root = mkdtempSync(join(tmpdir(), 'lr-corpus-'));
    try {
      mkdirSync(join(root, 'mock'));
      for (const f of readdirSync(mockDir)) copyFileSync(join(mockDir, f), join(root, 'mock', f));
      if (copyTopLevel) for (const f of readdirSync(mockDir).filter((x) => x.includes('retour') || x.endsWith('.qianfan.json'))) copyFileSync(join(mockDir, f), join(root, f));
      fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  it('uses mock/ when there is no top-level truth file', () => {
    withTmpFixtures(false, (root) => {
      const c = loadCorpus({ quiet: true, fixturesDir: root });
      expect(c.kind).toBe('mock');
      expect(c.entries).toHaveLength(6);
    });
  });

  it('uses the real corpus as soon as one top-level truth file exists, and evaluates it without the MOCK label', () => {
    withTmpFixtures(true, (root) => {
      const c = loadCorpus({ quiet: true, fixturesDir: root });
      expect(c.kind).toBe('real');
      expect(c.entries.map((e) => e.id)).toEqual(['mock-retour']);
      const report = evaluate(c);
      expect(report.kind).toBe('real');
      expect(report.evaluated).toHaveLength(1);
      expect(report.falseDone).toEqual([]);
    });
  });

  it('refuses a truth file whose sha256 is not the hash of its image', () => {
    withTmpFixtures(true, (root) => {
      const f = join(root, 'mock-retour.truth.json');
      writeFileSync(f, readFileSync(f, 'utf8').replace(/"sha256": "[0-9a-f]{64}"/, `"sha256": "${'0'.repeat(64)}"`));
      expect(() => loadCorpus({ quiet: true, fixturesDir: root })).toThrow(/hashes to/);
    });
  });
});
