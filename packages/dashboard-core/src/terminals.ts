import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { fromB64url, generateToken } from '@lr/crypto';
import { tables, withOrg, type Db } from '@lr/db';
import { DashboardError } from './errors.ts';
import { requireRole, type Actor } from './roles.ts';

/** A base64url Ed25519 public key: exactly 32 bytes, canonical encoding (no padding, URL alphabet). */
export const publicKeySchema = z.string().refine((s) => /^[A-Za-z0-9_-]{43}$/.test(s) && fromB64url(s).length === 32, 'public key must be 32 bytes, base64url');

export const terminalInput = z.object({ locationId: z.uuid(), label: z.string().trim().min(1).max(80), publicKey: publicKeySchema }).strict();

const cols = {
  id: tables.terminals.id,
  locationId: tables.terminals.locationId,
  label: tables.terminals.label,
  signingPublicKey: tables.terminals.signingPublicKey,
  lastSeenAt: tables.terminals.lastSeenAt,
  revokedAt: tables.terminals.revokedAt,
  createdAt: tables.terminals.createdAt,
};

export async function listTerminals(db: Db, actor: Actor) {
  requireRole(actor, 'terminals.read');
  return withOrg(db, actor.orgId, (tx) =>
    tx
      .select({ ...cols, locationName: tables.locations.name })
      .from(tables.terminals)
      .innerJoin(tables.locations, eq(tables.locations.id, tables.terminals.locationId))
      .orderBy(desc(tables.terminals.createdAt)),
  );
}

/**
 * Registers a terminal with the caller-supplied Ed25519 public key (the private key never reaches the server)
 * and generates its API key. The key is returned **once**; only sha256 is stored. Audit-logged.
 */
export async function createTerminal(db: Db, actor: Actor, input: unknown) {
  requireRole(actor, 'terminals.write');
  const v = terminalInput.safeParse(input);
  if (!v.success) throw new DashboardError('validation', v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const { token, hash } = generateToken();
  const row = await withOrg(db, actor.orgId, async (tx) => {
    // the FK alone would accept another org's location id: RLS makes the select empty for it
    const [loc] = await tx.select({ id: tables.locations.id }).from(tables.locations).where(eq(tables.locations.id, v.data.locationId));
    if (!loc) throw new DashboardError('validation', 'unknown location');
    const [t] = await tx
      .insert(tables.terminals)
      .values({ orgId: actor.orgId, locationId: v.data.locationId, label: v.data.label, apiKeyHash: hash, signingPublicKey: v.data.publicKey })
      .returning({ id: tables.terminals.id });
    await tx.insert(tables.auditLog).values({ event: 'terminal_key_created', orgId: actor.orgId, terminalId: t!.id, detail: { userId: actor.userId, label: v.data.label } });
    return t!;
  });
  return { terminalId: row.id, apiKey: token };
}

/** Sets `revoked_at`; merchant-api refuses the terminal from then on. Idempotent. Audit-logged on the first revoke. */
export async function revokeTerminal(db: Db, actor: Actor, terminalId: string): Promise<void> {
  requireRole(actor, 'terminals.write');
  await withOrg(db, actor.orgId, async (tx) => {
    const [existing] = await tx.select({ id: tables.terminals.id }).from(tables.terminals).where(eq(tables.terminals.id, terminalId));
    if (!existing) throw new DashboardError('not_found', 'terminal not found');
    const revoked = await tx
      .update(tables.terminals)
      .set({ revokedAt: new Date() })
      .where(and(eq(tables.terminals.id, terminalId), isNull(tables.terminals.revokedAt)))
      .returning({ id: tables.terminals.id });
    if (revoked.length) await tx.insert(tables.auditLog).values({ event: 'terminal_key_revoked', orgId: actor.orgId, terminalId, detail: { userId: actor.userId } });
  });
}
