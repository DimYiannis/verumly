# Decisions

Every departure from `coding-agent-prompt-v2.md` ("v2") is marked **DEPARTURE**.

## Language

UI is English-only at the user's request (departs from v2, which asked for Dutch with English secondary).
## Environment

- **DEPARTURE — S3 service is `adobe/s3mock`, not MinIO.** `docker pull minio/minio` and `quay.io/minio/minio` both fail on this machine (`pull access denied` / `unauthorized`; MinIO's public images have been withdrawn). `adobe/s3mock` speaks the S3 API (presigned PUT, GET, buckets) and pulls fine. The code uses `@aws-sdk/client-s3` against `S3_ENDPOINT`, so any S3 service works.
- Postgres is published on host port **5433** (not 5432) to avoid clashing with a locally installed Postgres. Mailpit on 1025/8025, S3 on 9090.


# Decisions by area

The sections below were written by the agent that built each area, at the time. Each lists its departures from v2 and the reason.

## Decisions: corpus, parser, eval (fragment)

Every departure from `coding-agent-prompt-v2.md` is marked **DEPARTURE**.

## Mock corpus

- Six receipts in `fixtures/receipts-nl/mock/`, defined in `scripts/lib/mock-receipts.ts` and rendered by `node scripts/render-mock-corpus.ts` (HTML kassabon template → Playwright screenshot; fixed 480×900 viewport, 2× scale, `Courier New`). Two consecutive runs gave byte-identical PNGs on this machine. Fonts differ per OS, so a run elsewhere changes the PNG hashes: the script rewrites `truth.json` and renames the `<sha256>.qianfan.json` files in the same run, and deletes stale generated files first.
- All truth amounts are typed by hand in the data file with the arithmetic in a comment above each receipt; nothing is computed from `receipt-nl`. The tests recompute per-rate VAT independently with floating point (`Math.round(g·r/(100+r))`) and compare.
- Scenario coverage: horeca 9/21 (`mock-horeca-gemengd`), statiegeld + bonus (`mock-supermarkt-statiegeld-bonus`), weighed with a half-up tie (`0,350 kg × 7,10 = 2,485 → 2,49`), cash rounding −0,02 printed on the DST-end day (`mock-contant-afronding`), a return over €1.000 (exercises `1.249,00`), KvK only (`mock-zonder-btw-id`, also cash with a total that is a multiple of 5).
- Planted OCR errors: `mock-horeca-gemengd` total read as `48,80` instead of `43,80` (both in markdown and KIE); `mock-zonder-btw-id` lost its 9% VAT row (both outputs). Both must end `needs_review`.
- **DEPARTURE (additive) — truth.json extras.** Appendix A's example shows `"printedAt": "2026-10-01T17:42 (local, as printed)"` and `lines: null`. Files use `"printedAt": "2026-10-01T17:42"` (the parenthesis is a comment, not data; the schema only needs the `YYYY-MM-DDTHH:MM` prefix) and, because the task asks for filled lines, `lines` is an array of `{description, qty, unitPrice, vatRate, total, kind}` in cents. Mock files add `mock: true` (as asked) and `plantedOcrError` (names which receipt carries an OCR error so tests know it must be `needs_review`). `vat[].printedBase` may be null in the schema for real files where the base was not legible.
- **Recorded outputs live next to the truth files**: `mock/<sha256>.qianfan.json` for the mock corpus, `fixtures/receipts-nl/<sha256>.qianfan.json` for a real one (Appendix A step 3). v2 §11 names only the latter path for `EXTRACTOR=recorded`; the recorded extractor must therefore look in `fixtures/receipts-nl/` first and `fixtures/receipts-nl/mock/` second (or use `loadCorpus`).
- `known-misfits.json` is `[]`: no mock receipt genuinely misfits (the mock numbers follow §5 by construction). No misfit was invented.
- **The §5 per-rate rounding rule is only *confirmed on mock data*, which proves nothing** (I authored those numbers under the rule). v2 says to switch to per-line rounding if the real corpus disagrees; Test C will show that as unexpected misfits `vat:<rate>` the day real files arrive.

## Corpus selection

- `loadCorpus({ quiet?, fixturesDir? })` (`scripts/lib/corpus.ts`): real if any `fixtures/receipts-nl/*.truth.json` exists, else `mock/`; prints `Corpus: REAL|MOCK (n receipts, dir)`. `fixturesDir` exists so tests can prove the switch without writing into `fixtures/`.
- A truth file whose `sha256` is not the hash of its image, or whose image is missing, throws a precise error rather than silently skipping the receipt (the recorded output is looked up by that hash).
- The zod schemas for truth files, recorded outputs and `known-misfits.json` live in `@lr/receipt-nl` (not in `scripts/`) because the scripts directory has no `zod` of its own. `@lr/receipt-nl` gained a `zod` dependency.

## Parser (`parseExtraction`)

- Contract is the fixed `ParsedReceipt`; additionally exported: `parseCents`, `parseQty`, `parseVatRate`, `normaliseOcrText`, `normaliseName`, `normaliseKvk`, `normaliseBtwId`, `normalisePostcode`, `merchantKeyOf`, `amsterdamLocalToUtc`, `printedToUtc`, `QIANFAN_PROMPTS`, and the corpus helpers (`truthSchema`, `checkTruth`, `QUIRKS`, …).
- **KIE is primary, markdown corroborates.** Lines come from the KIE JSON (markdown table only when the KIE has no lines). Header fields fall back to markdown when KIE says null. Printed total and VAT rows must agree between the two outputs (`total_disagree`, `vat_source_disagree`). An unparseable KIE answer (`kie_unparseable`) is `needs_review` even when the markdown alone would parse: a second source that is missing is not a second source that agrees.
- **Tolerance.** v2 §11 says "2-cent tolerance" and "printed total and per-rate VAT agree with the line sum". I apply the 2 cents to *line arithmetic* (`round(qty × unitPrice)` vs the printed line total, via `validateCrf({ tolerance: 2 })`) and require **exact** agreement for printed total vs line sum and printed VAT vs the §5 rule. A tolerance there is precisely what lets a misread last digit through to `done`. A 1-cent total error is `needs_review` (unit-tested).
- VAT base on the paper may be excl or incl VAT; both are accepted (`base == net` or `base == rate gross`), anything else is `vat_base`.
- Cash rounding: a non-zero printed rounding must equal the 5-cent rule applied to the gross (`rounding_rule`), `|rounding| ≤ 2`, only with a cash payment; a cash receipt whose gross is not a multiple of 5 with no rounding printed is `rounding_missing`.
- A discount (bonus) line with no printed rate takes the rate of the nearest item above it. A negative-total line with positive qty whose description says `retour`/`terugbetaling`/`credit` and whose total equals `-(qty × unit)` becomes a return (qty negated); otherwise it is a discount. Statiegeld/emballage/leeggoed/pand lines are deposits (`vatRate: null`), outside the VAT rows (same as the earlier "deposit outside vatSummary" decision).
- Dates: Europe/Amsterdam wall clock → UTC with `Intl`. An ambiguous time (the repeated hour when summer time ends) resolves to the first occurrence (CEST); a non-existent time (skipped hour in March) is `printed_at` (needs_review).
- `merchantKey` ignores identifiers that fail their format check (they are also reported: `kvk_format`, `btw_id_format`) and falls through to the next. A name with no postcode gives `name:<n>|`. No identity at all is `merchant_missing`. Missing date/time is `printed_at`, missing payment `payment_missing`.
- The parser builds a CRF draft (placeholder ids for unreadable merchant/date) and runs the existing `validateCrf` at 2-cent tolerance, so schema and §5 failures appear as their `validateCrf` issue codes (`schema`, `line_total`, `deposit_vat`, `vat_missing`, …) in `failures`.
- `parseExtraction` never throws: an internal error becomes `parser_error` + `needs_review`.

## Tests and eval

- Test C (`packages/receipt-nl/test/corpus.test.ts`) uses `checkTruth`: line sum = gross, per-rate VAT and printed base, 5-cent rounding, payments = gross + rounding, line arithmetic; without `lines` the per-rate gross is rebuilt from printed bases. Misfits are keyed `<id>:<rule>` and compared with `known-misfits.json` in both directions. For a mock corpus every quirk must be covered; for a real corpus uncovered quirks are printed (and belong in FINDINGS) but do not fail the run.
- Test D (`eval.test.ts`) runs `evaluate()`; gate = zero false `done` (gross or any per-rate VAT differing from truth). In addition the gate is stress-tested: every digit of every recorded KIE/markdown is deleted or replaced by each other digit (three sweeps: KIE corrupted, markdown corrupted, KIE corrupted with no markdown) and no mutant may be a false `done`.
- Playwright: `@playwright/test` is a root devDependency, **pinned to 1.63.0** (not 1.64.1): the installed Chromium in `~/Library/Caches/ms-playwright` is revision 1243, which is what 1.63.0 expects; 1.64.1 wants 1248.
- `tools/qianfan/serve.md` and `colab_extract.ipynb` are not executed in this run (no GPU); a test checks that both carry the two prompts verbatim and the notebook uses `do_sample=False` and writes `<sha256>.qianfan.json`. The vLLM command is taken from the model card (`--trust-remote-code --hf-overrides '{"architectures": ["InternVLChatModel"]}'`).


## Decisions: integration tests, hardening, privacy canary

Departures from `coding-agent-prompt-v2.md` are marked **DEPARTURE**. There are none in the sense of v2 behaviour that was changed on purpose; the items below are (a) fixes to defects the new tests found, each kept minimal, and (b) choices about how the tests are built.

## Fixes to production code (each one found by a test that failed first)

1. **`apps/merchant-api/src/ingest.ts`: lock the receipt row before the replay checks.** `store()` read `ops.idempotency_keys` and `receipt_versions` *before* taking `SELECT … FOR UPDATE` on the receipt, so a request that raced its own twin (a client retry while the first attempt was still committing) found nothing in step 2, blocked on the lock, and then failed the gap check with `409 version_gap` instead of replaying. The `FOR UPDATE` select now runs first; the idempotency and `(receiptId, version)` checks follow. Observable result: N concurrent identical requests give one `201` and N−1 `200 replayed`. Test: `idempotency.test.ts › concurrent v2 …`.
2. **`apps/merchant-api/src/ingest.ts`: a receipt id that belongs to another organisation is `409 idempotency_conflict`, not a 500.** RLS hides organisation A's receipt from organisation B, so B's `POST /v1/receipts` with A's id went past the "already exists" check, hit the primary key, and the retry loop re-threw the unique violation. After the retries are used up the collision is now answered `409 idempotency_conflict` and audit-logged (`idempotency_conflict`, `detail: {version, reason: 'receipt_id_taken'}`; no content). The 409 reveals that the id exists somewhere; receipt ids are not secret (they are in every QR URL). Test: `auth.test.ts › org B cannot overwrite or probe …`.
3. **`packages/db/src/migrate.ts`: migrations are serialised cluster-wide.** Postgres roles are cluster-global, so two `migrate()` calls for different databases (parallel test files, each with its own database) raced on `ALTER ROLE` and failed with `tuple concurrently updated`. `migrate()` now takes `pg_advisory_lock(727274001)` on the maintenance database for its whole run (the lock is released when its connection closes). The migration SQL is unchanged; there is **no new migration**. Test: `packages/db/test/migrate.test.ts` (5 databases at once).
4. **`apps/buyer-api/src/routes/resolve.ts`: one rate limiter for both public resolver routes.** Giving each route its own `config.rateLimit` makes `@fastify/rate-limit` create a separate in-memory store per route, so the real limit was 30/min per IP *per route* (60 in total). v2 §10 says 30 requests/min per IP. The limiter is now created once with `app.createRateLimit` and applied in an `onRequest` hook of the resolver plugin (same `429 {error: 'too_many_requests'}`, plus `Retry-After`). Proxy headers are still not trusted (`X-Forwarded-For` spoofing does not reset it; tested).
5. **`packages/terminal-sdk/src/sdk.ts`: a refused batch no longer blocks the queue forever.** `sendBatch` treated any non-2xx batch response as "retry". A `401` (revoked or rotated key, DECISIONS: "401 is non-retryable" for single uploads) or a `400` caused by one malformed item therefore kept the same head-of-line batch retrying with backoff for ever, starving every later receipt. For non-retryable statuses the flusher now falls back to sending the batch's items one by one, so each item gets the verdict a single upload gets (dead-letter the item and its later versions; everything else flows). `5xx`, `429`, `408`, network errors and `version_gap` remain retryable. Worst case is one request per item (≤500). Also: the rejected-count no longer counts an item twice when it is both rejected itself and cascaded from an earlier rejection of the same receipt.
6. **`packages/terminal-sdk/src/mapping.ts`: the masked-PAN regex was exponential.** `(?:[*xX•#]{2,}[\s-]*)+\d{2,6}` backtracks catastrophically: `scrubDescription('x'.repeat(36))` took 0.7 s and every two extra characters tripled it, so a product text of ~60 `x` would freeze a till. Rewritten without the ambiguous nested quantifier (`[*xX•#]{2,}(?:[\s-]+[*xX•#]{2,})*[\s-]*\d{2,6}`); same matches on every fixture. Test: `mapping.test.ts › scrubbing cannot hang the till` (5 000-character inputs in under 500 ms).
7. **`packages/terminal-sdk`: `sku` and `category` are scrubbed of masked PANs before signing** (new `scrubCode`, applied in `buildCrf`, so it also covers `addVersion` patches and any caller that bypasses `mapPosSale`). Long digit runs are *kept* in these two fields on purpose: an EAN-13 is a legitimate sku. Only descriptions drop digit runs of 8 or more.
8. **`packages/terminal-sdk/src/demo.ts` added.** `package.json` had `"demo": "node src/demo.ts"` (v2 §8: `pnpm --filter terminal-sdk demo`) but the file did not exist. The demo creates a presented receipt, prints the URL and a terminal QR, adds a beer, pays cash with rounding, and uploads if a terminal's credentials are in the environment; otherwise it runs the offline half and says so. Test: `demo.test.ts` runs it both ways.

Not fixed on purpose (see findings "Open"): the three v2 Handoff issues, authentication after validation on `/v1/me/*`, no audit entry for revoked-terminal attempts, no `createdAt` skew bound.

## Test-suite choices

- **Real Postgres, real routing.** Every integration test uses `createTestDb()` and the real Fastify apps built with `buildApp`, driven through `inject` (or `listen` for the crash and demo tests). The stand-ins are: a recording `boss.send` (the journey and canary use the real pg-boss), and a stub mailer capturing login codes (the journey and canary use Mailpit).
- **`scripts/lib/testkit.ts`** is the shared fixture (`createWorld`, `buildCrf`, `submit`, `merchantPost`, `buyerCall`, `loginUser`, `injectFetch`, …). It builds CRFs *by hand* so tests can sign transitions the SDK refuses to sign (e.g. paid → presented). `WorldOptions.buyerDeps` and `World.buyerJobs` were added at the worker/buyer-REST agent's request.
- **Lifecycle expectations are written from v2 §6, not read from the code**: `lifecycle.test.ts` (merchant-api, over HTTP) and `packages/receipt-nl/test/lifecycle.test.ts` (pure function) both carry their own table of allowed pairs.
- **`fiscalised` for non-NL** is tested with an organisation whose `country` is `DE`, so the "kept for future countries" half of §5/§6 is exercised, not just the rejection.
- **Crash test design** (`packages/terminal-sdk/test/crash.test.ts`): a child process (`crash-child.ts`, plain `node`, type stripping) runs the SDK with a `SqliteStore` file against the merchant-api listening on a real port. The parent kills it with `SIGKILL` (a) when the 2nd batch *arrives* at the server (the server finishes the batch, the client never sees the ack), (b) right after the server answered the 3rd batch, (c) four times at arbitrary moments with a 60 ms-per-request server, restarting immediately so processes overlap, (d) while the child is still queueing. Afterwards it asserts through the admin pool: each `(receiptId, version)` exactly once, versions 1..n per receipt with non-decreasing `received_at`, `receipts.current_version = n`, one idempotency key per version, no `idempotency_conflict`/`failed_signature` audit rows, and an empty SQLite outbox. Global arrival order across receipts is asserted only where the restart waits for the server to go quiet (a), (b), (d); with overlapping processes (c) it is not an invariant (per-receipt order is).
- **Privacy canary** (`scripts/privacy-canary.ts`, `pnpm test:privacy`) searches, besides the three artefacts v2 names, the `ops` and `pgboss` dumps (merchant-api writes audit rows and jobs there). The needles are the e-mail, its local part, the secret, the user id and the session token, plus the first 16 characters of the secret and token (catches truncated logging); matching is case-insensitive and also covers URL-encoded and JSON-escaped forms. Positive controls: the buyer-schema dump must contain the e-mail and user id, the merchant dump and the logs and the responses must contain the receipt id, and the buyer dump must hold only the sha256 of the token. A mutation check (a deliberate `req.log.info(\`… ${email}\`)` in `auth.ts`) made `pnpm test:privacy` exit 1 with 2 leaks (logs: e-mail, e-mail local part); the change was reverted.
- **Wrappers in `pnpm test`.** `apps/merchant-api/test/privacy-canary.test.ts` and `journey.test.ts` run the canary and the journey inside vitest. Each takes ~2 s (measured), well under the 60 s bar. They need Mailpit (as `pnpm test:journey` always did).
- **Root script:** `pnpm test:privacy` → `node scripts/privacy-canary.ts`.
- **`vitest.config.ts`** in each package I own sets `testTimeout 60 s`, `hookTimeout 120 s` (database creation).
- **Dead letters:** the SDK keeps dead-lettered items in its `rejected` table but has no replay API; a revoked terminal's queue is therefore preserved for inspection, not resent. Recorded in findings; no API was invented.


## Decisions: worker, buyer-api uploads/insights/consents/push/export/pdf/account, seed, leads report

Every departure from `coding-agent-prompt-v2.md` ("v2") is marked **DEPARTURE**.

## Structure

- **DEPARTURE — new package `@lr/storage`** (`createObjectStore(env) → ObjectStore`: presign PUT/GET, head, get, put, remove). v2 §4 lists no such package. Reason: buyer-api (presign, head, remove), the worker (get, put exports, presign GET) and the seed all need the same S3 calls; one wrapper beats three copies of the AWS SDK setup. buyer-api no longer depends on the AWS SDK directly. `@lr/config`'s `s3EnvSchema` is the env contract (unchanged).
- `@lr/db` gains `connectAdmin(env)` (owner connection for provisioning: seed, test fixtures) and `matching.ts` (`orgIdsByIdentifiers`, `findMatchingReceipt`), shared by the worker's `extract-upload` and buyer-api's `PATCH /uploads/:id` (a corrected total can create a match). `RollupDailyJob` fields are optional so the cron job can send `{}`.
- The keyword categoriser lives in `@lr/receipt-nl` (`categorise.ts`) because buyer-api's insights apply the same rules to uploaded receipts at read time.
- Job handlers are exported plain functions `(ctx, job)`; `registerJobs(boss, ctx)` is the only place that touches pg-boss. Tests call the handlers directly, and one test runs the real loop.

## Database (migrations 0003, 0004)

- `merchant.receipt_lines` gets `category text` and `sensitive boolean`. merchant-api ingest now stores the CRF line `category` the terminal sent (one added line); `categorise` fills the null ones. `me.ts` was already filtering on `l.category`.
- `merchant.exports` gets `url` (presigned GET, 24 h) and `expires_at`. The `export` job fills them in addition to `status` and `s3_key`.
- Grants (0004): `worker` may read `organizations.retention_years` and delete `ops.idempotency_keys` (rows of receipts removed by retention). The column grants still exclude every key, password and TOTP column.

## Worker (v2 §11)

- **`extract-upload`**: S3 → `Extractor` → `parseExtraction` → `done` | `needs_review`. `EXTRACTOR=recorded` reads `<FIXTURES_DIR>/<sha256>.qianfan.json`, then `mock/`. `EXTRACTOR=http` sends the image to `QIANFAN_URL` twice (`QIANFAN_PROMPTS.markdown`, `.kie`), `temperature 0`. No fake extractor: an image without a recording becomes `failed` with `no_recorded_extraction`.
  - Permanent errors (no recording, 4xx from the model server, unknown file type) mark the upload `failed` with a code. Anything else is rethrown so pg-boss retries (`retryLimit 3`, backoff, set by buyer-api); on the last attempt the upload becomes `failed: extractor_unavailable`.
  - Statuses written by the API/worker: `pending_upload → processing → done | needs_review | failed`, and `replaced` after accept-match.
  - **Matching**: org found by VAT ID **or** KvK; receipt unclaimed, state not `open`/`void`, `total_minor == parsed.gross` (the parser's gross is the sum of the lines, which is the CRF gross, not the rounded cash total), and the receipt's creation **or** latest version within ±30 minutes of the printed time; the closest wins.
  - **Leads**: only when the merchant is not a known organisation. Keyed by the parser's `merchantKey`. The lead row is locked (`for update`) while counting so concurrent uploads of different users are all counted. `needs_review` uploads count too (the key is usually fine). `status` becomes `new` at `LEAD_THRESHOLD` (default 20) distinct uploaders. A known merchant is never a lead even if no receipt matched.
- **`notify-version`**: owner's subscriptions, `web-push.generateRequestDetails` + `fetch` (plain-http test endpoints work), `aes128gcm`, VAPID from env. 404/410 delete the subscription. Other failures (5xx, network) are tried for every subscription first and then fail the job, so pg-boss retries. Duplicate protection: merchant-api enqueues only for newly stored versions (replays say `notify: false`), and every push carries a `Topic` derived from `(receiptId, version)` so a push service coalesces a retried delivery. pg-boss `singletonKey` alone is not a guarantee (it only dedupes queued/active jobs; I measured a duplicate once a job had completed).
  - Payload (encrypted): `{title, body, receiptId, version, final}`; English text, merchant name only, no amounts. `final` is true when the state is final for the country (NL: `paid`) and for `void`.
  - Push is **not** gated on the `push` consent: the subscription row is the opt-in (the wallet only creates it after the user agrees). With no VAPID keys the job is skipped.
  - Nothing sensitive is logged: ids and counts only.
- **`rollup-daily`**: a receipt counts on the Amsterdam day of its **latest version** (when it became paid/void), the same basis as `vatByDay`, so the rollup and the VAT export agree. `[from,to]` (default: last 3 days, all orgs) is replaced in one transaction, so a later void stops counting. Cron every 30 minutes.
- **`export`**: kinds are the ones merchant-web already uses: `sales_csv` (one row per paid/void receipt) and `btw_csv` (accountant: VAT per day and rate, then period totals per VAT return box: 21% → 1a, 9% → 1b, 0% → 1e; amounts in cents). Both use `@lr/dashboard-core` helpers (`vatByDay`, new `receiptsForExport`, `salesCsv`, `btwAccountantCsv`). Cells starting with `= + - @` are prefixed with `'` (CSV formula injection). The S3 objects are not deleted after the 24 h link expires (lifecycle rules are a deployment decision).
- **`retention`** (daily 03:30): merchant receipts older than `organizations.retention_years` (by `created_on_terminal_at`) with versions, lines, claims on them and idempotency keys; buyers deleted more than 30 days ago (S3 objects first, then the user row, which cascades; lead-uploader rows removed and counts recomputed; an `account_hard_deleted` audit entry with only a count); expired email codes and sessions; `resolve_failures` older than 1 day; `pending_upload` uploads older than 1 day. **Merchant receipts that a deleted buyer claimed stay** (they belong to the merchant). Daily rollups stay: they are aggregates and part of the bookkeeping.
- **`categorise`** (every 10 minutes): null `category` → rule table, no match → `overig` (so each line is processed once). A terminal-supplied category is never overwritten. Health lines are `sensitive`: every line at a merchant named `apotheek`/`apotheker`; at a `drogist` only lines with health keywords. Insights report sensitive lines as `overig`, so the API never reveals a health category.
- Schedules use `tz: Europe/Amsterdam`, registered by whichever worker starts (pg-boss de-duplicates schedules by name).

## Buyer API

- **Uploads are not receipts.** They never appear in `GET /v1/me/receipts`; they have their own list (`GET /v1/me/uploads`). A `done` upload counts in insights; `replaced`, `needs_review` and `failed` do not. Accept-match creates a `photo_match` claim and marks the upload `replaced`.
- `PATCH` is allowed only in `needs_review`. The corrected draft is `done` when it is complete and the lines sum exactly to the total, each line is qty × unit price ±2 cents and every non-deposit line has a VAT rate; VAT per rate is then derived from the lines. Otherwise it stays `needs_review` with the failed checks.
- The presigned PUT signs `Content-Length` (real S3 refuses another length). `adobe/s3mock` does not enforce it, so `complete` also checks the stored size (`1..10 MB`, else the object is deleted and the upload fails `bad_size`). Limits: 50 upload requests per user per hour; JSON bodies 1 MB.
- **Push endpoints are restricted** because the worker POSTs to them: `https` always; plain `http` only for `localhost`/`127.0.0.1`/`[::1]` and only when `PUSH_ALLOW_LOOPBACK` is on (default on unless `NODE_ENV=production`). At most 10 subscriptions per user. An endpoint registered again by another account moves to it (same browser, new login).
- Consents: purposes `analytics`, `marketing`, `push`, default all off; `PUT` appends a row (with `policy_version`, env `POLICY_VERSION`) only for purposes whose value changes. The table stays INSERT/SELECT only for the DB role (tested).
- Insights count claimed receipts in state `paid`/`fiscalised` plus `done` uploads: pre-bills and voids are not spending. Months are Amsterdam months. Top merchants: 10.
- `GET /v1/me/export`: user, consent history, push subscriptions (endpoint and user agent, **not** keys), every claimed receipt with all versions, uploads. No session hashes, no claim-secret hashes.
- `DELETE /v1/me` soft-deletes, deletes all sessions and push subscriptions in one transaction, writes an audit entry without the user id.
- The JSON body parser accepts an empty body with `content-type: application/json` (found in the smoke test: Fastify's default answers 400 to a body-less POST that carries the header).
- The PDF is rendered with pdfmake's standard Helvetica (no font files). pdfmake has no types, so `src/pdfmake.d.ts` declares the three calls used; `receipt-pdf.ts` references it so every program that imports the file sees it.

## Seed (`pnpm db:seed` = `node scripts/seed.ts`)

- Receipts go through the real path: `TerminalSdk` signs, its flusher posts to merchant-api's real Fastify app in-process (`app.inject` behind a `fetch` adapter), so the signature, lifecycle and idempotency checks run. 200 receipts for Café Het Plein over 60 days (2 terminals): 191 paid (20% via a presented first version, 30% cash with 5-cent rounding), 4 void, 5 presented; 9% and 21% items.
- 30 claims by `buyer@example.test` (every 6th paid receipt). 3 uploads from the corpus (`loadCorpus`: real files if present, else mock) with the recorded extractor: one `done` that matches an official receipt of a second organisation (the corpus merchant), one `needs_review`, one other.
- **The mock corpus' printed dates are in the future** (October 2026), so the official receipt that matches the upload is dated in the future too.
- Idempotent: every step checks what exists. A second run adds nothing (it reports `0 receipts, 0 claims, 0 uploads, 0 terminals`). Terminal API keys are shown once, at creation; they and the signing seeds are saved in the git-ignored `.local/seed.json` (merged by terminal id) so a later top-up can sign. The dashboard user is `owner@example.test` / `owner-dev-password` (development only; TOTP is enrolled at first login). `buyer@example.test` logs in with the Mailpit code.
- The seed also runs `categorise` and `rollup-daily` so a fresh dev database shows categories and rollups without the worker running.
- `pnpm leads:report` prints counts only: totals per status and a histogram of distinct uploaders. No names, keys, postcodes or ids (tested).


## Wallet (`apps/wallet`) decisions

Departures from `coding-agent-prompt-v2.md` are marked **DEPARTURE**.

## Departures / choices v2 left open

- **Client-rendered SPA (`ssr: false`), Nitro default node preset.** The secret lives in the URL fragment and every API call is a direct browser → buyer-api call, so there is nothing to server-render; one shell precaches cleanly. `nuxt build` emits `.output/server/index.mjs` (plain Node server). Consequence: the node preset has **no static `index.html`**; the Nitro server renders the SPA shell for every path.
- **Service worker = `@vite-pwa/nuxt` `injectManifest` with a custom `service-worker/sw.ts`** (not `generateSW` + `importScripts`). Reason: push + `notificationclick` + shell precache in one typed file with workbox-precaching/-routing. Because there is no static `index.html`, `/` itself is added with `additionalManifestEntries` (revision = build time) and `NavigationRoute(createHandlerBoundToURL('/'))` answers every navigation. Side effect: the precached shell embeds the runtime config (buyer-api URL) as of the last build/SW update. `srcDir` is `'../service-worker'` because the module resolves it relative to Nuxt's `app/` dir.
- **DEPARTURE (minor): `@playwright/test` is the repo's 1.63.0, not 1.64.** That is the version whose browsers are in `~/Library/Caches/ms-playwright`. The smoke script launches `channel: 'chromium'` (full Chromium, new headless) because `chromium_headless_shell` reports `Notification.permission === 'denied'` regardless of grants, which makes push untestable.
- **Pending-claim record has an extra field `autoClaim`** beyond v2's `{receiptId, secret, createdAt}` (plus `lastAttemptAt`, `status`). `autoClaim: true` = claim in the background (buyer already chose Save, or scanned offline). `false` = *parked* by a logged-out "Save to wallet" tap: it keeps the secret across the login round trip but is **never claimed without the buyer confirming on the "Save this receipt?" sheet**; without it the retry that follows login would silently claim and skip the sheet. Parked claims still expire after 7 days.
- **Closed claims keep a record but drop the secret.** After 7 days (`expired`) or a permanent refusal (409 `already_claimed`, 410 `claim_expired`) the entry becomes `{status:'closed', reason}` and is shown in the Arriving section until dismissed ("Couldn't get this receipt — ask the shop").
- **Retry policy** (`app/utils/retry.ts`): triggers are app open, `online`, `visibilitychange` (visible); no Background Sync, no timers. A claim is attempted at most every 10 s (several triggers fire together), except the `online` event which retries immediately. HTTP 404 on `/v1/me/claims` is retried (an unknown receipt id and a wrong secret are indistinguishable by design, see DECISIONS "Buyer API"). 401 stops the run and ends the session but keeps the claims.
- **Offline-first order on `/r/<id>`**: fragment captured by a `pre` plugin before the router (`plugins/capture-fragment.ts`) → secret in an in-memory vault + `history.replaceState` (keeps path, query and router state) → `resolve/view`. Any fragment on `/r/*` is stripped, valid or not. The secret is persisted only in the pending-claim store (on Save-while-logged-out, network failure, or server `pending`). `/r/<id>` without a fragment uses a parked secret, or redirects to `/receipts/<id>` if the receipt is already mine.
- **Logged-out visitors get no confirm sheet** (only the read-only receipt and "Save to wallet"); logged-in visitors get "Save this receipt?" / "Not mine" at once. If the receipt is already claimed by someone else (preview `claimed` and not in my wallet) the sheet is replaced by a notice.
- **Onboarding never blocks a claim.** Login returns to `next` (same-origin relative paths only) when present; only a login without `next` goes to `/onboarding` the first time. Otherwise the wallet shows an "Stel je voorkeuren in" prompt until onboarding is finished. Consents are all off by default and written immediately on toggle (`PUT /v1/me/consents`, append-only server side). Enabling push also records `push: true`, disabling records `false`.
- **Session = opaque bearer token in IndexedDB** (`kv` store), not cookies, not localStorage (readable by the service worker context and consistent with the other offline stores). **Logout wipes** the cached receipts and **all pending/closed claims**, so the next person on a shared phone sees nothing and cannot claim the previous person's pending receipts.
- **Offline cache** (IndexedDB `lr-wallet`): `receipts` (detail incl. versions, written on every successful detail load and after every claim), `receiptList` (first unfiltered page + loaded pages), `pendingClaims`, `kv`. Offline list search filters the cached list client-side (text, merchant, state, dates; not category, which needs line data). A saved receipt opened offline renders from cache with an the offline-cache notice notice.
- **Uploads are not receipts** (buyer-api never lists them in `/v1/me/receipts`), so the wallet shows them in a separate "Toegevoegde foto's" section and on `/uploads/<id>`. Upload statuses follow buyer-api: `pending_upload`, `processing`, `done`, `needs_review`, `failed`, `replaced`.
- **Two file inputs on `/add`**: the spec'd `<input type=file accept="image/*,application/pdf" capture=environment>` (camera) plus a second one **without** `capture`, because `capture` forces the camera on phones and a PDF could then never be chosen.
- **Response DTOs are parsed with zod at the boundary** (`app/utils/api-schemas.ts`), reusing `crf`, `receiptPreview`, `parsedLine`, `UPLOAD_*`, `MAX_UPLOAD_BYTES` from `@lr/schema`; wallet-only response shapes (list, insights, consents, upload status view) are defined locally because buyer-api builds them in route code, not in `@lr/schema`. zod is in the client bundle (`@lr/schema`'s index does not pull `zod-to-openapi`).
- **Totals display**: "Total" = `totals.gross` (same number as the sheet and the list, which use `receipts.total_minor`); rounding and tip are separate lines and "Amount due" (gross + tip + rounding) is shown only when they are non-zero.
- **Uploaded-receipt times**: the correction form edits time as Amsterdam wall-clock (`datetime-local`) and converts to UTC ISO (`amsterdamLocalToUtcIso`, DST-aware, unit-tested).
- **Headers**: `routeRules` set `Referrer-Policy: no-referrer`, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Permissions-Policy`, and `Cache-Control: no-cache` on `/sw.js`. **No CSP** yet: `connect-src` would have to list buyer-api and the S3 host, which are deployment decisions.
- **Tooling**: `vue-router` is not a direct dependency (Nuxt 4.6 pins its own v5). `test` and `typecheck` run `nuxt prepare` first (the app tsconfig references generated `.nuxt/` files; vitest's transformer needs them). `typecheck` = `nuxt typecheck` (vue-tsc over app) + `tsc -p tsconfig.sw.json` (service worker, `WebWorker` lib) + `tsc -p tsconfig.test.json` (utils/tests, DOM lib). `eslint` does not parse `.vue` files (no eslint-plugin-vue; optional per the brief); `.ts` files are linted by the root config.
- **PWA icons** are generated PNGs (192, 512, maskable 512, apple-touch 180) rendered from `public/icon.svg` with Playwright once; committed.

## Push payload contract (agreed with WorkerBuyerRest, matches `apps/worker/src/jobs/notify-version.ts`)

`{"title": string, "body": string, "receiptId": uuid, "version": int, "final": bool}`, no receipt content. SW shows title/body, tag = receiptId (a newer version replaces the older notification) and `notificationclick` opens `/receipts/<receiptId>` (focus + navigate an open window, else `openWindow`). A malformed payload still shows a generic notification.

## Stable `data-testid`s (Playwright relies on these)

| Area | test ids |
|---|---|
| Viewer `/r/:id` | `presented-banner`, `void-banner`, `final-badge`, `receipt-view` (`data-state`, `data-version`), `receipt-merchant`, `receipt-time`, `receipt-lines`, `receipt-line` (`data-kind`), `receipt-total`, `receipt-rounding`, `receipt-payable`, `vat-summary`, `vat-row` (`data-rate`), `payments`, `version-history`, `version-<n>`, `old-version-note` |
| Viewer states | `loading`, `pending-state`, `arriving-state`, `not-found`, `rate-limited`, `load-error`, `invalid-link`, `incomplete-link`, `taken-notice`, `dismissed-notice`, `reopen-sheet` |
| Save / sheet | `save-to-wallet` (logged out), `confirm-sheet`, `confirm-sheet-backdrop`, `sheet-merchant`, `sheet-total`, `sheet-time`, `sheet-error`, `save-button`, `not-mine-button` |
| Login | `email-login`, `login-email`, `login-send`, `login-info`, `login-code`, `login-verify`, `login-error`, `login-link` (landing) |
| Wallet `/` | `landing`, `search-input`, `toggle-filters`, `filters`, `filter-state`, `filter-from`, `filter-to`, `filter-merchant`, `filter-category`, `day-group` (`data-day`), `day-heading`, `receipt-item` (`data-receipt-id`, `data-state`), `load-more`, `empty-wallet`, `offline-list-note`, `onboarding-prompt`, `uploads-section`, `upload-item` |
| Arriving | `arriving-section`, `arriving-list`, `arriving-item` (`data-receipt-id`), `closed-list`, `closed-item` (`data-reason`), `dismiss-closed` |
| Detail `/receipts/:id` | `saved-notice`, `cached-notice`, `unavailable`, `download-pdf`, `pdf-error` |
| Layout | `offline-badge`, `nav-wallet`, `nav-add`, `nav-insights`, `nav-settings` |
| Add / uploads | `file-input` (camera), `file-input-library`, `upload-step`, `upload-error`, `upload-processing`, `upload-failed`, `upload-failures`, `upload-done`, `upload-draft-lines`, `upload-replaced`, `correction-section`, `correction-form`, `corr-merchant`, `corr-printed-at`, `corr-gross`, `corr-line`, `corr-line-desc-<i>`, `corr-line-total-<i>`, `corr-add-line`, `corr-errors`, `corr-submit`, `match-offer`, `accept-match`, `decline-match` |
| Insights | `chart-months`, `chart-categories`, `chart-merchants`, `bar`, `no-insights` |
| Onboarding / settings | `consents`, `consent-analytics`, `consent-marketing`, `consent-push`, `consent-status`, `push-optin`, `push-enable`, `push-disable`, `push-status`, `push-error`, `ios-install-hint`, `ios-too-old`, `push-denied`, `push-unsupported`, `install-hint`, `install-button`, `onboarding-done`, `settings-email`, `export-button`, `logout-button`, `delete-account`, `confirm-delete`, `settings-error` |

## Routes

`/` wallet or landing · `/login?next=` · `/onboarding` · `/r/:id` (viewer; secret in the fragment) · `/receipts/:id` · `/add` · `/uploads/:id` · `/insights` · `/settings`. Runtime config: `NUXT_PUBLIC_BUYER_API` (default `http://127.0.0.1:4002`), optional `NUXT_PUBLIC_VAPID_PUBLIC_KEY` (else `GET /v1/push/vapid-public-key`), `RECEIPT_HOST`; validated with `loadEnv` in `nuxt.config.ts`.


## Decisions: merchant-web, dashboard-core, browser terminal

Every departure from `coding-agent-prompt-v2.md` ("v2") is marked **DEPARTURE**.

## Dashboard auth (v2 §12, §14)

- Login is two steps. Step 1 (email + password, argon2id via `@node-rs/argon2`) creates a session row with `mfa_done = false` that lives **10 minutes** and can only be used to finish MFA. Step 2 (TOTP enrol or verify) flips `mfa_done` and gives the session its full **12 hour** lifetime. Session tokens are 32 random bytes, only sha256 is stored, lookups go through `merchant.find_dashboard_session`.
- Wrong email and wrong password are indistinguishable (a dummy argon2 verify runs for unknown emails).
- **TOTP enrolment is stateless until the first code is right.** `beginTotpEnrol` returns the seed (base32 + `otpauth://` URI) and an `enrolToken` = the seed encrypted with the KeyProvider and bound to the session hash (10 min). Nothing is written to `merchant_users` until `confirmTotpEnrol` verifies a code; the update only applies while `totp_secret_encrypted is null`. A user who abandons enrolment therefore stays "not enrolled".
- Anyone who knows a password for a not-yet-enrolled account can enrol their own authenticator (inherent to "enrol at first login"). Mitigation: owners create users with an initial password and hand it over; an owner can reset a user's authenticator (`resetUserTotp`, also deletes their sessions).
- Wrong codes: after **5** failures the pending session is deleted (counted in memory per process) and each failure writes `dashboard_mfa_failed` to `ops.audit_log` (user id, never email). A per-user lockout across processes is **not** built (Deferred).
- TOTP: SHA-1, 6 digits, 30 s, window ±1 step (`otpauth` 9). Code replay inside the window is not blocked (Deferred).
- Login and TOTP endpoints are limited to `LOGIN_RATE_LIMIT` (default 20) attempts per client IP per 5 minutes, in memory per process (same store decision as the buyer API: a shared store is a deployment decision).
- `KeyProvider` is an interface (`encrypt`/`decrypt`); `LocalKeyProvider` is AES-256-GCM with the env key `DASHBOARD_ENCRYPTION_KEY` (32 bytes base64), format `v1.<iv>.<tag>.<ct>`. A public **development** key is used when the variable is unset and `NODE_ENV != production`; in production the server refuses to start without it.

## Roles (v2 §7, §12)

- Permissions are a table (`ROLE_PERMISSIONS`), enforced by `requireRole(actor, permission)` **inside every dashboard-core function that takes an `Actor`**, and again at the HTTP handler. The Nuxt routes can therefore not forget the check.
  - owner: everything.
  - manager: archive, reports, exports, organisation (read), locations and terminals (read/write). **No** organisation settings and **no** user management. (v2 only names the three roles; this split is my choice.)
  - accountant: read-only: organisation, locations, archive, reports, exports (list **and request**; v2: "reads + exports only"). No terminals, no users.
- The last owner cannot be demoted or deleted, and a user cannot delete themselves.
- `searchArchive`, `getReceiptWithVersions`, `vatByDay` keep their old signatures (the journey uses them). They take an org id, not an actor, so the **HTTP handler** is what enforces `archive.read` for them.

## Reports

- `salesReport` is computed from the latest version of each receipt, not from `daily_rollups`, so it is correct before the rollup job runs. v2 allows "receipts/rollups".
- A receipt is counted on the Europe/Amsterdam day of its **latest version** (when it reached its final state). `paid` = sale, `void` = void (count and gross reported separately, excluded from sales/VAT), `open`/`presented` = neither.
- VAT per rate is the sum of the per-receipt `vatSummary` rows (each already rounded per receipt and rate), so it equals what was printed.
- I changed `vatByDay` to filter on the same date it groups by (the latest version). Before, it filtered by receipt creation and grouped by version time, which disagreed for a bill presented before midnight and paid after.

## Terminals

- The dashboard never generates the Ed25519 key: the caller supplies the 32-byte base64url **public** key (validated: exact alphabet, 43 chars, 32 bytes). The page offers "generate a keypair in this browser" and shows the private key once, client-side only.
- API key: 32 random bytes, returned once from the create call, sha256 stored. Audit: `terminal_key_created`, `terminal_key_revoked` (org, terminal, acting user id, label; never the key). Revoke is idempotent and audits only the first revoke.
- A terminal can only be created on a location the caller's org can see (RLS makes the lookup empty otherwise; the FK alone would accept another org's location id).
- Revoking has an inline two-step confirm (`terminal-revoke` → `terminal-revoke-confirm`), not `window.confirm`, so Playwright does not auto-dismiss it.

## Exports (contract with the worker)

- `merchant.exports.kind` ∈ `sales_csv` | `btw_csv`; the dashboard inserts `status = 'queued'` and then `boss.send('export', { exportId })` (after commit).
- The worker (confirmed by its author) sets `status` `processing` → `done` | `failed` and `s3_key`; it also writes `url`/`expires_at` (migration 0003), which the dashboard does not read. `listExports` presigns a **fresh 24 hour GET link every time the list is read** (the table has no expiry column), so "link valid 24 h" means 24 h from the moment you looked.

## Merchant web (Nuxt)

- Nuxt 4, Vue 3 `<script setup lang="ts">`, Tailwind 4 via `@tailwindcss/vite`, Nitro default node preset. `/dashboard/**` and `/simulator` are **client-rendered** (`ssr: false`): no cookie forwarding on SSR and no hydration mismatch with localStorage/IndexedDB.
- Workspace packages ship `.ts`; `nitro.externals.inline: [/^@lr\//]` bundles them into the server output (Node will not strip types under `node_modules`).
- Session cookie: `lr_dashboard`, httpOnly, SameSite=Lax, Path=/, 12 h; with `Secure` and the `__Host-` prefix when `DASHBOARD_COOKIE_SECURE` is true (default: true when `NODE_ENV=production`).
- CSRF for state-changing `/api/**` requests: SameSite=Lax **plus** an `Origin` check (must equal the request `Host`); a request with no `Origin` is accepted only with `Sec-Fetch-Site: same-origin`. 256 KiB body cap.
- Headers: nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP same-origin, restrictive Permissions-Policy, HSTS when cookies are Secure, `Cache-Control: no-store` on API responses. **DEPARTURE-ish:** the CSP is sent in production only (Vite's dev server needs eval and websockets) and keeps `script-src 'self' 'unsafe-inline'` / `style-src 'unsafe-inline'` because Nuxt writes an inline bootstrap script; nonces are Deferred.
- `/sim-api/**` is a same-origin proxy to `MERCHANT_API_URL` (default `http://127.0.0.1:4001`): only `/v1/**`, a header allowlist (`content-type`, `authorization`, `x-terminal-id`, `x-signature`, `idempotency-key`, `accept`), so the dashboard cookie never reaches merchant-api, and merchant-api needs no CORS. It is not CSRF-checked (it uses Bearer keys, not the cookie).
- Env is validated with zod (`loadEnv`) at server start (`server/plugins/env.ts`). `RECEIPT_HOST` is read at runtime through `GET /api/simulator/config`, not baked into the client bundle.

## Simulator

- Product grid buttons are the "Add item" action. While a bill is `presented`, tapping a product immediately sends a new `presented` version (live update). `Present` sends the cart as a presented receipt (or re-sends it). `Pay card` / `Pay cash` start a receipt directly at `paid` when none exists (v2 allows starting at paid). Cash uses the SDK's 5-cent rounding. `Void` voids the current receipt. `New sale` clears the cart. There is no Fiscalise button.
- Offline toggle: stops the SDK flusher and makes the SDK's `fetch` reject, like a dead network. Turning it off restarts the flusher; the outbox drains in order.
- The outbox is IndexedDB (`IndexedDbStore`, `@lr/terminal-sdk/idb`, `idb`): `commit` writes the receipt and the outbox item in one transaction and aborts both if either write throws (tested).
- "Set up demo terminal": needs a signed-in dashboard session; generates the keypair in the browser (`@lr/crypto`), registers the public key through the normal terminal API, and stores `{terminalId, apiKey, privateKey, merchant}` in `localStorage` (`lr.sim.terminal`). This is a demo POS: do not use real keys.
- The QR is the SDK's SVG, shown at `min(68vh, 36rem)` square (about 576 px at a 1280×900 window), with the URL printed below it as text (`sim-qr-url`).

## Shared package changes

- **`@lr/crypto` is now isomorphic.** It imported `randomBytes`/`timingSafeEqual` from `node:crypto` and used `Buffer`, which cannot run in the browser simulator. It now uses `globalThis.crypto.getRandomValues`, a manual constant-time compare of the two sha256 digests, and `btoa`/`atob` when `Buffer` is missing. Behaviour and exports are unchanged (17 crypto tests, incl. the RFC vectors, still pass).
- `@lr/terminal-sdk` gets the `./idb` export, `idb` as a dependency, `fake-indexeddb` as a dev dependency, and `lib: DOM` in its tsconfig (for the IndexedDB types).

## data-testid reference

Login: `login-email`, `login-password`, `login-submit`, `login-error`, `totp-enrol`, `totp-secret`, `totp-uri`, `totp-input`, `totp-submit`.
Layout: `nav-archive|reports|exports|organisation|locations|terminals|users|simulator`, `whoami`, `logout`, `error` (inline error on every page).
Organisation: `org-legal-name`, `org-kvk`, `org-vat`, `org-retention`, `org-save`, `org-saved`.
Locations: `location-row`, `location-name|address|postcode`, `location-add`, `location-edit`, `location-edit-name`, `location-save`, `location-delete`.
Terminals: `terminal-label`, `terminal-location`, `terminal-public-key`, `terminal-generate`, `terminal-private-key`, `terminal-create`, `terminal-created`, `terminal-key` (the API key, once), `terminal-id`, `terminal-key-dismiss`, `terminal-row` (`data-terminal-id`), `terminal-label-cell`, `terminal-status` (`active`/`revoked`), `terminal-revoke`, `terminal-revoke-confirm`.
Archive: `archive-q`, `archive-state`, `archive-from`, `archive-to`, `archive-amount`, `archive-search`, `archive-refresh`, `archive-table`, `archive-row` (`data-receipt-id`, `data-state`), `archive-link`, `archive-state-cell`, `archive-total`, `archive-empty`, `archive-prev`, `archive-next`; detail: `archive-detail-id`, `archive-detail-state`, `archive-version` (`data-version`), `archive-line`, `archive-vat`, `archive-version-total`, `archive-pdf`.
Reports: `report-from`, `report-to`, `report-granularity`, `report-location`, `report-run`, `report-sales-row` (`data-period`), `report-vat-row` (`data-period`, `data-rate`), `report-total`, `report-empty`.
Exports: `export-kind`, `export-from`, `export-to`, `export-request`, `export-row` (`data-status`), `export-status`, `export-link`.
Users: `user-row`, `user-email`, `user-role`, `user-reset-totp`, `user-delete`, `user-new-email`, `user-new-password`, `user-new-role`, `user-create`.
Simulator: `sim-setup-panel`, `sim-setup`, `sim-error`, `sim-add-koffie|appeltaart|bier|wijn`, `sim-cart`, `sim-cart-line`, `sim-rounding`, `sim-total`, `sim-state`, `sim-version`, `sim-present`, `sim-void`, `sim-pay-card`, `sim-pay-cash`, `sim-new-sale`, `sim-offline-toggle` (checkbox), `sim-pending` (polled every 400 ms, so it can lag a click), `sim-rejected`, `sim-network`, `sim-terminal-id`, `sim-reset`, `sim-qr` (the SVG container), `sim-qr-url`, `sim-qr-placeholder`, `sim-dashboard-link`.

## Deferred (from this slice)

- Per-user, cross-process MFA lockout; TOTP code replay protection; password change / reset by email; CSP nonces; a shared rate-limit store.


## Decisions: browser E2E (Playwright), dev-stack defaults

Departures from `coding-agent-prompt-v2.md` / `DIRECTIONS.md` are marked **DEPARTURE**. Spec: v2 §16.G, DIRECTIONS §6a.

## What was built

- `playwright.config.ts` (repo root), tests in `e2e/` (`*.spec.ts`), helpers in `e2e/support/`. `pnpm test:e2e` = `playwright test`. Config as DIRECTIONS §6a demands: `use: { trace: 'on', screenshot: 'on', video: 'retain-on-failure' }`, `reporter: [['html', { open: 'never' }], ['list']]`. One project (Desktop Chrome, 1280×900, `channel: 'chromium'` = the installed full Chromium revision, as the wallet smoke test already did), `workers: 1`, `retries: 0` (a retry would hide a flake), test timeout 120 s.
- `pnpm e2e:report` = `rm -rf docs/e2e-report && cp -R playwright-report docs/e2e-report`. `docs/e2e-report/` and `docs/e2e-screenshots/` are **not** git-ignored (`playwright-report`, `test-results` and `.local` still are). `eslint.config.js` ignores `docs/e2e-report/**` (the report ships minified viewer JS that fails `no-undef`).
- **Seven named screenshots** are written by the tests into `docs/e2e-screenshots/`: `qr-on-simulator`, `prebill-banner-phone`, `save-receipt-sheet`, `wallet-with-receipt`, `final-version-after-paying`, `arriving-state`, `dashboard-archive` (`.png`). They are overwritten on every run.
- **`e2e/` is a workspace package (`@lr/e2e`, listed in `pnpm-workspace.yaml`) with only a `typecheck` script**, so `pnpm typecheck` (turbo) type-checks the config, the specs and the helpers like every other package (`e2e/tsconfig.json`, DOM lib for the `page.evaluate` callbacks). It declares `@playwright/test` **1.63.0** (same pin as the root), `otpauth`, `pg` and the workspace packages the helpers import.
- Scenarios (all four of §16.G): `buyer-journey.spec.ts`, `buyer-offline.spec.ts`, `merchant-offline.spec.ts`, `dashboard.spec.ts`. Details of what each asserts are in `docs/findings/e2e.md`.

## Stack handling (`e2e/global-setup.ts`)

- The suite runs against the apps **started by `pnpm dev`** on their normal ports (merchant-api 4001, buyer-api 4002, merchant-web 3000, wallet 3001; Postgres 5433, Mailpit 8025/1025, S3 mock 9090 from docker compose). The wallet must be reached as `http://localhost:3001` because buyer-api's CORS allows only `RECEIPT_HOST`.
- **Reuse or start**: if any of the four ports answers, the stack is reused as it is; if none does, global setup creates + migrates the database named by `PG_DATABASE` (default `receipts`; `ensureDatabase` + `migrate`, both idempotent) and spawns `pnpm dev` itself (`EXTRACTOR=recorded`, `PUSH_ALLOW_LOOPBACK=true` set explicitly in the environment, although they are also the defaults), logging to `.local/e2e-pnpm-dev.log`, and stops the whole process group afterwards. A different `PG_DATABASE` therefore gives a fresh test database in the start-it-myself mode; with a reused stack, the stack's own database is used (the variable is only read by the helpers that create organisations, so it must match what the running stack uses).
- Readiness is checked per service until all pass (timeout 300 s): `GET /healthz` on both APIs, `/dashboard/login` on merchant-web, `/` **and `/sw.js` served as JavaScript** on the wallet (proves the PWA build, see below), and a Postgres connection as role `worker` (the worker has no port). Then the Nuxt dev pages are requested once (first request compiles them) so no test pays for compilation.
- I chose a global setup over Playwright `webServer` entries because the database must exist and be migrated *before* the services start, and `webServer` starts before `globalSetup`.

## Changes outside the tests (each needed for `pnpm dev` to be testable without manual setup)

1. **DEPARTURE: `@lr/wallet` `dev` is now `nuxt build && PORT=3001 node .output/server/index.mjs`; `nuxt dev --port 3001` moved to `dev:hmr`.** Reason: v2 §16.G requires "open a receipt link offline → Arriving", i.e. a *navigation* while offline. That works only through the service worker, and the service worker exists only in a build (`pwa.devOptions.enabled: false`, and `injectManifest` precaches the built assets; the wallet's own smoke test notes the same: the SW steps are prod-only). With `nuxt dev` the offline `page.goto` would simply fail. The build takes about 5 s (measured 4.9–5.4 s). Cost: no HMR in `pnpm dev` for the wallet; `dev:hmr` is there for UI work. README quickstart mentions it.
2. **DEPARTURE (additive): development VAPID key pair.** Without `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` the worker skips every push (`skipped: 'no_vapid'`) and buyer-api serves `publicKey: null`, so push could not work under `pnpm dev` without manual env, which the brief rules out. `@lr/config` now exports `DEV_VAPID` (a public, development-only P-256 pair, generated for this repo) and `resolveVapid(env)`: configured pair if both are set, else `DEV_VAPID` unless `NODE_ENV=production`, else `null` (push stays off in production). Used by `apps/worker/src/main.ts` and `apps/buyer-api/src/main.ts` (`VAPID_PUBLIC_KEY` alone, as before, still wins for what buyer-api serves). The same idea as the dashboard's public dev encryption key. The worker's push tests build their own context and are unaffected.
3. `PUSH_ALLOW_LOOPBACK` and `EXTRACTOR` already defaulted to `true` (outside production) and `recorded`; nothing changed. The e2e global setup still sets them explicitly when it starts the stack.

**No defect in the apps was found by the suite** (no fix was needed beyond 1 and 2, which are configuration of the dev experience, not defect fixes).

## Test design choices

- **One organisation per test** (`support/world.ts`): `connectAdmin` + `createOrg` / `createLocation` / `createMerchantUser` with a random name, KvK and owner e-mail. RLS then isolates the tests from each other and from the seed, and a test that counts archive rows sees exactly its own. TOTP is **not** pre-enrolled: the first dashboard login in each test enrols through the real UI, reading the seed from `totp-secret` and computing codes with `otpauth` (SHA-1, 6 digits, 30 s). Nothing is cleaned up afterwards: every run leaves 4 organisations "E2E Café …" in the database and a few mails in Mailpit (unique addresses `…@e2e.test`). Acceptable for a dev database; a fresh `docker compose down -v` removes them.
- **Phone = Playwright's `iPhone 13` descriptor on Chromium.** The descriptor names WebKit as its browser; only Chromium is installed (and the repo pins Playwright 1.63 to it), and `browser.newContext(...)` ignores that field, so viewport, DPR, touch, `isMobile` and the iPhone user agent are applied on Chromium. iOS/Safari behaviour itself is **not** tested.
- **Scenario 1 push**: the test starts a local HTTP "push service", generates a real P-256 key pair and 16-byte auth secret (`support/push.ts`) and registers it with `POST /v1/me/push-subscriptions` using a second buyer-api session for the same e-mail (own login code from Mailpit; the wallet keeps its own token in IndexedDB). The subscription is registered **after** the claim (the worker pushes only for claimed receipts) and **before** the till pays. The till pays directly from the presented v1, so exactly one new version (v2) exists. The test asserts: exactly one request after a further 6 s window (a duplicate from a retry or a second job would show up), `Content-Encoding: aes128gcm`, a `vapid` Authorization header, no merchant name / `Café` / `E2E` / amount / receipt id in the ciphertext (Latin-1 and UTF-8 search), and then **decrypts it per RFC 8291** with the subscription's private key and checks `{receiptId, version: 2, final: true}` and the exact key set `title, body, receiptId, version, final`.
- **`sim-pending` lags a click by up to 400 ms** (merchant-web decision doc), so "pending is 0" can be true *before* the flush starts. My first version of the journey reloaded the wallet on that and saw v1 (the server hadn't received v2 yet). Tests that need "the server has version n" now poll the dashboard archive API (`expectServerHas`: `currentVersion` and `state` of the receipt) instead; `expectOutboxDrained` is used only after the outbox was seen non-empty (3 offline sales).
- **Scenario 2 uses the real `TerminalSdk` (Node, `MemoryStore`, merchant-api over HTTP) as the till**, not the simulator page: the scenario is about the phone, and an SDK till gives two receipts quickly with known links. The simulator path is exercised by scenarios 1 and 3. The offline phase is driven by `context.setOffline(true)` after the service worker controls the page; the wallet list is loaded once online first (the list cache is written when the list is loaded, the detail cache when a detail is loaded), then offline: link → `arriving-state` with the fragment stripped, `/` shows 1 `arriving-item` plus the saved receipt, the saved receipt renders from cache (`cached-notice`), then **no reload**: `setOffline(false)` and the wallet's own `online` handler completes the claim (list shows 2 receipts, 0 arriving).
- **Scenario 3** keeps the simulator tab open while a second tab (same session) shows the archive: empty while offline, 3 `paid` rows after the toggle goes back online.
- **Scenario 4** logs in twice (enrolment, then log out and verify with a fresh code), creates a terminal with the in-browser keypair, reads the key from `terminal-key` (43 base64url chars), proves it works (`GET /v1/terminals/me` with `Authorization` + `X-Terminal-Id` → 200), dismisses it and asserts the key is in neither the DOM nor the dashboard's terminal-list API response, also after a reload, then the two-step revoke and `401` from merchant-api for the same key.
- **Login limiter.** merchant-web limits `login` and `totp` requests to 20 per IP per 5-minute fixed window per bucket (in memory, restarts reset it; verified: 20 × 401 then 429 on `/api/dashboard/totp/begin`). One suite run uses 4 `login` and 7 `totp` requests, so **more than two runs within five minutes against the same dev server trip a 429** (this is the one flake seen, see findings). A cold start resets it. `loginDashboard` now fails with the page's error text instead of timing out. I did not raise the limit (`LOGIN_RATE_LIMIT`) for the suite: that would change the stack under test.

## `scripts/journey.ts` hop 6 — left as it is

Hop 6 reads the archive and VAT report through `@lr/dashboard-core` (`searchArchive`, `getReceiptWithVersions`, `vatByDay`) on the journey's throwaway database. Making it call the merchant-web dashboard over HTTP would need a Nuxt server (build or `nuxt dev`, seconds of startup) pointed at that throwaway database (`PG_DATABASE`, role passwords), a free port, a dashboard login with TOTP enrolment, and cleanup, inside a script that is also wrapped by a vitest test (`journey.test.ts`) and the privacy canary and must stay at ~2 s without a build step. That is not robust, so I did not do it. The dashboard HTTP path (login, archive, terminals) is covered against the real stack by the Playwright scenarios 3 and 4, and by `apps/merchant-web/test/server.test.ts` (built Nitro app over HTTP).

## Not covered by this suite (stated in README as well)

- A real phone camera scanning the QR, real push delivery to a device (the worker POSTs to a local endpoint that decrypts), iOS/Safari/WebKit, the service worker's `notificationclick` (no CDP call to click a notification), PWA install, the upload/photo flow in the wallet UI, insights, settings, and the accountant/manager browser UI.

## Database connection variables (Supabase)

- **One full connection string per role plus one for the admin** (`PG_ADMIN_URL`, `MERCHANT_API_DB_URL`, `BUYER_API_DB_URL`, `WORKER_DB_URL`, `DASHBOARD_DB_URL`). When set, a URL is used verbatim, so SSL parameters and pooler usernames (`role.<project-ref>`) belong to the operator. Reason: Supabase needs SSL and role-specific usernames, which the local `PG_*` builder cannot express.
- **All five or none.** If any is set and another is missing, `adminDbUrl`/`roleDbUrl` throw and name the missing variables, so every app refuses to start. This is slightly stricter than the task asked (it also refuses a role URL without the admin URL), to avoid one role going to Supabase and another to localhost.
- With no variable set, URLs are built from `PG_*` exactly as before; local dev is unchanged.
- SSL verification is delegated to `pg`: `sslmode=verify-full&sslrootcert=/abs/path/ca.crt` verifies the chain and host. TLS verification is never disabled. (This `pg` version treats `sslmode=require` as an alias for `verify-full`, with a warning.)
- Tests never touch a hosted database: `createTestDb`, `ensureDatabase` and `dropDatabase` throw "tests run only against the local Docker Postgres" when `PG_ADMIN_URL` is set.
- The worker and the admin are warned at startup (no URL, no secrets in the message) if they point at port 6543 (transaction pooler).
- Role passwords are still set by `migrate` from the `*_DB_PASSWORD` variables, which must equal the passwords inside the URLs.

## Deferred (v2 §17)

Not built in this run, by design:

- Terraform/AWS (and the region choice for NL). Hosting is undecided; no infra or deploy config exists.
- RUNBOOK
- Passkeys
- Price-change insights
- Sales-by-hour, top-items and average-ticket reports
- `/admin` UI (leads come from `pnpm leads:report`, counts only)
- NFC: v1 stickers (NTAG 424 DNA with SUN) and the v2 pad
- Native apps (a Capacitor wrapper around the same Vue wallet)
- In-app QR scanner
- Background Sync
- Certified fiscal integrations
- Open Banking matching
- Bill splitting
- Social features
- Data products
- ERP connectors

## Postgres 17

The Supabase project runs PostgreSQL 17.11, so `docker-compose.yml` and the CI service use `postgres:17` (was 16). The full local suite was re-run on a fresh 17.11 volume. One CPU-bound test in `packages/receipt-nl` (the single-digit-corruption sweep) exceeded vitest's default 5 s limit on a loaded machine; it now has an explicit 120 s timeout. Its assertion is unchanged.
