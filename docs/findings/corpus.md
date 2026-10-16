# Findings: corpus, parser, extraction eval (fragment)

**Everything below is computed from the MOCK corpus (6 synthetic kassabonnen I authored). It is not a real accuracy measurement.** Corpus used: `fixtures/receipts-nl/mock/` (no real `*.truth.json` exists yet).

## Verification log

| Command | Result | Counts |
|---|---|---|
| `node scripts/render-mock-corpus.ts` (run twice, `shasum` of the PNGs compared) | PASS | 6 receipts; identical SHA-256 on both runs |
| `pnpm --filter @lr/receipt-nl test` | PASS | 6 files, 173 tests (this fragment's files: corpus 22, eval 11, parse 25, primitives 51, tools 2; plus the existing lifecycle 62) |
| `pnpm --filter @lr/receipt-nl typecheck` | PASS | tsc clean (includes `test/` and the `scripts/lib` files they import) |
| `pnpm eval:extraction` | PASS | exit 0; 6 evaluated, 4 done, 2 needs_review, 0 false done |
| `pnpm exec eslint packages/receipt-nl scripts` | PASS | 0 problems |
| `pnpm lint` (whole repo) | FAIL, not mine | 2 errors in other agents' in-progress files: `apps/merchant-web/server/middleware/security.ts` (`no-useless-assignment`) and `apps/worker/test/extract-upload.test.ts` (unused `imageBytes`); 0 in files owned by this fragment |
| `tsc -p` on a temp tsconfig covering `scripts/render-mock-corpus.ts`, `eval-extraction.ts`, `lib/{corpus,eval,mock-receipts}.ts` | PASS | no errors (temp file removed) |

(`pnpm <script>` also prints an `ERR_PNPM_OUTDATED_LOCKFILE` verify-deps warning while other agents' package.json edits are unlocked; it does not stop the script.)

## Corpus misfits (Test C)

`fixtures/receipts-nl/known-misfits.json` is `[]`. Actual misfits on the mock corpus: **none** (MOCK). This says nothing about real receipts: the mock numbers were written under the §5 rule, so agreement with the rule is by construction. The check that matters (does the printed BTW on real kassabonnen follow per-rate rounding, or per-line?) is **still open** until real `*.truth.json` files arrive; Test C will report it as `vat:<rate>` misfits.

## Line-kind coverage (Test C)

| Kind | Mock receipt that passes | Status (MOCK) |
|---|---|---|
| statiegeld | `mock-supermarkt-statiegeld-bonus` | covered |
| bonus | `mock-supermarkt-statiegeld-bonus` | covered |
| weighed | `mock-weegschaal` (0,350 kg × 7,10 tie → 2,49) | covered |
| cash rounding | `mock-contant-afronding` (12,37 → −0,02) | covered |
| return | `mock-retour` (−1 × 1.249,00) | covered |

Uncovered: none on mock. Not covered by any receipt (mock or otherwise): 0% BTW rows, multi-payment receipts, tips, receipts with a `printedBase` basis `incl` on a deposit, drogist/apotheek lines, photos (the mock PNGs are clean renders, so Qianfan on real photos is untested).

## Extraction eval (Test D / `pnpm eval:extraction`) — **MOCK**

MOCK CORPUS — not a real accuracy measurement. Recorded outputs are simulated (`modelRevision: "mock"`), so they contain only the two errors I planted.

| Field (**MOCK**) | Correct | Total | Accuracy |
|---|---|---|---|
| merchant key | 6 | 6 | 100% |
| date/time | 6 | 6 | 100% |
| gross | 5 | 6 | 83% |
| BTW per rate | 5 | 6 | 83% |
| payment method | 6 | 6 | 100% |
| line count | 6 | 6 | 100% |

Status: 4 done, 2 needs_review, **0 false done** (gate holds).

| Receipt | Planted error | Status | Failed checks |
|---|---|---|---|
| mock-contant-afronding | – | done | – |
| mock-horeca-gemengd | total read `48,80` (truth `43,80`) | needs_review | `gross_sum` |
| mock-retour | – | done | – |
| mock-supermarkt-statiegeld-bonus | – | done | – |
| mock-weegschaal | – | done | – |
| mock-zonder-btw-id | 9% BTW row missing | needs_review | `vat_missing_rate` |

The 83% on gross and BTW per rate are the two planted receipts: the parser reports the misread gross (and the missing BTW row) as read, but refuses to call them `done`, which is what the gate wants.

### Gate stress test (MOCK)

For each of the 6 recorded answers every digit was deleted or replaced by each of the 9 other digits, in three sweeps (KIE corrupted with markdown intact; markdown corrupted with KIE intact; KIE corrupted with no markdown). No mutant reached `done` with a gross or per-rate BTW different from the truth (test `gate holds under single-digit OCR corruption`, 6 cases). Mutants that stay `done` are in fields the arithmetic cannot check (e.g. a digit in the date, KvK or bon number), so the gate says nothing about those fields; the date/time and merchant-key accuracy above is therefore only as good as the OCR.

## Open

- Real-corpus numbers (accuracy, per-rate vs per-line rounding, photo OCR quality) do not exist yet. Everything above is MOCK.
- `tools/qianfan/serve.md` and `colab_extract.ipynb` were not executed (no GPU/Colab here). Only their prompts and the fixed decoding flag are test-checked.
- Merchant, date and KvK/BTW-id digits are not covered by any arithmetic check; a single misread digit there still yields `done` (the BTW-id has a format check only, per v2 §5).
