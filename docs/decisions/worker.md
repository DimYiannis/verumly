# Decisions: worker, buyer-api uploads/insights/consents/push/export/pdf/account, seed, leads report

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
  - **Matching**: org found by BTW-id **or** KvK; receipt unclaimed, state not `open`/`void`, `total_minor == parsed.gross` (the parser's gross is the sum of the lines, which is the CRF gross, not the rounded cash total), and the receipt's creation **or** latest version within ±30 minutes of the printed time; the closest wins.
  - **Leads**: only when the merchant is not a known organisation. Keyed by the parser's `merchantKey`. The lead row is locked (`for update`) while counting so concurrent uploads of different users are all counted. `needs_review` uploads count too (the key is usually fine). `status` becomes `new` at `LEAD_THRESHOLD` (default 20) distinct uploaders. A known merchant is never a lead even if no receipt matched.
- **`notify-version`**: owner's subscriptions, `web-push.generateRequestDetails` + `fetch` (plain-http test endpoints work), `aes128gcm`, VAPID from env. 404/410 delete the subscription. Other failures (5xx, network) are tried for every subscription first and then fail the job, so pg-boss retries. Duplicate protection: merchant-api enqueues only for newly stored versions (replays say `notify: false`), and every push carries a `Topic` derived from `(receiptId, version)` so a push service coalesces a retried delivery. pg-boss `singletonKey` alone is not a guarantee (it only dedupes queued/active jobs; I measured a duplicate once a job had completed).
  - Payload (encrypted): `{title, body, receiptId, version, final}`; Dutch text, merchant name only, no amounts. `final` is true when the state is final for the country (NL: `paid`) and for `void`.
  - Push is **not** gated on the `push` consent: the subscription row is the opt-in (the wallet only creates it after the user agrees). With no VAPID keys the job is skipped.
  - Nothing sensitive is logged: ids and counts only.
- **`rollup-daily`**: a receipt counts on the Amsterdam day of its **latest version** (when it became paid/void), the same basis as `vatByDay`, so the rollup and the BTW export agree. `[from,to]` (default: last 3 days, all orgs) is replaced in one transaction, so a later void stops counting. Cron every 30 minutes.
- **`export`**: kinds are the ones merchant-web already uses: `sales_csv` (one row per paid/void receipt) and `btw_csv` (accountant: BTW per day and rate, then period totals per rubriek: 21% → 1a, 9% → 1b, 0% → 1e; amounts in cents). Both use `@lr/dashboard-core` helpers (`vatByDay`, new `receiptsForExport`, `salesCsv`, `btwAccountantCsv`). Cells starting with `= + - @` are prefixed with `'` (CSV formula injection). The S3 objects are not deleted after the 24 h link expires (lifecycle rules are a deployment decision).
- **`retention`** (daily 03:30): merchant receipts older than `organizations.retention_years` (by `created_on_terminal_at`) with versions, lines, claims on them and idempotency keys; buyers deleted more than 30 days ago (S3 objects first, then the user row, which cascades; lead-uploader rows removed and counts recomputed; an `account_hard_deleted` audit entry with only a count); expired email codes and sessions; `resolve_failures` older than 1 day; `pending_upload` uploads older than 1 day. **Merchant receipts that a deleted buyer claimed stay** (they belong to the merchant). Daily rollups stay: they are aggregates and part of the bookkeeping.
- **`categorise`** (every 10 minutes): null `category` → rule table, no match → `overig` (so each line is processed once). A terminal-supplied category is never overwritten. Health lines are `sensitive`: every line at a merchant named `apotheek`/`apotheker`; at a `drogist` only lines with health keywords. Insights report sensitive lines as `overig`, so the API never reveals a health category.
- Schedules use `tz: Europe/Amsterdam`, registered by whichever worker starts (pg-boss de-duplicates schedules by name).

## Buyer API

- **Uploads are not receipts.** They never appear in `GET /v1/me/receipts`; they have their own list (`GET /v1/me/uploads`). A `done` upload counts in insights; `replaced`, `needs_review` and `failed` do not. Accept-match creates a `photo_match` claim and marks the upload `replaced`.
- `PATCH` is allowed only in `needs_review`. The corrected draft is `done` when it is complete and the lines sum exactly to the total, each line is qty × unit price ±2 cents and every non-deposit line has a BTW rate; BTW per rate is then derived from the lines. Otherwise it stays `needs_review` with the failed checks.
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
