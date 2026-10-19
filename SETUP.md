# Setup, configuration and technical details

What Syngrapha is and why: [README.md](README.md). Step-by-step demo with screenshots of each step: [RUNNING.md](RUNNING.md).

## 1. Quick start (local)

Requirements: Docker Desktop running, Node ≥ 22.12, pnpm via corepack (`corepack enable pnpm`; the version is pinned in `package.json`).

```sh
docker compose up -d --wait   # Postgres 17 (host port 5433), S3 mock (:9090), Mailpit (:1025, web UI :8025)
pnpm install
pnpm db:migrate               # schemas, roles, row-level security, job queues
pnpm db:seed                  # café "Café Het Plein", 200 receipts over 60 days, owner + buyer users
pnpm dev                      # all five apps
```

Every app validates its environment with Zod at startup and has local-development defaults, so no `.env` file is needed locally. Each app's `.env.example` lists its variables.

| App | URL |
|---|---|
| Merchant dashboard | http://localhost:3000/dashboard |
| POS simulator (the till) | http://localhost:3000/simulator |
| Wallet + receipt viewer | http://localhost:3001 |
| Mailpit (login codes) | http://localhost:8025 |
| Merchant API docs (OpenAPI) | http://localhost:4001/docs |
| Buyer API docs (OpenAPI) | http://localhost:4002/docs |

Seeded logins: `owner@example.test` / `owner-dev-password` (dashboard; TOTP is enrolled at first login) and `buyer@example.test` (wallet; the code arrives in Mailpit). With `DEMO_MODE` on (the default outside production) both login screens offer a one-click demo sign-in.

The wallet is built and served by `pnpm dev`, not run with `nuxt dev`, because the service worker exists only in a build. Use `pnpm --filter @lr/wallet dev:hmr` for hot reload while working on the wallet UI.

## 2. Repository layout

```
apps/
  merchant-api/   Fastify: till ingest (signed receipt versions)            :4001
  buyer-api/      Fastify: public receipt resolver + buyer API              :4002
  worker/         pg-boss jobs: photo extraction, push, rollups, export, retention, billing renewals
  merchant-web/   Nuxt: /dashboard + /simulator (POS simulator)             :3000
  wallet/         Nuxt PWA on RECEIPT_HOST: /r viewer + buyer wallet        :3001
packages/
  schema/ crypto/ db/ terminal-sdk/ config/ dashboard-core/ billing/ compliance/ storage/ ui/ receipt-pdf/
  receipt-nl/     Dutch rules: VAT math, rounding, ID formats, text parser, categories
fixtures/receipts-nl/   receipt corpus (real files, read-only) + mock/
tools/qianfan/          Colab notebooks and notes for the OCR model server
scripts/                journey, extraction eval, seed, leads report, Supabase check, live dev
docs/                   ARCHITECTURE, API, DECISIONS, FINDINGS, ISSUES, SUPABASE-CHANGES, e2e screenshots
```

More detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (components and flows), [`docs/API.md`](docs/API.md), [`docs/DECISIONS.md`](docs/DECISIONS.md) (why things are the way they are), [`docs/ISSUES.md`](docs/ISSUES.md) (known problems, open work).

## 3. Environments

| | Local | Hosted demo |
|---|---|---|
| Database | Docker Postgres 17 | Supabase Postgres 17 (Frankfurt), through its connection pooler |
| Files (photos, exports) | `adobe/s3mock` in Docker | Supabase Storage (S3 API) |
| Login codes | Mailpit in Docker | Mailpit on the server (demo), or a real SMTP service |
| Apps | `pnpm dev` | boxd machine in Germany, one HTTPS proxy per public app |
| Tests | yes, all of them | never: the test helpers refuse to run when the Supabase variables are set |

Develop and test locally; use Supabase only for the hosted demo and deliberate checks against it. Running against Supabase from a laptop: [RUNNING.md, "Run against Supabase"](RUNNING.md#run-against-supabase-instead-of-the-local-docker-postgres). The full Supabase background, including the connection incident of 2026-10-17: [`docs/SUPABASE-CHANGES.md`](docs/SUPABASE-CHANGES.md).

## 4. Configuration

Locally nothing needs to be set. For a hosted deployment these are the variables, per app (names only; values never go into the repo).

**Every app:** `NODE_ENV=production`, `LOG_LEVEL`.

**Database** (merchant-api, buyer-api, worker, merchant-web): `PG_ADMIN_URL`, `MERCHANT_API_DB_URL`, `BUYER_API_DB_URL`, `WORKER_DB_URL`, `DASHBOARD_DB_URL`. Set **all five or none**: the apps refuse to start with only some. Each URL carries its own SSL settings (`sslmode=verify-full&sslrootcert=<absolute path to the Supabase CA>`). On Supabase the APIs and the dashboard use the transaction pooler (port 6543); the worker and migrations must use the session pooler (5432). Optional: `PG_POOL_MAX`, `PG_BOSS_POOL_MAX`, `PG_ADMIN_POOL_MAX` (hosted defaults 3/2/2).

**Storage** (buyer-api, worker, merchant-web): `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`.

| App | Variables |
|---|---|
| merchant-api | `PORT` (4001), `HOST`, `CLAIM_WINDOW_DAYS` |
| buyer-api | `PORT` (4002), `HOST`, `RECEIPT_HOST` (also the only browser origin it accepts), `DEMO_MODE`, `PUSH_ALLOW_LOOPBACK=false`, `POLICY_VERSION`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `VAPID_PUBLIC_KEY` |
| worker | `EXTRACTOR` (`recorded` or `http`), `QIANFAN_URL`, `QIANFAN_API_KEY`, `QIANFAN_REVISION`, `QIANFAN_MODEL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `RECEIPT_HOST`, `LEAD_THRESHOLD`, `BILLING_PROVIDER=demo` |
| merchant-web | `PORT` (3000), `DASHBOARD_ENCRYPTION_KEY` (required in production), `MERCHANT_API_URL`, `RECEIPT_HOST`, `DEMO_MODE`, `DASHBOARD_COOKIE_SECURE=true`, `LOGIN_RATE_LIMIT`, `BILLING_PROVIDER=demo`, optional `BILLING_SIMULATE_RENEWAL` (defaults to `DEMO_MODE`) |
| wallet | `PORT` (3001), `NUXT_PUBLIC_BUYER_API`, `NUXT_PUBLIC_VAPID_PUBLIC_KEY`, `RECEIPT_HOST`; set them both at build time and at start |

Values that must be identical across apps: `RECEIPT_HOST` (buyer-api, worker, merchant-web, wallet) and the VAPID public key (buyer-api, worker, and the wallet's `NUXT_PUBLIC_VAPID_PUBLIC_KEY`).

Not needed when the URL variables are set: `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_ADMIN_USER`, `PG_ADMIN_PASSWORD` and the `*_DB_PASSWORD` values (those only set role passwords locally or with `pnpm db:set-role-passwords`).

Production behaviour hangs on `NODE_ENV=production`: without it the apps fall back to development defaults (public development keys, loopback push, demo sign-in). Set it on every hosted app.

## 5. Database and migrations

- Migrations live in `packages/db/migrations` (Drizzle). Every schema change goes through a pull request and is tested locally first.
- Applying them to Supabase is a separate, deliberate step after the merge: stop the apps, load the Supabase variables, run `pnpm db:migrate` once, then `pnpm check:supabase` once. A hosted migrate does **not** touch role passwords; `pnpm db:set-role-passwords` does that on purpose.
- `pnpm db:seed` refuses to run against a hosted database while any app is running (`--force` overrides).
- Four database roles (`merchant_api`, `buyer_api`, `worker`, `dashboard`) with row-level security by organisation on every merchant table. `pnpm check:supabase` verifies the role setup and that Supabase's own API roles cannot reach our schemas.

## 6. Photo receipts (Qianfan-OCR pipeline)

The photo text is read by **`baidu/Qianfan-OCR`**, an open 4B-parameter vision model (Apache-2.0) served with vLLM outside this repo. It is the only OCR/LLM model in the platform.

1. **Prepare the photo (in the wallet, before any upload).** The wallet finds the receipt in the frame, crops to it and caps the long side at 2000 px. It declines photos that are too small, too blurry, too dark, cut off, or contain no receipt. Declined photos are never uploaded. Accepted formats: JPEG, PNG, WEBP (PDF and HEIC are refused).
2. **Upload** straight from the browser to object storage (presigned PUT); buyer-api only records the upload.
3. **Extract (worker job `extract-upload`).** Two fixed prompts are sent to Qianfan at the same time: one returns Markdown, the other a JSON key-information answer. The output is stored with the model revision.
4. **Parse (`receipt-nl`, deterministic, no LLM).** Dutch decimals, the BTW breakdown, statiegeld, bonus lines and cash rounding become a receipt draft. The result is `done` only if every arithmetic check passes **and** the printed total and per-rate BTW agree with the line sum; otherwise it is `needs_review` and the buyer corrects it. Nothing wrong is ever marked `done` (zero-false-`done` gate, `pnpm eval:extraction`).
5. **Store and categorise.** Each line gets a category (keyword rules, then shop-name rules) and its VAT rate; the buyer can change a category. A matching official receipt is offered, and unknown shops are counted as leads.

Running it:
- `EXTRACTOR=recorded` (default for tests, seed and local dev) replays `fixtures/receipts-nl/<sha256(bytes)>.qianfan.json`, falling back to `mock/`. No GPU; it can only read the six mock images.
- `EXTRACTOR=http` posts to `<QIANFAN_URL>/v1/chat/completions` of a `vllm serve baidu/Qianfan-OCR`, with optional `QIANFAN_API_KEY` (bearer token) and `QIANFAN_REVISION`.
- Live model for a demo: run `tools/qianfan/colab_serve.ipynb` on a Colab GPU, put its values in the git-ignored `.env.qianfan`, then `pnpm dev:live`. Colab's free tier has unpublished usage limits and the tunnel address changes on every run. Details: `tools/qianfan/serve.md`, [RUNNING.md, "Photo receipts"](RUNNING.md#photo-receipts). Batch recording of real receipts: `tools/qianfan/colab_extract.ipynb`.
- Adding real receipts to the corpus: drop `<id>.jpg`, `<id>.truth.json` and `<sha256>.qianfan.json` into `fixtures/receipts-nl/`. No code change needed.

### Live check (2026-10-17)

Model revision `623bf5d2`, vLLM 0.31.0 on a Colab T4 behind a Cloudflare tunnel. Single runs, not a benchmark. Details: `docs/FINDINGS.md` and `docs/QIANFAN-LIVE-CHECK.md`.

| Input | Outcome |
| --- | --- |
| 2 synthetic (**MOCK**) receipt images | both `done`; gross, VAT per rate and shop identity equal the truth files |
| 1 real PLUS supermarket photo | `needs_review`, the right outcome: shop, date, card payment and the VAT table were read correctly, but the total came out as `664,50` (the € read as a 6), most item names were garbled and the discount line was lost |

| Input | Setup | Time to final status |
| --- | --- | --- |
| Real photo, uncropped (1512 x 1512) | before photo preparation | no result (past the 120 s timeout) |
| Same photo, prepared by the wallet (419 x 1512, 80 KB) | prompts one after the other | 100 s |
| Same photo, prepared | prompts sent together | **62 s** |
| MOCK image, already tight | one after the other / together | 51 s / **39 s** |

Known limits: only one real photo has been tried, so there is no real accuracy figure. The parser does not yet read the PLUS-style VAT table (ISSUES #26). Not tested: iOS and Safari, a real phone camera, hosted storage from a phone.

## 7. Privacy model

Receipts are stored under the merchant only; the receipt format has no buyer field and no free-text field, and the terminal SDK drops loyalty-card numbers, masked card numbers and customer names before signing. The only person ↔ receipt link is `buyer.claims`. `merchant_api` and `dashboard` have no access to `buyer.*` or `leads.*`, and row-level security limits every merchant table to the caller's organisation. The receipt secret is generated on the till, only its SHA-256 is stored, and it travels in the URL **fragment**, so it never reaches a server until the wallet POSTs it in a body and strips it from the address bar.

## 8. Checks and CI

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:journey        # the receipt journey: 6 steps over real HTTP + real Postgres
pnpm test:privacy        # canary run: no buyer data in logs, the merchant database dump or merchant responses
pnpm eval:extraction     # recorded Qianfan output through the parser (zero false "done" gate)
pnpm test:e2e            # Playwright against a dev stack it starts itself (or reuses one already running)
```

All of these run locally against Docker, and GitHub Actions runs the same list on every pull request and every push to `main`. When no real corpus exists in `fixtures/receipts-nl/`, the corpus tests fall back to `mock/` and every number from them is labelled **MOCK**.

## 9. Working on the repo

- Every change goes through a pull request into `main`; after a merge, pull `main` locally.
- Record every departure from the design in [`docs/DECISIONS.md`](docs/DECISIONS.md) and open problems in [`docs/ISSUES.md`](docs/ISSUES.md).
- Secrets live only in git-ignored files (`.env.supabase`, `.env.qianfan`, `.local/`). Never commit or paste them.
- Instructions for coding agents: [`AGENTS.md`](AGENTS.md).

## 10. Not built yet

- **NFC.** The claim flow takes only `{receiptId, secret}` and never depends on how the buyer arrived, so an NFC entry point (an NTAG 424 DNA sticker with SUN authentication, or an active pad that writes each receipt's exact URL) can be added later as another way to open the same `/r/<id>#<secret>` link.
- **Certified fiscal integration** and **real payments** (billing uses a demo payment provider; no money moves).
- The full list of known problems: [`docs/ISSUES.md`](docs/ISSUES.md).
