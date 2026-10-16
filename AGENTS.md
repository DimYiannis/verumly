# Less Receipts: guide for AI agents

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
packages/           schema crypto db terminal-sdk config dashboard-core receipt-nl storage ui
docs/               ARCHITECTURE, API, DECISIONS, FINDINGS, ISSUES
```

Read next, by task:

| Task | Read |
|---|---|
| Run or demo the stack | `RUNNING.md`, `README.md` |
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
