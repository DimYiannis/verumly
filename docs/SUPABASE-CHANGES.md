# Supabase: what has to change in the code (not done yet)

The database moves to Supabase Postgres in Frankfurt (eu-central-1); the apps are hosted on boxd. The current code only connects to the local Docker Postgres. These items need fixing before the apps can run against Supabase.

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
