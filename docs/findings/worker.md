# Findings: worker, buyer-api uploads/insights/consents/push/export/pdf/account, seed, leads report

All commands run from the repo root against the docker-compose Postgres (5433), Mailpit and the S3 mock (`adobe/s3mock`). Counts are copied from the output. Numbers computed from the corpus are **MOCK**: the corpus used was the mock one (6 receipts).

## Verification log

| Command | Result | Counts |
|---|---|---|
| `pnpm --filter @lr/worker test` | PASS | 8 files, 56 tests (extract-upload 10, notify-version 8, seed-export-rollup 6, leads 6, extractor 5, categorise 15, retention 3, worker-loop 3) |
| `pnpm --filter @lr/buyer-api test` | PASS | 7 files, 61 tests (mine: consents-push 9, account-export-pdf 4, insights 3, uploads-api 8; the other 3 files are IntegrationTests') |
| `pnpm --filter @lr/worker typecheck` | PASS | exit 0 |
| `pnpm --filter @lr/buyer-api typecheck` | PASS | exit 0 |
| `pnpm --filter @lr/storage typecheck` / `@lr/db` / `@lr/schema` / `@lr/dashboard-core` / `@lr/receipt-nl` | PASS | exit 0 each |
| `pnpm lint` | PASS | no output after `eslint .` |
| `pnpm test:journey` | PASS | 6 hops, "Journey passed" |
| `pnpm db:migrate` (dev DB; applies 0003, 0004) | PASS | "migrated receipts" |
| `pnpm db:seed` (dev DB, first run) | PASS | 200 receipts (+1 official), 30 claims, 3 uploads, 2 terminals, owner + buyer |
| `pnpm db:seed` (twice more) | PASS | "0 receipts, 0 claims, 0 uploads, 0 terminals created" both times |
| `PG_DATABASE=seedcheck pnpm db:migrate && pnpm db:seed` ×2 on a fresh database, then `drop database` | PASS | first run 201 receipts, 30 claims, 3 uploads, 2 terminals; second run created 0; query counts afterwards: receipts 201, versions 239, claims 30, uploads 3, rollups 59, uncategorised lines 0, leads 2 |
| `pnpm leads:report` | PASS | after the smoke uploads: 3 merchants, status collecting 3, 4 pairs, histogram `1-4: 3` |
| Smoke: `node apps/buyer-api/src/main.ts` (port 4012) + `node apps/worker/src/main.ts` against the dev DB, real Mailpit login, real S3 PUT of `mock-supermarkt-statiegeld-bonus.png` and `mock-horeca-gemengd.png` | PASS | first: `complete` 202 → `done`, gross 1973, "Supermarkt De Hoek"; second: → `needs_review`, failures `["gross_sum"]` (the planted digit error). Worker log lines show `extract_done` with ids and counts only. |

### What the tests prove (all against real Postgres + S3 + Mailpit where relevant)

- **Upload → done** (presign, real PUT to S3, `complete`, `extract-upload`, status endpoint with draft); **needs_review → PATCH → done**; another user gets 404 on read/complete/patch; `complete` before the PUT is 409; a file over 10 MB is deleted and the upload fails `bad_size`; unknown media/oversize requests are 400; no recording → `failed: no_recorded_extraction`; transient error rethrown, final attempt → `failed: extractor_unavailable`.
- **Match → accept-match**: same KvK/BTW-id, same gross, within ±30 min, unclaimed → `matched_receipt_id`; accept-match creates a `photo_match` claim, the upload becomes `replaced`, accepting again is idempotent. No match for wrong gross (±1 cent), 31 minutes either side, `open` receipts, or a receipt someone else claimed (409 on accept). A total corrected by the buyer can create the match.
- **Leads**: keyed by `kvk:` when the BTW-id is missing, `vat:` otherwise; the same user twice counts once; the second distinct user reaches `LEAD_THRESHOLD=2` → `new`; a known organisation (by BTW-id, or by KvK only) is never a lead; 6 concurrent uploaders are all counted; `leads:report` prints no names, keys, postcodes or user ids.
- **Retention**: deleting an account → 204, all sessions and subscriptions gone at once, sign-in refused, audit entry without the user id; day 29 nothing hard-deleted; day 31 user, claims, uploads, consents, email codes, the S3 object and lead-uploader rows are gone and the lead count recomputed, **merchant receipts and their versions remain**, other users untouched. Receipts past `retention_years` (1 vs 7) are deleted with versions, lines, claims and idempotency keys; newer ones stay. Expired codes/sessions, old `resolve_failures` and abandoned uploads are pruned, fresh rows stay.
- **Export matches the seed, recomputed independently**: the test runs the real seed on a fresh database, then computes BTW per Amsterdam day and rate from the seed plan with its own arithmetic (no `@lr` code; round-half-up per receipt and rate) and compares it to the `btw_csv` the `export` job uploaded to S3 and the test fetched through the 24 h link: every day row (rubriek 1a/1b, gross/net/vat/receipts) and the period totals agree to the cent; void and presented receipts are absent. The `sales_csv` has one row per paid/void receipt and its gross and rounding totals match. `daily_rollups` equal the oracle per day (gross, BTW per rate, paid count, void count) and re-running replaces rows.
- **notify-version**: exactly one request per version per subscription to a local HTTP push endpoint; headers `content-encoding: aes128gcm`, `authorization: vapid t=…, k=<public key>`, `ttl`, a per-version `topic`; the body has no readable receipt text and **decrypts with the browser-side private key** (RFC 8291 implemented in the test) to `{title, body, receiptId, version, final}`; v2 says "nog niet definitief" (`final:false`), v3 `paid` says definitief (`final:true`); void says vervallen. 410 and 404 delete only that subscription; 503 keeps it and fails the job; only the owner's subscriptions are used; no claim → nothing; no VAPID → skipped; logs contain no endpoint, key or text. The pg-boss loop test shows a job sent by `merchant_api` is delivered as one push.
- **Categoriser**: 12 keyword cases, apotheek vs drogist rules, table consistency; the job fills null categories, keeps the terminal's, flags health lines, and a second run changes 0 lines.
- **Extractor**: HTTP extractor against a stub OpenAI-compatible server sends both fixed prompts with `temperature 0` and a base64 data URL, takes the revision from the response; 4xx permanent, 5xx retryable, PDF and unknown bytes refused with a code; recorded extractor reads `<sha>.qianfan.json` and falls back to `mock/`.
- **Buyer REST**: consents (defaults off, append-only with policy version, change-only rows, the DB role cannot UPDATE/DELETE), push subscriptions (create/upsert/move/delete/limits/endpoint rules incl. production mode), insights (hand-computed months, categories, top merchants; pre-bill, void, other users excluded; health line shown as `overig`; upload counted), export (no other user's data, no keys/hashes/secrets), PDF (`%PDF-`…`%%EOF`, 404 for others), delete account, upload guards (503 without storage, 429 at 50/hour, strict bodies), body-less JSON POST.

## Open

- **PDF uploads are accepted but not extracted by the `http` extractor.** vLLM's chat endpoint takes images; rasterising PDF pages is not implemented, so the upload fails with `pdf_unsupported`. (`recorded` works for any file with a recording.) The same applies to `image/heic` (`unsupported_file`); iOS normally converts to JPEG for a file input.
- **The `http` extractor was only exercised against a stub server**, not a real `baidu/Qianfan-OCR` endpoint (none was available). Real accuracy on real receipts is still unmeasured (see corpus findings).
- **Real push delivery is unverified**: pushes were received by a local HTTP endpoint and decrypted with the right key, not by FCM/APNs/Mozilla. Behaviour of real push services (e.g. their handling of the `Topic` header) is untested.
- **Browser PUT to S3 is untested** and the bucket needs a CORS rule for `RECEIPT_HOST`; the S3 mock does not enforce the signed `Content-Length`, so the real-S3 size enforcement is only covered by the `complete` size check.
- Export files stay in S3 after the 24 h link expires (needs a lifecycle rule, a deployment decision). Daily rollups are kept after their receipts are deleted by retention.
- **Accept-match is a claim without the secret.** An attacker who photographs (or fabricates) a receipt of a merchant whose KvK/BTW-id they know, with the right total and time, can claim an unclaimed official receipt. It is the design in v2 §11; the exposure is limited to receipts that are unclaimed, in the 30-minute window and have exactly that total. Not covered by a test of abuse; a candidate for the threat list.
- No per-process upload throttle on the presign endpoint beyond the 50/hour database count; `@fastify/rate-limit` is per process (as documented for the buyer API).
- The three "Known open issues" in v2 are untouched.
