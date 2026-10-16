# Findings

## Open

Known open issues carried over from the v2 Handoff notes (deliberately **not** fixed):

1. `claimSecretHash` is not covered by the receipt signature.
2. The server does not check that `merchant.terminalId` / `locationId` in the receipt match the authenticated terminal.
3. It is undecided whether the claim window uses terminal time or server time. Server `received_at` is used.

## Verification log

Only output that was actually observed is recorded here.

### Step 1 — walking skeleton

| Command | Result |
| --- | --- |
| `pnpm --filter @lr/crypto test` | PASS — 17 passed, 0 failed (RFC 8032 §7.1: 5 vectors × public key/signature/verify; RFC 8785: 6 cyberphone data files; UUIDv7 bits; secrets; sign/verify) |
| `pnpm test:journey` | PASS — 6 hops (1 offline create + QR, 2 pending, 3 flush + preview, 4 Mailpit login + claim + wallet, 5 v3 paid final + 2 notify-version jobs, 6 archive + BTW 9% 680/624/56 and 21% 389/321/68) |
| `pnpm lint` | PASS — no output, exit 0 |
| `pnpm typecheck` | PASS — 14 tasks successful |
| `pnpm test` | PASS — 14 tasks successful (only `@lr/crypto` has tests at this step) |
