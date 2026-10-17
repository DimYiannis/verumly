# Deploying to boxd: environment checklist

Names and meaning only. **No values live in git.** Keep the real values in a root-only file on the server (mode 600) and in your own git-ignored env files. Nothing here was run on boxd yet.

## How the apps get their settings

- The apps **do not read `.env` files**. Put each service's variables in its process environment (for systemd: an `EnvironmentFile` that only root can read; it does not expand `$`).
- Run each service on its own (for example `node apps/buyer-api/src/main.ts`). `--env-mode=loose` is only for `pnpm dev`.
- The two Nuxt apps are built once (`pnpm build`) and run from `.output/server/index.mjs`.
- Set **`NODE_ENV=production` on every service**. Without it the apps switch on development defaults (passwordless demo sign-in, the repo's public push keys, insecure cookies; ISSUES #7).

## Services

| Service | Port | Needs |
| --- | --- | --- |
| merchant-api | 4001 | database |
| buyer-api | 4002 | database, storage, email, push key |
| worker | none | database, storage, Qianfan, push keys |
| merchant-web (dashboard + simulator) | 3000 | database, storage, encryption key |
| wallet | 3001 | public addresses and push public key only |

Behind a reverse proxy keep `HOST=127.0.0.1`; use `0.0.0.0` only if boxd reaches the service over the network.

## 1. Database (every service that connects)

All five URLs are required together; a service refuses to start if one is missing, even though it only uses its own role.

| Variable | Meaning |
| --- | --- |
| `PG_ADMIN_URL` | `postgres` user, **session pooler**, port 5432. Used only by migrations and the seed. |
| `MERCHANT_API_DB_URL` | role `merchant_api`, **transaction pooler**, port 6543 |
| `BUYER_API_DB_URL` | role `buyer_api`, transaction pooler, port 6543 |
| `DASHBOARD_DB_URL` | role `dashboard`, transaction pooler, port 6543 |
| `WORKER_DB_URL` | role `worker`, **session pooler**, port 5432 (never 6543: pg-boss needs a session) |
| `PG_POOL_MAX`, `PG_BOSS_POOL_MAX` | optional; defaults 3 and 2 on a hosted database |

- Usernames are `<role>.<project-ref>`; the host is the project's pooler host (take it from Supabase's Connect dialog).
- Every URL ends with `?sslmode=verify-full&sslrootcert=/path/to/ca.crt`. **That path is on the server**: copy Supabase's CA file there (for example `/etc/less-receipts/supabase-ca.crt`) and use that path in all five URLs.
- The four `*_DB_PASSWORD` variables are needed only for `pnpm db:set-role-passwords`, never by a running service.

## 2. Storage (buyer-api, worker, merchant-web)

`S3_ENDPOINT` (Supabase: `https://<project-ref>.storage.supabase.co/storage/v1/s3`), `S3_REGION`, `S3_BUCKET` (private bucket), `S3_ACCESS_KEY`, `S3_SECRET_KEY`.
The keys bypass all row-level security: server only, never in the browser.

## 3. Per service

- **merchant-api:** `PORT`, `HOST`, `CLAIM_WINDOW_DAYS`.
- **buyer-api:**
  - `PORT`, `HOST`.
  - `RECEIPT_HOST`: the public wallet address, and the only browser origin the API accepts.
  - `DEMO_MODE=false`, `PUSH_ALLOW_LOOPBACK=false`, `POLICY_VERSION`.
  - `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`: a real email service for login codes.
  - `VAPID_PUBLIC_KEY`.
- **worker:**
  - `EXTRACTOR=http`, `QIANFAN_URL` (base address, no path), `QIANFAN_API_KEY`, `QIANFAN_REVISION`, `QIANFAN_MODEL`.
  - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` address).
  - `RECEIPT_HOST`, `LEAD_THRESHOLD`.
  - `BILLING_PROVIDER` (only on the billing branch; `demo` means no money moves).
- **merchant-web:**
  - `DASHBOARD_ENCRYPTION_KEY`: 32 random bytes, base64. Required in production.
  - `MERCHANT_API_URL`, `RECEIPT_HOST`.
  - `DEMO_MODE=false`, `DASHBOARD_COOKIE_SECURE=true`, `LOGIN_RATE_LIMIT`.
  - `BILLING_PROVIDER` (billing branch only).
- **wallet:** `NUXT_PUBLIC_BUYER_API` (public buyer-api address, called directly from the browser), `NUXT_PUBLIC_VAPID_PUBLIC_KEY`, `RECEIPT_HOST`.

The VAPID public key must be identical in buyer-api, the worker and the wallet.

## Before the first start

1. Migrate and check, from the repo with the database variables loaded, one step at a time and never while the apps run:
   ```sh
   pnpm db:migrate               # leaves role passwords alone on a hosted database
   pnpm db:set-role-passwords    # only for a new project, or to rotate
   pnpm db:seed                  # optional demo data
   pnpm check:supabase           # expect all checks PASS
   ```
2. Create the storage bucket and test a browser upload from the wallet's address (Supabase does not let you configure CORS on its S3 API; if the browser is blocked, uploads must go through buyer-api).
3. Qianfan: Colab tunnels change on every run and cannot serve a permanent deployment. Use a GPU host with a stable address.

## After the first start

- `/healthz` on buyer-api and merchant-api returns 200.
- Wallet: log in, open **Add receipt**, upload a cropped photo.
- Dashboard: sign in with password and authenticator (demo sign-in must be off).
