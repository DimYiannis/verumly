# Supabase: what has to change in the code

The database moves to Supabase Postgres in Frankfurt (eu-central-1); the apps are hosted on boxd. The current code only connects to the local Docker Postgres. These items need fixing before the apps can run against Supabase.

## Status

| # | State | What changed |
| --- | --- | --- |
| 1 | done, run against the project | Five connection-string variables (`packages/config`), used verbatim, SSL via URL params. Partial sets are refused. Unit-tested. `sslmode=verify-full&sslrootcert=…` also verified against a throwaway TLS Postgres (right CA connects, wrong CA rejected). Against Supabase: migrate, seed and all four app roles connected over TLS with the Supabase root CA (`prod-ca-2021.crt`). |
| 2 | done (docs) | Pooler usernames go in the URLs; documented in `RUNNING.md`. |
| 3 | done in code (guard + audit) | A warning is logged if the worker URL or the admin URL uses port 6543. Audit of the apps on 6543: no named prepared statements, no LISTEN (pg-boss `useListenNotify` defaults to false), no plain SET; every `set_config` is transaction-local (`withOrg`) and pg-boss only takes `pg_advisory_xact_lock`. The only session-level lock is the migration advisory lock, which runs on the admin URL. |
| 4 | done, run against the project | `db:migrate` skips `ensureDatabase` when `PG_ADMIN_URL` is set and uses it for the advisory lock; `createTestDb`, `ensureDatabase` and `dropDatabase` refuse. On Supabase the `postgres` user ran `0001_roles_rls.sql` (CREATE ROLE and `REVOKE ALL ON SCHEMA public FROM PUBLIC`) with no error, and a second `db:migrate` also succeeded. |
| 5 | done, run against the project | `pnpm check:supabase`: 13 of 13 PASS on Supabase (four roles `rolsuper=false`/`rolbypassrls=false`; `anon` and `authenticated` have 0 grants, no privileges and no USAGE on our schemas; `merchant_api` and `dashboard` get 42501 on `buyer.claims`; `buyer_api` can read it). Negative control run locally: a deliberate grant to `anon` turned three checks to FAIL. |
| 6 | done | `.env.supabase` in `.gitignore`; `RUNNING.md` section lists the variables. The project runs PostgreSQL 17.11, so `docker-compose.yml` and CI use `postgres:17`; the full local suite passed on 17.11. |
| 7 | open | Production settings are untouched. |

### What was observed against the real project (Frankfurt, PostgreSQL 17.11)

- **Hosts:** the project uses the session/transaction pooler host `aws-1-eu-central-1.pooler.supabase.com` (ports 5432 and 6543). The `aws-0-eu-central-1` host resolves but answers "tenant/user … not found" for this project, so the host must be taken from Supabase's Connect dialog, not guessed.
- **Direct host:** `db.<ref>.supabase.co` has only an AAAA record (IPv6) and no A record, so it is not reachable from IPv4-only networks. The session pooler works over IPv4 and is what the admin and worker URLs use.
- **Demo flow against Supabase** (`pnpm dev --env-mode=loose`, one scripted Playwright run, 19 s): dashboard login with TOTP enrolment, simulator demo terminal, Present, receipt link opens with the pre-bill banner and no fragment, wallet login and Save, Pay card, wallet detail shows version 2 final, dashboard archive lists receipts. Every step passed. Request times were 100–1200 ms per call (one extra network round trip per query, from a laptop in another country).
- **Not covered:** `pnpm test`, `test:privacy` and `test:e2e` stay local-only by design.
- The owner's TOTP secret in Supabase was reset after the scripted run, so the next dashboard login enrols a fresh authenticator.


The connection URLs have no SSL settings (`packages/config/src/index.ts:33-45`), and Supabase requires SSL.

### Follow-up: connection hygiene (after the pooler circuit breaker)

`db:migrate` no longer re-sets role passwords on a hosted database (`pnpm db:set-role-passwords` does), pool sizes are configurable with small hosted defaults, and the seed refuses to run next to the apps. See DECISIONS.md, "Hosted database: passwords, pool sizes, seed". Not yet run against Supabase, which was unreachable when this was written.
### Storage and billing on Supabase (2026-10-18)

- **Billing migration:** `0008_billing` applied to Supabase (9 migrations), role passwords left alone, `pnpm db:seed` added the demo subscription, `pnpm check:supabase` all PASS.
- **Supabase Storage as S3:** a server-side smoke test passed (presigned PUT, head, get, presigned GET, delete) against the `receipts` bucket. A real Chromium page on `http://localhost:3001` could PUT 2048 bytes to a presigned URL and GET it back (HTTP 200 both), so **CORS did not block the browser upload** and the uploads-through-buyer-api fallback is not needed for that origin. Not yet tried: a different public origin (for example the boxd wallet address), and the whole wallet flow with the worker reading from Supabase Storage.

## 2. One connection URL per service role

- The code currently builds `postgres://merchant_api:…@host/db`.
- Supabase's pooler expects usernames like `merchant_api.<project-ref>`.
- The direct connection is IPv6-only unless you buy the IPv4 add-on. **Unsure** whether that's still the case.
- The simplest fix is a full connection-string setting per role.

## 3. Connection mode per app

- The APIs and the dashboard can use the **transaction pooler**. They already scope the org setting to each transaction with `set_config(…, true)`, which is safe there.
- The **worker** and **migrations** should use a **session-mode or direct** connection: long-lived job polling, plus an advisory lock in `packages/db/src/migrate.ts:48-51`.

| App | Database role | Supabase connection |
|---|---|---|
| merchant-api | `merchant_api` | transaction pooler (port 6543) |
| buyer-api | `buyer_api` | transaction pooler (6543) |
| merchant-web (dashboard + simulator) | `dashboard` | transaction pooler (6543) |
| worker | `worker` | session pooler (5432) or direct; never transaction mode |
| migrations | admin (`postgres`) | session pooler or direct |

## 4. Migrations

- They also connect to the `postgres` maintenance database and can create databases. On Supabase there is one database, `postgres`, so `PG_DATABASE=postgres`.
- Creating the four roles needs `CREATEROLE`. I believe Supabase's `postgres` user has it; **verify on the project**.

## 5. Lock down Supabase's own access

- Supabase auto-generates a public REST API (PostgREST) with `anon` and `authenticated` roles.
- Our schemas aren't exposed by default, but turn that API off (Settings → API), or confirm those roles have no grants on `merchant`, `buyer`, `leads`, `ops` and `pgboss`.
- Otherwise the role separation has a back door.

Check in the Supabase SQL editor. The query must return 0 rows:

```sql
select grantee, table_schema, count(*)
from information_schema.role_table_grants
where grantee in ('anon','authenticated')
  and table_schema in ('merchant','buyer','leads','ops','pgboss')
group by 1, 2;
```

## 6. Postgres version

We use 16 locally, and new Supabase projects are probably on 17 (**unsure**). Match the local Docker image (`docker-compose.yml`) to Supabase's version, so tests run against the same major version.

## 7. Production settings (from the review)

- Set `NODE_ENV=production`.
- Use real VAPID keys, `DASHBOARD_ENCRYPTION_KEY` and database role passwords.
- Use a real email provider (Mailpit is local only).
- `pnpm test:privacy` uses `docker exec pg_dump`, so it only works locally.
