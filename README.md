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
docker compose up -d          # Postgres 16 (host port 5433), S3 (adobe/s3mock :9090), Mailpit (:1025 / UI :8025)
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
2. In the simulator, add items and press **Present**: a large QR appears.
3. Scan the QR with the phone's own camera. The wallet opens the receipt (pre-bill banner "Not a final receipt — this is the bill, the final receipt follows after payment").
4. Log in with the emailed code and press **Save this receipt?** → Save. The receipt is in the wallet.
5. Edit the sale in the simulator (**Add item**), then **Pay card** / **Pay cash** (cash applies 5-cent rounding). The wallet shows the new version, and in NL `paid` is final. Push is sent on each new version if you opted in.

For a phone on the same Wi-Fi, set `RECEIPT_HOST` to the laptop's LAN address over HTTPS (service workers and push need a secure context), or use a tunnel.

**Not verified by this repo's tests:** a real phone camera scanning the QR, and real push delivery to a device. Playwright covers the same flow with device emulation and a local push endpoint.

On iOS, Web Push works only after the wallet is installed to the Home Screen (iOS 16.4+); the UI says so.

## Qianfan-OCR (photos of paper receipts)

Photos and PDFs are extracted by `baidu/Qianfan-OCR`, served outside this repo.

- `EXTRACTOR=recorded` (tests, seed): reads `fixtures/receipts-nl/<sha256(bytes)>.qianfan.json`, falling back to `mock/`.
- `EXTRACTOR=http`: POSTs to `QIANFAN_URL`, an OpenAI-compatible `/v1/chat/completions` from `vllm serve baidu/Qianfan-OCR`. See `tools/qianfan/serve.md`. Batch recording of real receipts: `tools/qianfan/colab_extract.ipynb`.

Adding a real corpus (Appendix A of the spec): drop `<id>.jpg`, `<id>.truth.json` and `<sha256>.qianfan.json` into `fixtures/receipts-nl/`. No code change is needed; the corpus picker prefers real files.

## NFC later

NFC is out of scope for this MVP. The claim flow takes only `{receiptId, secret}` and never depends on how the buyer arrived, so an NFC entry point (an NTAG 424 DNA sticker with SUN authentication, or an active pad that writes each receipt's exact URL) can be added later as another way to open the same `/r/<id>#<secret>` link, plus `nfc_tags`/`tap_sessions` tables by migration.

## Privacy model in one paragraph

Four Postgres roles (`merchant_api`, `dashboard`, `buyer_api`, `worker`) with row-level security by `org_id` on every `merchant` table. `merchant_api` and `dashboard` have no access to `buyer.*` or `leads.*`. The receipt secret is generated on the terminal, only its SHA-256 is stored, and it travels in the URL **fragment**, so it never reaches a server until the wallet POSTs it in a body and strips it from the address bar. CRF has no free-text field and the terminal SDK drops loyalty-card numbers, masked card numbers and customer names before signing.

## Status

See "Handoff to reviewer" at the end of `docs/FINDINGS.md` for what works end to end, what is partial, every departure from the spec, and the exact commands to reproduce results.
