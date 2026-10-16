import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { knownMisfitsSchema, recordedSchema, truthSchema, type Recorded, type Truth } from '@lr/receipt-nl';

export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'receipts-nl');
export const KNOWN_MISFITS_PATH = join(FIXTURES_DIR, 'known-misfits.json');

export interface CorpusEntry {
  id: string;
  truth: Truth;
  truthPath: string;
  imagePath: string;
  /** `<truth.sha256>.qianfan.json` next to the truth file, or null while it has not been recorded yet */
  recordedPath: string | null;
}

export interface Corpus {
  kind: 'real' | 'mock';
  dir: string;
  entries: CorpusEntry[];
}

function entriesIn(dir: string): CorpusEntry[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.truth.json'))
    .sort()
    .map((file) => {
      const truthPath = join(dir, file);
      const truth = truthSchema.parse(JSON.parse(readFileSync(truthPath, 'utf8')));
      const imagePath = join(dir, truth.image);
      if (!existsSync(imagePath)) throw new Error(`${file}: image ${truth.image} not found next to the truth file`);
      const actual = createHash('sha256').update(readFileSync(imagePath)).digest('hex');
      if (actual !== truth.sha256) throw new Error(`${file}: sha256 is ${truth.sha256} but ${truth.image} hashes to ${actual}`);
      const recorded = join(dir, `${truth.sha256}.qianfan.json`);
      return { id: truth.id, truth, truthPath, imagePath, recordedPath: existsSync(recorded) ? recorded : null };
    });
}

/**
 * The real corpus (`fixtures/receipts-nl/*.truth.json`) when any file exists, otherwise `fixtures/receipts-nl/mock/`.
 * Prints which one was used (v2: tests §16.C/D and the seed share this rule).
 */
export function loadCorpus(opts: { quiet?: boolean; fixturesDir?: string } = {}): Corpus {
  const root = opts.fixturesDir ?? FIXTURES_DIR;
  const real = readdirSync(root).some((f) => f.endsWith('.truth.json'));
  const mockDir = join(root, 'mock');
  const corpus: Corpus = real
    ? { kind: 'real', dir: root, entries: entriesIn(root) }
    : { kind: 'mock', dir: mockDir, entries: entriesIn(mockDir) };
  if (!opts.quiet) console.log(`Corpus: ${corpus.kind.toUpperCase()} (${corpus.entries.length} receipts, ${corpus.dir})`);
  return corpus;
}

/** The recorded Qianfan output for an entry, or null when none exists yet. */
export function readRecorded(entry: CorpusEntry): Recorded | null {
  return entry.recordedPath === null ? null : recordedSchema.parse(JSON.parse(readFileSync(entry.recordedPath, 'utf8')));
}

/** `known-misfits.json`: `[{ id, rule, reason }]`, one row per (receipt, broken rule). */
export function loadKnownMisfits(): { id: string; rule: string; reason: string }[] {
  return knownMisfitsSchema.parse(JSON.parse(readFileSync(KNOWN_MISFITS_PATH, 'utf8')));
}
