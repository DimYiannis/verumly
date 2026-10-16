# Decisions

Every departure from `coding-agent-prompt-v2.md` ("v2") is marked **DEPARTURE**.

## Environment

- **DEPARTURE — S3 service is `adobe/s3mock`, not MinIO.** `docker pull minio/minio` and `quay.io/minio/minio` both fail on this machine (`pull access denied` / `unauthorized`; MinIO's public images have been withdrawn). `adobe/s3mock` speaks the S3 API (presigned PUT, GET, buckets) and pulls fine. The code uses `@aws-sdk/client-s3` against `S3_ENDPOINT`, so any S3 service works.
- Postgres is published on host port **5433** (not 5432) to avoid clashing with a locally installed Postgres. Mailpit on 1025/8025, S3 on 9090.

## Deferred
(see end of file; filled in as the build proceeds)

## Build & tooling

- **Services run TypeScript directly with Node 22's type stripping** (`node src/main.ts`, `erasableSyntaxOnly`); there is no emit step. `build` for libraries and services is therefore `tsc -p .` (a strict type-check) and for the Nuxt apps a real `nuxt build`. Reason: Nitro's node preset is the only deploy artefact v2 requires; adding a bundler for plain Node servers adds config with no benefit. Hosting is undecided.
- pnpm 12 blocks dependency build scripts; `allowBuilds` in `pnpm-workspace.yaml` allows `esbuild` and `better-sqlite3` only.
- `pnpm install` needs `--no-frozen-lockfile` while the dependency set is changing (frozen is the default in this pnpm).

## Database

- **DEPARTURE — pg-boss lives in schema `pgboss`, not `ops`.** `ops.audit_log` must stay append-only (INSERT only) for every role; pg-boss needs UPDATE/DELETE on its job tables, and mixing them in one schema would force per-table grants. `migrate` installs pg-boss as the admin, creates the six queues and grants the four roles on the `pgboss` schema.
- Migrations are drizzle-kit generated (`0000` tables) plus hand-written custom migrations (`0001_roles_rls`: roles, RLS, grants, SECURITY DEFINER functions). Role **passwords are not in SQL**: the runner executes `ALTER ROLE … LOGIN PASSWORD` from env after the migrations.
- RLS: policies on every `merchant` table. `merchant_api`/`dashboard` see rows where `org_id = app.org_id` (set per request in a transaction via `withOrg`). `buyer_api`/`worker` get read-only `USING (true)` policies; the worker also has write policies for the tables it maintains. The table owner (migration superuser) bypasses RLS as usual.
- Pre-auth lookups (terminal by API-key hash; dashboard user by email / session hash) happen before `org_id` is known, so they use three `SECURITY DEFINER` functions in `merchant` (`authenticate_terminal`, `find_user_for_login`, `find_dashboard_session`), executable only by the role that needs each.
- Column grants: `buyer_api`/`worker` can read `merchant.organizations(id, legal_name, kvk_number, vat_number, country)` and `merchant.locations(id, org_id, name, address, postcode)`; they have no grant at all on `terminals` or `merchant_users`, so key/password/TOTP columns are unreachable. `buyer.consents` is INSERT/SELECT only (append-only).
- `merchant.receipt_lines` is maintained by merchant-api at ingest (same transaction as the version), not by the worker. Reason: keeps archive search consistent immediately; the worker still owns rollups.
- Extra tables beyond the design doc: `merchant.dashboard_sessions`, `merchant.exports`, `ops.resolve_failures` (hourly failed-secret count, in Postgres so it holds across processes), `buyer.email_codes`.
- Receipt versions carry `org_id` (denormalised) so RLS can be a plain column check.

## Domain rules

- Rounding is **half away from zero** (symmetric), so a returned item (negative qty) rounds the mirror of the sale. v2 says "roundHalfUp"; for positive numbers they are identical.
- Return lines are `kind: item` with a **negative `qty`** (and so a negative `total`).
- `totals.net` / `totals.vat` are the sums of `vatSummary`; deposit (statiegeld) lines are outside `vatSummary`, so `net + vat` ≠ `gross` on receipts with statiegeld. `gross` is the sum of all line totals.
- A receipt's `terminal_id`/`location_id` columns come from the **authenticated terminal**, not from the payload (v2 "known open issue" 2 stays open: the payload value is not compared).
- The merchant API cannot know whether a receipt is claimed (no access to `buyer`). It therefore enqueues `notify-version` for **every version after v1**; the worker checks `buyer.claims` and does nothing for unclaimed receipts. Enqueue happens after the DB commit (not in the same transaction): a crash in between would lose a notification, never a receipt.
- `X-Signature` on POSTs is an Ed25519 signature over the **raw request body bytes**; the per-version signature over the JCS payload is checked separately.
- Idempotency: `(terminal, Idempotency-Key)` and `(receiptId, version)` are both checked. Identical content → 200 `replayed`; different content → 409 `idempotency_conflict` + audit entry. A create for an existing receipt id with another payload at v1 is the same conflict.
- Non-retryable server rejections (422, 401, 409 other than `version_gap`) move the item **and all later queued versions of that receipt** to a dead-letter table in the SDK; `version_gap` and 5xx/network errors are retried.

## Buyer API

- **Unknown receipt id → `pending`, wrong secret on an existing receipt → 404.** v1 asks for `pending` before upload and the same 404 for wrong id or wrong secret; those can't both hold, because an id that was never uploaded is indistinguishable from an unknown id. Unknown and `open` receipts both return `pending`; only a wrong secret returns 404 and counts toward the 10/hour limit.
- Sessions are opaque Bearer tokens (32 random bytes, sha256 stored, 30 days), kept in the wallet's IndexedDB/localStorage; not cookies. Soft-deleted accounts cannot sign in.
- Email codes: 6 digits, 10 min, 5 attempts, max 5 codes per email per hour; stored as sha256(email:code).
- Rate limiting: per-IP 30/min uses `@fastify/rate-limit`'s in-memory store (per process; a shared store is a deployment decision). The per-receipt failed-secret limit is in Postgres.
- The audit log records the receipt id for claims, **never the user id**, so `ops` holds no person↔receipt link.

## Journey

- Hop 6 of `pnpm test:journey` calls `@lr/dashboard-core` with the `dashboard` DB role in-process until `apps/merchant-web` exists; it is switched to HTTP against the Nuxt app in the dashboard step.
