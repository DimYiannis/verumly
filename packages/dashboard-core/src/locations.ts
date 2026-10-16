import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { tables, withOrg, type Db } from '@lr/db';
import { DashboardError, isForeignKeyViolation } from './errors.ts';
import { requireRole, type Actor } from './roles.ts';

export const locationInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    address: z.string().trim().max(200).nullable().default(null),
    postcode: z
      .string()
      .trim()
      .regex(/^\d{4}\s?[A-Za-z]{2}$/, 'postcode must look like 1011AB')
      .nullable()
      .default(null),
  })
  .strict();

const cols = { id: tables.locations.id, name: tables.locations.name, address: tables.locations.address, postcode: tables.locations.postcode };

function parse(input: unknown) {
  const v = locationInput.safeParse(input);
  if (!v.success) throw new DashboardError('validation', v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return { ...v.data, postcode: v.data.postcode?.replace(/\s/g, '').toUpperCase() ?? null };
}

export async function listLocations(db: Db, actor: Actor) {
  requireRole(actor, 'locations.read');
  return withOrg(db, actor.orgId, (tx) => tx.select(cols).from(tables.locations).orderBy(asc(tables.locations.name)));
}

export async function createLocation(db: Db, actor: Actor, input: unknown) {
  requireRole(actor, 'locations.write');
  const v = parse(input);
  const [row] = await withOrg(db, actor.orgId, (tx) => tx.insert(tables.locations).values({ ...v, orgId: actor.orgId }).returning(cols));
  return row!;
}

export async function updateLocation(db: Db, actor: Actor, id: string, input: unknown) {
  requireRole(actor, 'locations.write');
  const v = parse(input);
  const [row] = await withOrg(db, actor.orgId, (tx) => tx.update(tables.locations).set(v).where(eq(tables.locations.id, id)).returning(cols));
  if (!row) throw new DashboardError('not_found', 'location not found');
  return row;
}

/** Deleting a location that still has terminals or receipts is refused (receipts are a 7-year record). */
export async function deleteLocation(db: Db, actor: Actor, id: string): Promise<void> {
  requireRole(actor, 'locations.write');
  try {
    const rows = await withOrg(db, actor.orgId, (tx) => tx.delete(tables.locations).where(eq(tables.locations.id, id)).returning({ id: tables.locations.id }));
    if (rows.length === 0) throw new DashboardError('not_found', 'location not found');
  } catch (e) {
    if (isForeignKeyViolation(e)) throw new DashboardError('conflict', 'location still has terminals or receipts');
    throw e;
  }
}
