import { hashPassword } from './password.ts';
import { ROLES, type Role } from './roles.ts';
import { tables, type Db } from '@lr/db';

/**
 * Admin-connection helper (seed, tests, onboarding scripts): creates a merchant dashboard user without an org
 * context. The dashboard role itself uses `createUser` (owner-only, via `withOrg`).
 */
export async function createMerchantUser(
  adminDb: Db,
  o: { orgId: string; email: string; password: string; role: Role },
): Promise<{ id: string; email: string; role: Role }> {
  if (!ROLES.includes(o.role)) throw new Error(`unknown role: ${o.role}`);
  const [row] = await adminDb
    .insert(tables.merchantUsers)
    .values({ orgId: o.orgId, email: o.email.trim().toLowerCase(), passwordHash: await hashPassword(o.password), role: o.role })
    .returning({ id: tables.merchantUsers.id, email: tables.merchantUsers.email });
  return { id: row!.id, email: row!.email, role: o.role };
}
