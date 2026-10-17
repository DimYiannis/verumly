import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURES_DIR, loadCorpus, loadSeedCorpus, MIN_REAL_FOR_SEED } from '../../../scripts/lib/corpus.ts';
import { evaluate } from '../../../scripts/lib/eval.ts';

/** A temporary real-style fixtures dir: one real receipt (derived from a mock one, other id) next to the untouched mock corpus. */
describe('corpus selection with a real receipt present', () => {
  let root = '';
  const mockDir = join(FIXTURES_DIR, 'mock');

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'lr-corpus-'));
    symlinkSync(mockDir, join(root, 'mock'));
    const truth = JSON.parse(readFileSync(join(mockDir, 'mock-weegschaal.truth.json'), 'utf8')) as Record<string, unknown>;
    delete truth.mock;
    const sha = String(truth.sha256);
    copyFileSync(join(mockDir, 'mock-weegschaal.png'), join(root, 'real-0001.png'));
    copyFileSync(join(mockDir, `${sha}.qianfan.json`), join(root, `${sha}.qianfan.json`));
    writeFileSync(join(root, 'real-0001.truth.json'), JSON.stringify({ ...truth, id: 'real-0001', image: 'real-0001.png' }));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('loadCorpus prefers the real corpus; only: mock ignores it', () => {
    const real = loadCorpus({ quiet: true, fixturesDir: root });
    expect(real.kind).toBe('real');
    expect(real.entries.map((e) => e.id)).toEqual(['real-0001']);
    const mock = loadCorpus({ quiet: true, fixturesDir: root, only: 'mock' });
    expect(mock.kind).toBe('mock');
    expect(mock.entries.some((e) => e.id === 'mock-weegschaal')).toBe(true);
    expect(mock.entries.some((e) => e.id === 'real-0001')).toBe(false);
  });

  it(`the seed falls back to the mock corpus while the real one has fewer than ${MIN_REAL_FOR_SEED} usable receipts`, () => {
    expect(loadSeedCorpus({ quiet: true, fixturesDir: root }).kind).toBe('mock');
  });

  it('the seed uses the real corpus once it has enough usable receipts', () => {
    for (const n of [2, 3]) copyReal(root, n);
    const withRecordings = loadSeedCorpus({ quiet: true, fixturesDir: root });
    expect(withRecordings.kind).toBe('real');
    expect(withRecordings.entries).toHaveLength(MIN_REAL_FOR_SEED);
  });

  it('the eval runs on the real corpus when present', () => {
    const report = evaluate(loadCorpus({ quiet: true, fixturesDir: root }));
    expect(report.kind).toBe('real');
    expect(report.evaluated.length).toBeGreaterThan(0);
    expect(report.evaluated.every((r) => r.id.startsWith('real-'))).toBe(true);
  });
});

function copyReal(root: string, n: number): void {
  const id = `real-000${n}`;
  const truth = JSON.parse(readFileSync(join(root, 'real-0001.truth.json'), 'utf8')) as Record<string, unknown>;
  copyFileSync(join(root, 'real-0001.png'), join(root, `${id}.png`));
  writeFileSync(join(root, `${id}.truth.json`), JSON.stringify({ ...truth, id, image: `${id}.png` }));
}
