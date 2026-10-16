import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { cleanSettings, getCountry, normaliseVatId, validateSetup, type ComplianceSettings } from '@lr/compliance';
import { receiptTemplate } from '@lr/schema';
import { tables, withOrg, type Db } from '@lr/db';
import { DashboardError, isUniqueViolation } from './errors.ts';
import { requireRole, type Actor } from './roles.ts';

export const MIN_RETENTION_YEARS = 7;
export const MAX_RETENTION_YEARS = 25;

/**
 * `kvkNumber` is the company registry number of the declared country (KvK, SIRET, Handelsregister number, ...):
 * the column and the API field keep their original name. `country` defaults to NL so existing callers keep working.
 */
export const orgSettingsInput = z
  .object({
    legalName: z.string().trim().min(1).max(200),
    country: z.string().length(2).default('NL'),
    kvkNumber: z.string().trim().min(1).max(40),
    vatNumber: z.string().trim().max(20).nullable(),
    retentionYears: z.number().int().min(1).max(MAX_RETENTION_YEARS),
    /** values of the country's legal settings (see @lr/compliance), by key */
    compliance: z.record(z.string(), z.union([z.string().max(200), z.boolean()])).default({}),
    /** the owner has read the legal summary of the country */
    confirmLegal: z.boolean().default(false),
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
  compliance: tables.organizations.compliance,
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
  const country = getCountry(v.data.country);
  if (!country) throw new DashboardError('validation', `country: unknown country ${v.data.country}`);
  if (v.data.retentionYears < Math.min(MIN_RETENTION_YEARS, country.retentionYearsIndicative)) {
    throw new DashboardError('validation', `retentionYears: at least ${Math.min(MIN_RETENTION_YEARS, country.retentionYearsIndicative)} years`);
  }
  const vat = v.data.vatNumber ? normaliseVatId(v.data.vatNumber) : null;
  const values = cleanSettings(country.code, v.data.compliance);
  const problems = validateSetup(country.code, { companyId: v.data.kvkNumber, vatId: vat }, values);
  if (problems.length) throw new DashboardError('validation', problems.join('; '));
  try {
    const [org] = await withOrg(db, actor.orgId, async (tx) => {
      const [prev] = await tx.select({ compliance: tables.organizations.compliance }).from(tables.organizations);
      const previous = (prev?.compliance ?? {}) as Partial<ComplianceSettings>;
      const compliance: ComplianceSettings = {
        country: country.code,
        values,
        confirmedAt: v.data.confirmLegal ? new Date().toISOString() : previous.country === country.code ? (previous.confirmedAt ?? null) : null,
      };
      const rows = await tx
        .update(tables.organizations)
        .set({ legalName: v.data.legalName, country: country.code, kvkNumber: v.data.kvkNumber, vatNumber: vat, retentionYears: v.data.retentionYears, compliance })
        .where(eq(tables.organizations.id, actor.orgId))
        .returning(orgColumns);
      await tx.insert(tables.auditLog).values({ event: 'org_settings_updated', orgId: actor.orgId, detail: { userId: actor.userId, country: country.code } });
      return rows;
    });
    if (!org) throw new DashboardError('not_found', 'organisation not found');
    return org;
  } catch (e) {
    if (isUniqueViolation(e)) throw new DashboardError('conflict', 'KvK or BTW-id is already registered to another organisation');
    throw e;
  }
}

/** The receipt layout the merchant drew in the designer, or null when it still uses the default. */
export async function getReceiptTemplate(db: Db, actor: Actor) {
  requireRole(actor, 'org.read');
  const [row] = await withOrg(db, actor.orgId, (tx) => tx.select({ template: tables.organizations.receiptTemplate }).from(tables.organizations));
  if (!row) throw new DashboardError('not_found', 'organisation not found');
  return row.template ?? null;
}

export async function updateReceiptTemplate(db: Db, actor: Actor, input: unknown) {
  requireRole(actor, 'org.write');
  const v = receiptTemplate.safeParse(input);
  if (!v.success) throw new DashboardError('validation', v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  await withOrg(db, actor.orgId, async (tx) => {
    await tx.update(tables.organizations).set({ receiptTemplate: v.data }).where(eq(tables.organizations.id, actor.orgId));
    await tx.insert(tables.auditLog).values({ event: 'receipt_template_updated', orgId: actor.orgId, detail: { userId: actor.userId } });
  });
  return v.data;
}

export async function resetReceiptTemplate(db: Db, actor: Actor) {
  requireRole(actor, 'org.write');
  await withOrg(db, actor.orgId, async (tx) => {
    await tx.update(tables.organizations).set({ receiptTemplate: null }).where(eq(tables.organizations.id, actor.orgId));
    await tx.insert(tables.auditLog).values({ event: 'receipt_template_reset', orgId: actor.orgId, detail: { userId: actor.userId } });
  });
}
