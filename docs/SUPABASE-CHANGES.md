# Supabase: what has to change in the code

The database moves to Supabase Postgres in Frankfurt (eu-central-1); the apps are hosted on boxd. The current code only connects to the local Docker Postgres. These items need fixing before the apps can run against Supabase.

## Status

| # | State | What changed |
| --- | --- | --- |
| 1 | done in code, **not yet run against the real project** | `PG_ADMIN_URL`, `MERCHANT_API_DB_URL`, `BUYER_API_DB_URL`, `WORKER_DB_URL`, `DASHBOARD_DB_URL` (`packages/config`): used verbatim, SSL via URL params. Partial sets are refused. Unit-tested; `sslmode=verify-full&sslrootcert=…` verified against a throwaway TLS Postgres (correct CA connects with `ssl = true`; wrong CA is rejected with "unable to verify the first certificate"). |
| 2 | done (docs) | Pooler usernames go in the URLs; documented in `.env.supabase.example` and `RUNNING.md`. |
| 3 | done in code (guard + audit) | A warning is logged if the worker URL or the admin URL uses port 6543. Audit of the apps on 6543: no named prepared statements, no LISTEN (pg-boss `useListenNotify` defaults to false), no plain SET; every `set_config` is transaction-local (`withOrg`) and pg-boss only takes `pg_advisory_xact_lock`. The only session-level lock is the migration advisory lock, which runs on the admin URL. |
| 4 | partly done | `db:migrate` skips `ensureDatabase` when `PG_ADMIN_URL` is set and uses it for the advisory lock; `createTestDb`, `ensureDatabase` and `dropDatabase` refuse ("tests run only against the local Docker Postgres"). **Open: running `0001_roles_rls.sql` as the Supabase `postgres` user (CREATEROLE, `REVOKE ALL ON SCHEMA public FROM PUBLIC`) is not verified.** |
| 5 | done in code, **not yet run against the real project** | `pnpm check:supabase` (`scripts/check-supabase.ts`). Checked locally with a positive control and a negative control (a deliberate grant to `anon` turns three checks to FAIL). |
| 6 | partly done | `.env.supabase.example`, `.env.supabase` in `.gitignore`, `RUNNING.md` section. **Open:** the Supabase Postgres major version is not known yet; `docker-compose.yml` still uses 16. |
| 7 | open | Production settings are untouched. |

## 1. SSL

The connection URLs have no SSL settings (`packages/config/src/index.ts:33-45`), and Supabase requires SSL.

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
