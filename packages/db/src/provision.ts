import { eq } from 'drizzle-orm';
import { generateKeyPair, generateToken, type KeyPair } from '@lr/crypto';
import type { Db } from './index.ts';
import * as t from './schema.ts';

/**
 * Admin-side provisioning (seed, tests, dashboard "create terminal"). Must run on a connection that can write
 * `merchant` tables without an org context (the admin/owner role) — the dashboard role goes through `withOrg`.
 */
export async function createOrg(
  db: Db,
  o: { legalName: string; kvkNumber: string; vatNumber?: string | null; retentionYears?: number; country?: string },
) {
  const [org] = await db
    .insert(t.organizations)
    .values({ legalName: o.legalName, kvkNumber: o.kvkNumber, vatNumber: o.vatNumber ?? null, retentionYears: o.retentionYears ?? 7, country: o.country ?? 'NL' })
    .returning();
  return org!;
}

export async function createLocation(db: Db, orgId: string, name: string, postcode = '1011AB') {
  const [loc] = await db.insert(t.locations).values({ orgId, name, postcode, address: 'Plein 1, Amsterdam' }).returning();
  return loc!;
}

export interface ProvisionedTerminal {
  terminalId: string;
  /** shown once; only sha256 is stored */
  apiKey: string;
  keys: KeyPair;
}

export async function createTerminal(
  db: Db,
  o: { orgId: string; locationId: string; label: string; keys?: KeyPair },
): Promise<ProvisionedTerminal> {
  const keys = o.keys ?? generateKeyPair();
  const { token, hash } = generateToken();
  const [term] = await db
    .insert(t.terminals)
    .values({ orgId: o.orgId, locationId: o.locationId, label: o.label, apiKeyHash: hash, signingPublicKey: keys.publicKey })
    .returning({ id: t.terminals.id });
  return { terminalId: term!.id, apiKey: token, keys };
}

export async function revokeTerminal(db: Db, terminalId: string) {
  await db.update(t.terminals).set({ revokedAt: new Date() }).where(eq(t.terminals.id, terminalId));
}
