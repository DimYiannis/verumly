# Syngrapha: guide for AI agents

Shared by everyone working on this repo (Claude Code, Cursor, Codex, humans). Read this first, then the doc that matches your task. Claude Code also loads it through the skill in `.claude/skills/less-receipts/SKILL.md`.

## What this is

Digital receipts platform for the Netherlands (hackathon MVP). Merchants send every receipt from the till through an API. A buyer scans the QR code at the till, and the receipt opens in a free wallet PWA ("Save receipt?"). Two sides:

- **Business**: till (POS simulator) + merchant dashboard (`apps/merchant-web`).
- **User**: wallet PWA + receipt viewer (`apps/wallet`).

## The one rule that cannot break

**No buyer identifier on the merchant side, ever.** Receipts are stored under the merchant only. The only person to receipt link is `buyer.claims`. Four Postgres roles (`merchant_api`, `dashboard`, `buyer_api`, `worker`) with row-level security by `org_id` enforce it. `pnpm test:privacy` proves it. Do not add a query, column, log line or response that lets merchant-side code reach `buyer.*`. The receipt secret lives in the URL fragment, only its SHA-256 is stored, and it must never reach a log or a Referer.

## Map

```
apps/merchant-api   Fastify, terminal ingest (signed receipt versions)     :4001
apps/buyer-api      Fastify, public resolver + buyer API                    :4002
apps/worker         pg-boss jobs: extraction, push, rollups, export, retention
apps/merchant-web   Nuxt: /dashboard + /simulator                           :3000
apps/wallet         Nuxt PWA: /r viewer + buyer wallet                      :3001
packages/           schema crypto db terminal-sdk config dashboard-core receipt-nl storage ui billing
docs/               ARCHITECTURE, API, DECISIONS, FINDINGS, ISSUES
```

Read next, by task:

| Task | Read |
|---|---|
| Run or demo the stack | `RUNNING.md`, `SETUP.md` (setup, configuration, technical details) |
| Architecture, data flow | `docs/ARCHITECTURE.md` |
| Why something is the way it is | `docs/DECISIONS.md` (record every departure from the spec there) |
| Known problems, open work | `docs/ISSUES.md`, `docs/FINDINGS.md` |
| The authoritative spec | `coding-agent-prompt-v2.md` (v2 wins over v1 and the design doc) |
| HTTP contracts | `docs/API.md`, `/docs` on both APIs |

## Working rules

- **Git: one branch, commits, push and a PR per topic.** Never commit to `main`. Name branches `feat/...`, `fix/...`, `docs/...`. Keep the number of open PRs small; do not open one per tiny change.
- Never weaken or skip a test to make it pass. If something cannot pass, record it in `docs/FINDINGS.md` under "Open" with the error.
- Never invent results. Numbers computed from mock receipts are labelled **MOCK**.
- Real receipt files in `fixtures/receipts-nl/` are read-only. Create files only in `fixtures/receipts-nl/mock/`.
- Do not add hosting, infra or deploy config (hosting is undecided).
- Use the pinned versions in the spec's handoff notes.

## Commands

```sh
docker compose up -d --wait
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev                       # all apps; wallet is built then served (HMR: pnpm --filter @lr/wallet dev:hmr)
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:journey              # golden journey over real HTTP + real Postgres
pnpm test:privacy              # canary: no buyer data in logs, merchant dump or responses
pnpm test:e2e                  # Playwright, reuses a running stack
```

Every app validates its env with Zod at startup and has dev defaults, so no `.env` is needed locally.

## Dev login and demo mode

Users from `pnpm db:seed`: dashboard `owner@example.test` / `owner-dev-password`, wallet `buyer@example.test` (30 receipts already saved).

`DEMO_MODE` is on outside production unless set, and off in production. When on, both login screens are stubs: a "fill in the demo account" button fills the form, and signing in skips the TOTP code (dashboard) and the emailed code (wallet). The routes answer 404 when it is off. **The Playwright E2E starts its own stack with `DEMO_MODE=false`** so the TOTP flow stays covered. If you run E2E against a stack you started yourself, start it with `DEMO_MODE=false` too.

## Countries, legal setup and receipt templates

- `packages/compliance` (`@lr/compliance`): per-country receipt law research (31 countries: EU, UK, CH, NO, IS) as data: obligation, digital receipts, mandatory fields, fiscal system, retention, VAT, plus the settings a merchant must give. Raw research is in `docs/legal-research/*.json`; `pnpm --filter @lr/compliance build-data` regenerates `src/data/countries.json`. It is **not legal advice and not reviewed by a tax adviser**; confidence differs per country (see each entry). Do not present it as verified law.
- Business setup (`/dashboard/organisation`): the owner declares a country; the form shows that country's identity labels/patterns and legal settings, stored in `organizations.country`, `kvk_number` (= company registry number of that country) and `organizations.compliance`.
- Receipt design (`/dashboard/template`): a Canva-like editor; the template (`organizations.receipt_template`, zod `receiptTemplate` in `@lr/schema`) is drawn by `packages/ui/src/ReceiptTemplate.vue` in both the designer and the wallet. Blocks that carry legally required content (`LOCKED_BLOCK_TYPES`) cannot be removed or hidden. Static text only, inline raster logo only.
- Receipt format per country: `packages/compliance/src/formats.ts` (currency, VAT rates, cash rounding, time zone, id labels, fiscal mode) and `validateCrf(receipt, { country })` check every receipt against the organisation's country. `packages/fiscal` (`@lr/fiscal`) is the state integration: a spec per country with a fiscal step, a sandbox that makes up the fiscal data, a `gatewayIntegration` for a real provider, and the `StateIntegration` interface. `TerminalSdk` takes `country` and `fiscal` and runs `paid` -> `fiscalised` where the country needs it. Full description, how to add a country: `docs/COUNTRIES.md`. Money is integer minor units (1/100) in every currency; `merchant.kvkNumber` is the company registry number of the country (the name is historical). Rates, formats and fiscal fields are **unverified research**.

## Friends, shares and splits (buyer side only)

- Wallet tab **Friends** (`/friends`): profile (handle, display name, emoji avatar), add friends by handle or invite link, requests, balances, receipts friends shared with me, splits.
- Split a saved receipt (`/receipts/<id>/split`): equal, by item or custom amounts; friends or guests (a guest gets an invite link and takes the slot when they open it). **No payments**: shares are settled by hand, balances come from unsettled shares. The creator's own share is settled from the start.
- Share a receipt with a friend (read-only, with emoji reactions). Sharing/splitting shows the friend the items and total, so the UI asks first. Friends never see e-mail addresses.
- Backend: `apps/buyer-api/src/routes/social.ts` and `splits.ts`, math in `split-math.ts` (pure, unit tested), contract in `packages/schema/src/social.ts`, tables in the `buyer` schema (migration 0006). The merchant roles cannot reach any of it (`pnpm --filter @lr/db test` checks every buyer table).
- Demo users from `pnpm db:seed`: Sam (`buyer@example.test`, handle `sam`) and Anna (`anna@example.test`, handle `anna`), already friends, with one split. The wallet login has a button for each.

## Custom reports (business side)

- `/dashboard/reports` is a report builder: period presets, group by (day, week, month, weekday, hour, location, terminal, payment method, VAT rate, category), selectable metrics, filters (location, terminal, payment), compare with the previous period, chart + table, CSV and print. Setups can be saved as named **views** shared in the organisation (`merchant.report_views`, RLS by org, migration 0007); "Daily sales" and "VAT return" are built in.
- Engine: `packages/dashboard-core/src/report-builder.ts` (`runReport`, one SQL statement over the latest version of every `paid`/`void` receipt, Amsterdam days); contract in `packages/schema/src/reports.ts`. Grouping by payment, VAT rate or category counts parts of a receipt, so some metrics do not apply there (the API says which in `notes`).

## Billing (merchant subscriptions, demo payments)

- Merchants pay Starter (€19/month, €190/year: 1 location, 2 active terminals) or Business (€49/month, €490/year: unlimited), prices excl. 21% BTW; buyers stay free. 14-day Business trial, created lazily per organisation. **Demo payment provider only: no money moves**; never store card numbers or CVC (only a label like `Card •••• 4242`).
- Pure rules (plans, BTW, Amsterdam period math, limits, demo test cards, `PaymentProvider`) in `packages/billing`; checkout, changes, renewals, invoices and enforcement in `packages/dashboard-core/src/billing.ts`; tables `merchant.subscriptions`, `billing_mandates`, `payment_sessions`, `invoices` (migration 0008, dashboard and worker only); worker job `billing-renewals` every 15 minutes; pages `/dashboard/billing` and `/billing/checkout/<id>`.
- Billing never blocks receipt ingest or reading the archive: only adding locations and terminals is refused (402 `plan_inactive` / `plan_limit`). Test inputs and the "Simulate renewal now" button: `RUNNING.md` "Billing (demo payments)".

## UI book (implemented)

The approved designs live in the Claude Design canvas "Syngrapha UI book" (https://claude.ai/artifact/MapqD7ATs6xcnxDrbnMhLy, private to the owner). Chosen directions: wallet **Home A**, **Receipt B** (people first), **Friends B** (activity feed); the business dashboard follows the book, with the **live operations overview (Home B)** as its landing page (today's sales by hour against the usual weekday, terminals, what needs a look, top items, last receipts).

- Wallet routes: `/` is the Home (month so far, balances, recent), `/receipts` the list, `/receipts/<id>` the people-first detail, `/friends` the activity feed. Tabs: Home, Receipts, + (add), Friends, Insights; settings via the avatar.
- API for them: `GET /v1/me/home` and `GET /v1/me/activity` (apps/buyer-api/src/routes/home.ts, contract in packages/schema/src/social.ts).
- Dashboard: `/dashboard` redirects to `/dashboard/overview`; the organisation page is the business "Setup".
- Not built because the data is missing (see docs/ISSUES.md): per-week insights, scan confidence badges, reminders, terminal queue and location revenue.

- **PDFs** (the buyer's download and the merchant archive) are drawn by `packages/receipt-pdf` from the same receipt template as the wallet (blocks, order, colours, font, paper, logo). Change the template renderer and the PDF renderer together.

- **Public website** (`apps/site`, `pnpm --filter @lr/site dev`, port 3002): the landing page and the privacy explainer for Vercel (see its README). Its mini screens are hand-drawn components (`Frag*.vue`): update them when the app's screens change. It claims only what the code does; keep it that way.

## Frontend conventions (design system copied from Salespore)

- Tailwind 4 + shadcn-vue (reka-ui), icons from `@lucide/vue`, font Outfit (JetBrains Mono for amounts and technical values).
- Tokens and fonts live in `packages/ui/theme/theme.css`. Change the accent in one place (`--primary` and the `brand-*` colours). shadcn components are copied into each app at `app/components/ui` (not a shared package), so edit them per app.
- Principles: grey shell, cards with a 1px hairline and no shadow, one primary button per view, 36px controls (44px on the phone wallet), tinted status badges, sentence case, no em dashes, no exclamation marks, no emoji. The dashboard uses a sidebar shell with breadcrumb; the wallet is mobile-first with a top bar and a bottom tab bar.
- Playwright and smoke tests find elements by visible text, `data-testid`, labels and URLs. Keep those stable when restyling, and update the tests in the same change when you rename something.

## Windows notes

- Never build file paths from `new URL(...).pathname`; use `fileURLToPath`.
- Do not use inline `VAR=x cmd` in package scripts (cmd.exe cannot run it).
- Port 5433 may already be taken (another Postgres). Override the host port in an untracked `docker-compose.override.yml` and set `PG_PORT`. Turbo drops unknown env vars, so start the stack with `npx turbo run dev --env-mode=loose` when you override anything.
- Nuxt dev can bind `::1` only: probe with `localhost`, or start with `HOST=127.0.0.1`.
- The E2E helper spawns `pnpm` without a shell and fails on Windows: start the stack yourself and let E2E reuse it.
- Never kill all `node` processes; Docker Desktop and your editor share them. Kill by port or PID.

## Known gaps (also listed in `docs/ISSUES.md`)

No real receipt corpus (all accuracy numbers are MOCK). Unverified: Qianfan over HTTP, real push delivery, a real phone camera, iOS/Safari, browser-to-S3 uploads. PDF/HEIC uploads are not extracted. `merchant-web` `server.test.ts` needs a long Nitro build and can exceed its hook timeout on slow machines.
