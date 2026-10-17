# Less Receipts — digital receipts platform (Netherlands MVP)

Merchants send every kassabon to the platform through an API. Receipts are stored under the **merchant's identity only**; a receipt never carries a buyer identifier. Buyers scan the QR code at the till with their phone camera, which opens the receipt in a free wallet PWA ("Save this receipt?"). The only person ↔ receipt link is `buyer.claims`, and Postgres roles stop every merchant-side service from reading it.

Spec: `coding-agent-prompt-v2.md` (authoritative). Choices and departures: `docs/DECISIONS.md`. Evidence and open issues: `docs/FINDINGS.md`.

## Layout

```
apps/
  merchant-api/   Fastify: terminal ingest (signed receipt versions)        :4001
  buyer-api/      Fastify: public resolver + buyer API                      :4002
  worker/         pg-boss jobs: extraction, push, rollups, export, retention
  merchant-web/   Nuxt: /dashboard + /simulator (POS simulator)             :3000
  wallet/         Nuxt PWA on RECEIPT_HOST: /r viewer + buyer wallet        :3001
packages/
  schema/ crypto/ db/ terminal-sdk/ config/ dashboard-core/
  receipt-nl/     Dutch rules: VAT math, rounding, ID formats, text parser
fixtures/receipts-nl/   corpus (real files, read-only to the build) + mock/
scripts/                journey, extraction eval, seed, leads report
docs/                   DECISIONS, FINDINGS, ARCHITECTURE, API
```

## Quickstart

Requirements: Docker Desktop running, Node ≥ 22.12, pnpm (via corepack; see `packageManager`).

```sh
docker compose up -d          # Postgres 17 (host port 5433), S3 (adobe/s3mock :9090), Mailpit (:1025 / UI :8025)
pnpm install
pnpm db:migrate               # schemas, roles, row-level security, pg-boss queues
pnpm db:seed                  # org "Café Het Plein", 200 receipts over 60 days, buyer + owner users
pnpm dev                      # all apps (the wallet is built and served, not nuxt dev: the service worker only exists in a build; `pnpm --filter @lr/wallet dev:hmr` for HMR)
```

Every app validates its environment with Zod at startup and has local-dev defaults, so no `.env` is needed locally. `.env.example` in each app lists the variables.

Seeded logins: `owner@example.test` (dashboard, TOTP enrolled on first login) and `buyer@example.test` (wallet; the email code arrives in Mailpit at http://localhost:8025).

### Checks

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:journey             # golden journey: 6 hops over real HTTP + real Postgres
pnpm test:privacy             # canary run: no buyer data in logs, merchant dump or responses
pnpm eval:extraction          # recorded Qianfan output through the parser (zero false "done" gate)
pnpm test:e2e                 # Playwright E2E against pnpm dev (reuses a running stack, else starts it); pnpm e2e:report copies the HTML report to docs/e2e-report
```

When no real corpus exists in `fixtures/receipts-nl/`, the corpus tests and eval fall back to `fixtures/receipts-nl/mock/` and print `MOCK CORPUS — not a real accuracy measurement`. Every number computed from mock receipts is labelled **MOCK**.

## Phone demo

1. Log into the dashboard (http://localhost:3000/dashboard), set up a demo terminal, open `/simulator` on the laptop.
2. In the simulator, add items and press **Issue receipt**: a large QR appears (an issued receipt is taken as paid).
3. Scan the QR with the phone's own camera. The wallet opens the receipt.
4. Log in (demo mode: **Fill in the demo account**, **Sign in**) and press **Save this receipt?** → Save. The receipt is in the wallet.
5. Press **Void** in the simulator. The wallet shows the new version. Push is sent on each new version if you opted in.

For a phone on the same Wi-Fi, set `RECEIPT_HOST` to the laptop's LAN address over HTTPS (service workers and push need a secure context), or use a tunnel.

**Not verified by this repo's tests:** a real phone camera scanning the QR, and real push delivery to a device. Playwright covers the same flow with device emulation and a local push endpoint.

On iOS, Web Push works only after the wallet is installed to the Home Screen (iOS 16.4+); the UI says so.

## Photo receipts (Qianfan-OCR pipeline)

A buyer can photograph a paper receipt in the wallet (**Add receipt**). The text is read by **`baidu/Qianfan-OCR`**, an open 4B-parameter vision model (Apache-2.0) that we serve with vLLM outside this repo. It is the only OCR/LLM model in the platform; there is no other vendor.

### The pipeline

1. **Prepare the photo (in the wallet, before any upload).** The wallet finds the receipt in the frame, crops to it and caps the long side at 2000 px. It declines photos that are too small, too blurry, too dark, cut off at the sides, or that contain no receipt, and asks for a clearer one. Declined photos are never uploaded. Accepted formats: JPEG, PNG, WEBP (PDF and HEIC are refused).
2. **Upload** straight from the browser to object storage (presigned PUT); buyer-api only records the upload.
3. **Extract (worker job `extract-upload`).** The worker sends the image to Qianfan twice, with two fixed prompts (the two requests run at the same time): one returns Markdown, the other a JSON key-information answer. Output is stored with the model revision.
4. **Parse (`receipt-nl`, deterministic, no LLM).** Dutch decimals, BTW breakdown, statiegeld, bonus lines and cash rounding become a receipt draft. The result is `done` only if every arithmetic check passes **and** the printed total and per-rate BTW agree with the line sum. Otherwise it is `needs_review` and the buyer corrects it. Nothing wrong is ever marked `done` (zero-false-`done` gate, `pnpm eval:extraction`).
5. **Store and categorise.** Each line gets a category (keyword rules, then shop-name rules) and its VAT rate; the buyer can change a category. A matching official receipt (same KvK or BTW-id and the same total within 30 minutes) is offered, and unknown shops are counted as leads.

### Run it

- `EXTRACTOR=recorded` (default for tests, seed and local dev): replays `fixtures/receipts-nl/<sha256(bytes)>.qianfan.json`, falling back to `mock/`. No GPU. It can only read the six mock receipt images.
- `EXTRACTOR=http`: POSTs to `<QIANFAN_URL>/v1/chat/completions` of a `vllm serve baidu/Qianfan-OCR`. `QIANFAN_URL` is the server base URL; optional `QIANFAN_API_KEY` (bearer token, matches `vllm serve --api-key`) and `QIANFAN_REVISION` (recorded as `modelRevision`).
- Live model for a demo: run `tools/qianfan/colab_serve.ipynb` on a Colab T4, put its values in the git-ignored `.env.qianfan`, then `pnpm dev:live` (setup and troubleshooting in `tools/qianfan/serve.md`; step by step in `RUNNING.md`, "Photo receipts"). Batch recording of real receipts: `tools/qianfan/colab_extract.ipynb`.
- Adding a real corpus (Appendix A of the spec): drop `<id>.jpg`, `<id>.truth.json` and `<sha256>.qianfan.json` into `fixtures/receipts-nl/`. No code change is needed; the corpus picker prefers real files.

### Results of the live check (2026-10-17)

Model `baidu/Qianfan-OCR` revision `623bf5d2`, vLLM 0.31.0 on a Google Colab **T4**, reached through a Cloudflare tunnel. Single runs, not a benchmark. Details and the open issues: `docs/FINDINGS.md` ("Live Qianfan check", "Live timing after photo preparation") and `docs/QIANFAN-LIVE-CHECK.md`.

**Accuracy.** The correct value is the printed one.

| Input | Outcome |
| --- | --- |
| 2 synthetic (**MOCK**) receipt images | both `done`; gross, VAT per rate and shop identity equal the truth files (supermarkt 1973, VAT 9% 68 / 21% 190; café 4380, VAT 9% 150 / 21% 444) |
| 1 real PLUS supermarket photo | `needs_review`, the right outcome: shop, date, card payment and the whole VAT table were read correctly, but the total came out as `664,50` in one answer (the € read as a 6), most item names were garbled and the discount line was lost |

**Speed** (choosing the file to a final status, on a shared T4):

| Input | Setup | Time |
| --- | --- | --- |
| Real photo, uncropped (1512 x 1512) | before preparation | no result (past the 120 s timeout) |
| Same photo, prepared by the wallet (419 x 1512, 80 KB) | requests one after the other | 100 s |
| Same photo, prepared | the two requests sent together | **62 s** |
| MOCK image, already tight | one after the other / together | 51 s / **39 s** |

Cropping turned a photo that never finished into a result, and sending the two prompts together cut about 40% of the wait.

**Known limits.** Only one real photo has been tried, so there is no real accuracy figure; the mock numbers are labelled **MOCK** and prove only that the pipeline works. The parser does not yet read the PLUS-style VAT table (ISSUES #26). The photo checks have little margin on soft thermal prints (one real photo). A model that always times out can leave the buyer on "Reading" for up to about 16 minutes before the upload fails. Not tested: iOS and Safari, a real phone camera, PDF and HEIC, hosted storage.

## NFC later

NFC is out of scope for this MVP. The claim flow takes only `{receiptId, secret}` and never depends on how the buyer arrived, so an NFC entry point (an NTAG 424 DNA sticker with SUN authentication, or an active pad that writes each receipt's exact URL) can be added later as another way to open the same `/r/<id>#<secret>` link, plus `nfc_tags`/`tap_sessions` tables by migration.

## Privacy model in one paragraph

Four Postgres roles (`merchant_api`, `dashboard`, `buyer_api`, `worker`) with row-level security by `org_id` on every `merchant` table. `merchant_api` and `dashboard` have no access to `buyer.*` or `leads.*`. The receipt secret is generated on the terminal, only its SHA-256 is stored, and it travels in the URL **fragment**, so it never reaches a server until the wallet POSTs it in a body and strips it from the address bar. CRF has no free-text field and the terminal SDK drops loyalty-card numbers, masked card numbers and customer names before signing.

## Status

See "Handoff to reviewer" at the end of `docs/FINDINGS.md` for what works end to end, what is partial, every departure from the spec, and the exact commands to reproduce results.
