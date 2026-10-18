---
name: less-receipts
description: Project knowledge for the Less Receipts hackathon repo (digital receipts platform for the Netherlands: merchant dashboard + POS simulator + buyer wallet PWA). Use whenever working in this repo, or when asked about receipts, the wallet, the merchant dashboard, the till simulator, the buyer/merchant API, privacy roles, demo login, or the shared design system. Read it before answering architecture or workflow questions.
---

# Less Receipts

The full, current guide is `AGENTS.md` at the repo root. Read it first; it is shared with the other agents and people on the team and is the single source of truth. This skill only tells you how to use it.

## How to approach a task

1. Read `AGENTS.md` (map, the privacy rule, working rules, commands, dev login, frontend conventions, Windows notes).
2. Open the doc that matches the task:
   - run or demo: `RUNNING.md`
   - architecture: `docs/ARCHITECTURE.md`
   - receipts per country and the state (fiscal) integration: `docs/COUNTRIES.md`
   - why a choice was made: `docs/DECISIONS.md`
   - open problems: `docs/ISSUES.md`, `docs/FINDINGS.md`
   - the spec: `coding-agent-prompt-v2.md`
3. Work on a dedicated branch, commit, push and open one PR for the topic. Never commit to `main`.
4. Before saying a change works: `pnpm typecheck`, the tests of the touched package, and `pnpm test:e2e` for anything the UI flow depends on.

## Non-negotiables

- No buyer identifier on the merchant side. Run `pnpm test:privacy` after touching db, auth, logging or API responses.
- Do not weaken tests. Record what cannot pass in `docs/FINDINGS.md`.
- Keep selectors (visible text, `data-testid`, labels, URLs) stable, or update the Playwright specs together with the UI.
- Dev login stubs only work with `DEMO_MODE`; E2E runs with `DEMO_MODE=false`.

## Keeping this alive

When you learn something a teammate or the next agent would otherwise rediscover (a gotcha, a decision, a command that is easy to get wrong), add it to `AGENTS.md` in the same PR. Keep that file short; link to the longer docs instead of copying them.
