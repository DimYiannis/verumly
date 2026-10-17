import { randomBytes } from 'node:crypto';
import { createMerchantUser } from '@lr/dashboard-core';
import { connectAdmin } from '@lr/db';
import { createLocation, createOrg, createTerminal, type ProvisionedTerminal } from '@lr/db/provision';
import { dbEnv } from './env.ts';

/** One merchant organisation with an owner who has not enrolled TOTP yet. Every test builds its own, so RLS keeps tests apart. */
export interface World {
  orgId: string;
  merchantName: string;
  kvkNumber: string;
  locationId: string;
  ownerEmail: string;
  ownerPassword: string;
  /** base32 TOTP seed, set by the first dashboard login (enrolment) */
  totpSecret: string | null;
}

export async function createWorld(): Promise<World> {
  const suffix = randomBytes(4).toString('hex');
  const { db, close } = connectAdmin(dbEnv, { max: 2 });
  try {
    const merchantName = `E2E Café ${suffix}`;
    const kvk = String(10_000_000 + (randomBytes(4).readUInt32BE() % 89_999_999));
    const org = await createOrg(db, { legalName: merchantName, kvkNumber: kvk });
    const location = await createLocation(db, org.id, `Terras ${suffix}`);
    const ownerEmail = `owner-${suffix}@e2e.test`;
    const ownerPassword = `e2e-password-${suffix}`;
    await createMerchantUser(db, { orgId: org.id, email: ownerEmail, password: ownerPassword, role: 'owner' });
    return { orgId: org.id, merchantName, kvkNumber: kvk, locationId: location.id, ownerEmail, ownerPassword, totpSecret: null };
  } finally {
    await close();
  }
}

/** A terminal registered straight in the database (for tests that need a till but not the dashboard UI). */
export async function provisionTerminal(world: World, label: string): Promise<ProvisionedTerminal> {
  const { db, close } = connectAdmin(dbEnv, { max: 2 });
  try {
    return await createTerminal(db, { orgId: world.orgId, locationId: world.locationId, label });
  } finally {
    await close();
  }
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex')}@e2e.test`;
}

/** An extra location registered straight in the database (the dashboard refuses it once a plan limit is reached). */
export async function provisionLocation(world: World, name: string): Promise<void> {
  const { db, close } = connectAdmin(dbEnv, { max: 2 });
  try {
    await createLocation(db, world.orgId, name);
  } finally {
    await close();
  }
}
