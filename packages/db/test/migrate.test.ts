import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { adminDbUrl, DB_ROLES } from '@lr/config';
import { connect } from '../src/index.ts';
import { migrate } from '../src/migrate.ts';
import { createTestDb } from '../src/testing.ts';

describe('migrations', () => {
  it('several databases can be created and migrated at the same time (roles are cluster-wide; CREATE/ALTER ROLE must not race)', async () => {
    const dbs = await Promise.all(Array.from({ length: 5 }, () => createTestDb('mig')));
    try {
      expect(new Set(dbs.map((d) => d.name)).size).toBe(5);
      for (const d of dbs) {
        for (const role of DB_ROLES) {
          const h = connect(role, d.env, { max: 1 });
          try {
            const r = await h.pool.query('select current_user as u');
            expect(r.rows[0]?.u).toBe(role);
          } finally {
            await h.close();
          }
        }
      }
    } finally {
      await Promise.all(dbs.map((d) => d.drop()));
    }
  });

  it('migrate() is idempotent: running it again changes nothing and keeps the roles usable', async () => {
    const db = await createTestDb('mig');
    try {
      await migrate(db.env);
      const h = connect('merchant_api', db.env, { max: 1 });
      try {
        expect((await h.pool.query('select 1 as one')).rows[0]?.one).toBe(1);
      } finally {
        await h.close();
      }
    } finally {
      await db.drop();
    }
  });

  it('every application role ends with LOGIN, no superuser, no BYPASSRLS, no CREATEDB/CREATEROLE', async () => {
    const db = await createTestDb('mig');
    const admin = new pg.Client({ connectionString: adminDbUrl(db.env) });
    await admin.connect();
    try {
      const r = await admin.query('select rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = any($1) order by rolname', [[...DB_ROLES]]);
      expect(r.rows).toHaveLength(4);
      for (const row of r.rows) expect(row).toMatchObject({ rolcanlogin: true, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
    } finally {
      await admin.end();
      await db.drop();
    }
  });

  it('RLS is enabled on every merchant table', async () => {
    const db = await createTestDb('mig');
    const admin = new pg.Client({ connectionString: adminDbUrl(db.env) });
    await admin.connect();
    try {
      const r = await admin.query("select relname, relrowsecurity from pg_class where relnamespace = 'merchant'::regnamespace and relkind = 'r' order by relname");
      expect(r.rows.length).toBeGreaterThan(8);
      for (const row of r.rows) expect(row.relrowsecurity, `RLS on merchant.${row.relname}`).toBe(true);
    } finally {
      await admin.end();
      await db.drop();
    }
  });
});
