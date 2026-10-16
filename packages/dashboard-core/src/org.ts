import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { BTW_ID_RE, KVK_RE } from '@lr/schema';
import { tables, withOrg, type Db } from '@lr/db';
import { DashboardError, isUniqueViolation } from './errors.ts';
import { requireRole, type Actor } from './roles.ts';

export const MIN_RETENTION_YEARS = 7;
export const MAX_RETENTION_YEARS = 25;

export const orgSettingsInput = z
  .object({
    legalName: z.string().trim().min(1).max(200),
    kvkNumber: z.string().regex(KVK_RE, 'KvK number must be 8 digits'),
    vatNumber: z.string().regex(BTW_ID_RE, 'BTW-id must look like NL123456789B01').nullable(),
    retentionYears: z.number().int().min(MIN_RETENTION_YEARS).max(MAX_RETENTION_YEARS),
  })
  .strict();
export type OrgSettingsInput = z.infer<typeof orgSettingsInput>;

const orgColumns = {
  id: tables.organizations.id,
  legalName: tables.organizations.legalName,
  kvkNumber: tables.organizations.kvkNumber,
  vatNumber: tables.organizations.vatNumber,
  country: tables.organizations.country,
  retentionYears: tables.organizations.retentionYears,
};

export async function getOrganization(db: Db, actor: Actor) {
  requireRole(actor, 'org.read');
  const [org] = await withOrg(db, actor.orgId, (tx) => tx.select(orgColumns).from(tables.organizations));
  if (!org) throw new DashboardError('not_found', 'organisation not found');
  return org;
}

export async function updateOrganization(db: Db, actor: Actor, input: unknown) {
  requireRole(actor, 'org.write');
  const v = orgSettingsInput.safeParse(input);
  if (!v.success) throw new DashboardError('validation', v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  try {
    const [org] = await withOrg(db, actor.orgId, async (tx) => {
      const rows = await tx
        .update(tables.organizations)
        .set({ legalName: v.data.legalName, kvkNumber: v.data.kvkNumber, vatNumber: v.data.vatNumber, retentionYears: v.data.retentionYears })
        .where(eq(tables.organizations.id, actor.orgId))
        .returning(orgColumns);
      await tx.insert(tables.auditLog).values({ event: 'org_settings_updated', orgId: actor.orgId, detail: { userId: actor.userId } });
      return rows;
    });
    if (!org) throw new DashboardError('not_found', 'organisation not found');
    return org;
  } catch (e) {
    if (isUniqueViolation(e)) throw new DashboardError('conflict', 'KvK or BTW-id is already registered to another organisation');
    throw e;
  }
}
