import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createLocation,
  createTerminal,
  createUser,
  deleteLocation,
  deleteUser,
  EXPORT_KINDS,
  ForbiddenError,
  getOrganization,
  listExports,
  listLocations,
  listTerminals,
  listUsers,
  makeS3,
  PERMISSIONS,
  requestExport,
  requireRole,
  resetUserTotp,
  revokeTerminal,
  ROLE_PERMISSIONS,
  ROLES,
  salesReport,
  searchArchive,
  updateLocation,
  updateOrganization,
  updateUserRole,
  type Actor,
  type Permission,
} from '../src/index.ts';
import { generateKeyPair } from '@lr/crypto';
import { fixture, PASSWORD, userWithRole, type Fixture } from './helpers.ts';

let f: Fixture;
let owner: Actor;
let manager: Actor;
let accountant: Actor;
const boss = { send: async () => 'job-id' };
const s3 = { client: makeS3({ endpoint: 'http://127.0.0.1:9090', region: 'eu-west-1', bucket: 'receipts', accessKey: 'a', secretKey: 'b' }), bucket: 'receipts' };

beforeAll(async () => {
  f = await fixture('dc_roles');
  owner = (await userWithRole(f, 0, 'owner')).actor;
  manager = (await userWithRole(f, 0, 'manager')).actor;
  accountant = (await userWithRole(f, 0, 'accountant')).actor;
});
afterAll(() => f.close());

const denied = async (fn: () => Promise<unknown>) => {
  const e = await fn().then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ForbiddenError);
};

describe('requireRole', () => {
  it('matches the permission table', () => {
    expect(ROLES).toEqual(['owner', 'manager', 'accountant']);
    for (const p of PERMISSIONS) expect(() => requireRole({ role: 'owner' }, p)).not.toThrow();
    const writes = PERMISSIONS.filter((p) => p.endsWith('.write') || p === 'exports.create');
    // accountant: reads + exports only
    for (const p of PERMISSIONS) {
      const ok = ROLE_PERMISSIONS.accountant.includes(p);
      expect(ok).toBe(p === 'exports.create' || (p.endsWith('.read') && p !== 'users.read' && p !== 'terminals.read'));
    }
    for (const p of writes.filter((w) => w !== 'exports.create')) expect(() => requireRole({ role: 'accountant' }, p)).toThrow(ForbiddenError);
    const managerDenied = PERMISSIONS.filter((p: Permission) => !ROLE_PERMISSIONS.manager.includes(p));
    expect(managerDenied).toEqual(['org.write', 'users.read', 'users.write', 'billing.read', 'billing.write']);
  });
});

describe('server-side enforcement in every dashboard-core entry point', () => {
  const key = generateKeyPair().publicKey;

  it('accountant: reads and exports work; every write is Forbidden', async () => {
    expect((await getOrganization(f.dash.db, accountant)).kvkNumber).toBe('12345678');
    expect(await listLocations(f.dash.db, accountant)).toHaveLength(1);
    await expect(searchArchive(f.dash.db, accountant.orgId)).resolves.toEqual([]);
    await expect(salesReport(f.dash.db, accountant, { from: '2026-01-01', to: '2026-01-02' })).resolves.toBeDefined();
    await expect(requestExport(f.dash.db, boss, accountant, { kind: 'btw_csv', from: '2026-01-01', to: '2026-01-31' })).resolves.toMatchObject({ status: 'queued' });
    await expect(listExports(f.dash.db, accountant, s3)).resolves.toHaveLength(1);

    const loc = f.orgs[0]!.locationId;
    await denied(() => updateOrganization(f.dash.db, accountant, { legalName: 'x', kvkNumber: '12345678', vatNumber: null, retentionYears: 7 }));
    await denied(() => createLocation(f.dash.db, accountant, { name: 'x' }));
    await denied(() => updateLocation(f.dash.db, accountant, loc, { name: 'x' }));
    await denied(() => deleteLocation(f.dash.db, accountant, loc));
    await denied(() => listTerminals(f.dash.db, accountant));
    await denied(() => createTerminal(f.dash.db, accountant, { locationId: loc, label: 'x', publicKey: key }));
    await denied(() => revokeTerminal(f.dash.db, accountant, loc));
    await denied(() => listUsers(f.dash.db, accountant));
    await denied(() => createUser(f.dash.db, accountant, { email: 'z@example.test', password: PASSWORD, role: 'owner' }));
    await denied(() => updateUserRole(f.dash.db, accountant, accountant.userId, 'owner'));
    await denied(() => deleteUser(f.dash.db, accountant, manager.userId));
    await denied(() => resetUserTotp(f.dash.db, accountant, manager.userId));
  });

  it('manager: operations yes, organisation settings and users no', async () => {
    const loc = await createLocation(f.dash.db, manager, { name: 'Terras', postcode: '1012 ab' });
    expect(loc.postcode).toBe('1012AB');
    await updateLocation(f.dash.db, manager, loc.id, { name: 'Terras 2' });
    await expect(listTerminals(f.dash.db, manager)).resolves.toBeDefined();
    await deleteLocation(f.dash.db, manager, loc.id);
    await denied(() => updateOrganization(f.dash.db, manager, { legalName: 'x', kvkNumber: '12345678', vatNumber: null, retentionYears: 7 }));
    await denied(() => listUsers(f.dash.db, manager));
    await denied(() => createUser(f.dash.db, manager, { email: 'z@example.test', password: PASSWORD, role: 'manager' }));
  });
});

describe('organisation, users', () => {
  it('owner updates settings with format validation (KvK 8 digits, BTW-id, retention)', async () => {
    const ok = await updateOrganization(f.dash.db, owner, { legalName: 'Café Het Plein B.V.', kvkNumber: '12345678', vatNumber: 'NL123456789B01', retentionYears: 10 });
    expect(ok).toMatchObject({ legalName: 'Café Het Plein B.V.', vatNumber: 'NL123456789B01', retentionYears: 10 });
    for (const bad of [{ kvkNumber: '1234567' }, { kvkNumber: 'abcdefgh' }, { vatNumber: 'NL123456789B1' }, { vatNumber: 'DE123456789B01' }, { retentionYears: 3 }, { retentionYears: 7.5 }]) {
      await expect(updateOrganization(f.dash.db, owner, { legalName: 'x', kvkNumber: '12345678', vatNumber: null, retentionYears: 7, ...bad })).rejects.toMatchObject({ code: 'validation' });
    }
    // KvK already used by the other org
    await expect(updateOrganization(f.dash.db, owner, { legalName: 'x', kvkNumber: '87654321', vatNumber: null, retentionYears: 7 })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('owner manages users; the last owner is protected; emails are unique', async () => {
    const created = await createUser(f.dash.db, owner, { email: 'New.User@Example.test', password: PASSWORD, role: 'accountant' });
    expect(created).toMatchObject({ email: 'new.user@example.test', role: 'accountant', mfaEnrolled: false });
    await expect(createUser(f.dash.db, owner, { email: 'new.user@example.test', password: PASSWORD, role: 'manager' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(createUser(f.dash.db, owner, { email: 'short@example.test', password: 'short', role: 'manager' })).rejects.toMatchObject({ code: 'validation' });
    expect((await updateUserRole(f.dash.db, owner, created.id, 'manager')).role).toBe('manager');
    // only owner of org 0 is `owner` (others are manager/accountant): demoting or deleting them is refused
    const onlyOwner = (await listUsers(f.dash.db, owner)).filter((u) => u.role === 'owner');
    expect(onlyOwner).toHaveLength(1);
    await expect(updateUserRole(f.dash.db, owner, owner.userId, 'manager')).rejects.toMatchObject({ code: 'conflict' });
    await expect(deleteUser(f.dash.db, owner, owner.userId)).rejects.toMatchObject({ code: 'conflict' });
    await deleteUser(f.dash.db, owner, created.id);
    await expect(deleteUser(f.dash.db, owner, created.id)).rejects.toMatchObject({ code: 'not_found' });
    // never returns password or TOTP columns
    const listed = await listUsers(f.dash.db, owner);
    expect(JSON.stringify(listed)).not.toMatch(/argon2|passwordHash|totp_secret/);
  });

  it('users of one organisation cannot see or change another organisation', async () => {
    const other = (await userWithRole(f, 1, 'owner')).actor;
    const mine = await listUsers(f.dash.db, owner);
    expect(mine.map((u) => u.id)).not.toContain(other.userId);
    await expect(updateUserRole(f.dash.db, owner, other.userId, 'accountant')).rejects.toMatchObject({ code: 'not_found' });
    await expect(deleteUser(f.dash.db, owner, other.userId)).rejects.toMatchObject({ code: 'not_found' });
    await expect(resetUserTotp(f.dash.db, owner, other.userId)).rejects.toMatchObject({ code: 'not_found' });
    expect(EXPORT_KINDS).toContain('btw_csv');
  });
});
