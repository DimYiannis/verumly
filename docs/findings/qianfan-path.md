# Qianfan path: verification log

Run on the mock corpus (MOCK numbers).

- `pnpm --filter @lr/worker test`: PASS, 8 files, 60 tests (new: URL handling, 408/429 transient, 400 permanent, revision source, auth header).
- `pnpm --filter @lr/receipt-nl test`: PASS, 7 files, 177 tests (new `corpus-selection.test.ts`: temp real-style dir, 1 real receipt id `real-0001` derived from mock-weegschaal; real preferred by `loadCorpus`, `only:'mock'` ignores it, seed falls back to mock with <3 real, uses real at 3, eval runs on real).
- `pnpm eval:extraction`: PASS, "GATE OK: zero false done (6 receipts evaluated)", MOCK corpus.
- `pnpm db:seed`: PASS (DB already seeded, 0 created, so the corpus line is not printed; fallback covered by the corpus-selection test).
- `pnpm lint`, `pnpm typecheck`, `pnpm test:privacy` (0 hits in 35 searches): PASS.
- Notebook `tools/qianfan/colab_serve.ipynb` parses as JSON (python json.load). Not executed (no GPU/Colab here).

## Manual check with a real file present
Temporarily copied mock-weegschaal's png/truth (id `real-tmp-1`, `mock` flag dropped) and its `<sha>.qianfan.json` into fixtures/receipts-nl/:
- `pnpm test`: PASS across all packages (worker 60/60 unchanged; receipt-nl 172 tests as corpus tests then run on the 1 real receipt).
- `pnpm eval:extraction`: "Corpus: REAL (1 receipts ...)", GATE OK, 1 receipt evaluated.
- `pnpm db:seed`: ran, already seeded so no upload step. Files then removed; `git status fixtures` clean.
To repeat: drop 1 real truth+image+recording, run the three commands; remove them. Seed fallback on a fresh DB prints `Seed corpus: MOCK (... ; real corpus has 1 usable receipts, need 3)`.
