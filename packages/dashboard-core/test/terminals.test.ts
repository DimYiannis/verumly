import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPair, sha256Hex } from '@lr/crypto';
import { connect, sql, tables } from '@lr/db';
import { createTerminal, listTerminals, revokeTerminal, type Actor } from '../src/index.ts';
import { fixture, userWithRole, type Fixture } from './helpers.ts';

let f: Fixture;
let owner: Actor;
beforeAll(async () => {
  f = await fixture('dc_term');
  owner = (await userWithRole(f, 0, 'owner')).actor;
});
afterAll(() => f.close());

describe('terminals', () => {
  it('creates a terminal: key shown once, only the hash stored, public key registered, audited', async () => {
    const keys = generateKeyPair();
    const t = await createTerminal(f.dash.db, owner, { locationId: f.orgs[0]!.locationId, label: 'Kassa 1', publicKey: keys.publicKey });
    expect(t.apiKey).toHaveLength(43);
    const [row] = await f.admin.select().from(tables.terminals).where(eq(tables.terminals.id, t.terminalId));
    expect(row).toMatchObject({ apiKeyHash: sha256Hex(t.apiKey), signingPublicKey: keys.publicKey, label: 'Kassa 1', revokedAt: null });
    expect(JSON.stringify(row)).not.toContain(t.apiKey);

    // merchant-api can authenticate with it (via its SECURITY DEFINER lookup)
    const api = connect('merchant_api', f.testDb.env);
    const auth = await api.db.execute<{ id: string; revoked_at: string | null }>(sql`select * from merchant.authenticate_terminal(${sha256Hex(t.apiKey)})`);
    expect(auth.rows[0]?.id).toBe(t.terminalId);
    expect(auth.rows[0]?.revoked_at).toBeNull();

    // listing never exposes the key hash
    const list = await listTerminals(f.dash.db, owner);
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(row!.apiKeyHash);
    expect(list[0]).toMatchObject({ id: t.terminalId, signingPublicKey: keys.publicKey, locationName: 'Loc 0' });

    const audit = await f.admin.select().from(tables.auditLog).where(eq(tables.auditLog.event, 'terminal_key_created'));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ orgId: owner.orgId, terminalId: t.terminalId });
    expect(JSON.stringify(audit)).not.toContain(t.apiKey);

    // revoke: sets revoked_at, audited once, idempotent
    await revokeTerminal(f.dash.db, owner, t.terminalId);
    await revokeTerminal(f.dash.db, owner, t.terminalId);
    const after = await api.db.execute<{ revoked_at: string | null }>(sql`select * from merchant.authenticate_terminal(${sha256Hex(t.apiKey)})`);
    expect(after.rows[0]?.revoked_at).not.toBeNull();
    const revAudit = await f.admin.select().from(tables.auditLog).where(eq(tables.auditLog.event, 'terminal_key_revoked'));
    expect(revAudit).toHaveLength(1);
    expect(revAudit[0]).toMatchObject({ orgId: owner.orgId, terminalId: t.terminalId });
    await api.close();
  });

  it('validates the public key (32 bytes, base64url)', async () => {
    const loc = f.orgs[0]!.locationId;
    const bad = [
      '',
      'short',
      Buffer.alloc(31, 1).toString('base64url'),
      Buffer.alloc(33, 1).toString('base64url'),
      Buffer.alloc(32, 1).toString('base64'), // standard alphabet with padding
      `${generateKeyPair().publicKey.slice(0, 42)}=`,
    ];
    for (const publicKey of bad) await expect(createTerminal(f.dash.db, owner, { locationId: loc, label: 'x', publicKey })).rejects.toMatchObject({ code: 'validation' });
  });

  it("cannot register a terminal on another organisation's location, or revoke its terminals", async () => {
    const other = await userWithRole(f, 1, 'owner');
    const t1 = await createTerminal(f.dash.db, other.actor, { locationId: f.orgs[1]!.locationId, label: 'Other', publicKey: generateKeyPair().publicKey });
    await expect(createTerminal(f.dash.db, owner, { locationId: f.orgs[1]!.locationId, label: 'x', publicKey: generateKeyPair().publicKey })).rejects.toMatchObject({ code: 'validation' });
    await expect(revokeTerminal(f.dash.db, owner, t1.terminalId)).rejects.toMatchObject({ code: 'not_found' });
    expect((await listTerminals(f.dash.db, owner)).map((t) => t.label)).not.toContain('Other');
  });
});
