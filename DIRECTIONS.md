# Directions for the build model

You are building this repo from a written spec. You did not take part in the planning, and every decision you need is written down. This file tells you how to start. The spec itself lives in `coding-agent-prompt-v2.md`.

## 1. Read, in this order

1. `coding-agent-prompt-v2.md`: the spec. Read **"Handoff notes (read first)"** before anything else, then the whole file.
2. `coding-agent-prompt.md` (v1): read only the sections that v2 marks "as in v1".
3. `Digital Receipts Platform — Technical Design.md`: read only for table columns that v2 refers to.

If these files conflict, v2 wins. Ignore anything about Italy, React/Next/Expo, NFC, Claude vision, Terraform or AWS in v1 and the design doc.

## 2. Before writing code

- Check that Docker is running: `docker info`. If it isn't, start Docker Desktop (`open -a Docker`) and wait for it.
- Check Node and pnpm: `node -v` must be ≥ 22.12, and `pnpm -v` (provided by corepack).
- Create `docs/DECISIONS.md` and `docs/FINDINGS.md` (with a **Verification log** section) straight away. Fill them in as you go, not at the end.

## 3. Build order

Follow §0 of v2:

1. **Walking skeleton.** Build the thinnest version of the receipt journey through every layer, until `pnpm test:journey` passes. Commit.
2. **Mock receipt corpus** (top of v2). Build it before the worker and the Dutch receipt tests.
3. Then lifecycle → offline queue → worker and photo extraction → wallet PWA and receipt viewer → simulator → dashboard → CI → docs.

Make one commit per step, with all tests passing, and a message naming the step. Never squash, amend published commits or force-push.

## 4. Rules that matter most

- **No buyer identifier on the merchant side**, ever. Database roles enforce it, and the privacy tests in §16.E prove it.
- **Never weaken or skip a test to make it pass.** If something can't pass, record it in `FINDINGS.md` under "Open" with the error.
- **Never invent results.** The Verification log only contains output you actually saw: the command, pass/fail and the counts.
- **Real receipt files are read-only.** You create files only in `fixtures/receipts-nl/mock/`. Any number computed from mock receipts is labelled **MOCK**.
- **Record every departure from v2 in `DECISIONS.md` with the reason.** A departure that isn't recorded counts as a defect.
- **Leave the three "Known open issues" in the Handoff notes unfixed** unless v2 is updated. Do list them.
- **Do not add hosting, infra or deploy config.** Hosting is undecided.
- **Use the version pins in the Handoff notes.** If two pinned packages don't work together, take the nearest working version and record the error.

## 5. When you get stuck

Do not stop to ask questions. Pick the conservative option, record it in `DECISIONS.md`, and continue.

The only reason to stop is a missing external prerequisite you cannot create yourself, such as Docker that won't start. In that case, write exactly what is missing and what you tried at the top of `FINDINGS.md`.

## 6. Done means

v2 §17 is met. It must have been run, not just written. In particular:

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passes from a clean clone.
- `pnpm test:journey` and `pnpm eval:extraction` pass.
- The final Playwright check (§6a) passes. It is the last thing you run.
- `docs/FINDINGS.md` has a Verification log, the receipt-format mismatches, the extraction table (MOCK-labelled), the threat list and the "Open" list.

## 6a. Final Playwright check (mandatory, run last)

After the last code change, run the full Playwright suite once more from a clean state. Earlier green runs don't count.

1. Reset: `docker compose down -v && docker compose up -d && pnpm db:migrate && pnpm db:seed`.
2. Start the apps with `pnpm dev`, then run `pnpm test:e2e` (Playwright). Use these Playwright config settings: `trace: 'on'`, `screenshot: 'on'`, `video: 'retain-on-failure'` and `reporter: [['html', { open: 'never' }], ['list']]`.
3. The run must cover every scenario in v2 §16.G:
   - buyer journey in the `iPhone 13` device context
   - buyer offline → "Arriving" → claim completes
   - merchant offline toggle → 3 sales → archive
   - dashboard TOTP → terminal key shown once → revoke
4. Commit the HTML report to `docs/e2e-report/` and one screenshot per key step to `docs/e2e-screenshots/`:
   - QR on the simulator
   - pre-bill banner on the phone
   - "Bon opslaan?" sheet
   - wallet with the receipt
   - final version after paying
   - "Arriving" state
   - dashboard archive
5. Record the exact command, the pass/fail counts and the duration in the Verification log.

If a scenario fails, fix the cause and rerun the whole suite; don't rerun only the failing test. If you can't fix it, record it under "Open" with the trace file path.

## 7. Handoff back

Your last commit must include a section at the end of `docs/FINDINGS.md` called **"Handoff to reviewer"**, containing:

- what works end to end, with the test that proves each item;
- what is partial or broken, and why;
- every departure from v2, with a link to its entry in `DECISIONS.md`;
- the exact commands a reviewer should run to reproduce your results, including the final Playwright check;
- the path to the Playwright report and screenshots.

A separate reviewer will check your work against v2, starting from the Verification log and the commit history.
