import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { tables, type Db } from '@lr/db';
import { CONSENT_PURPOSES, consentsBody } from '@lr/schema';
import type { AppDeps } from '../context.ts';
import { requireSession } from './auth.ts';

export const DEFAULT_POLICY_VERSION = '2026-10';

type Purpose = (typeof CONSENT_PURPOSES)[number];
export type ConsentState = Record<Purpose, boolean>;

/** The latest row per purpose wins; no row means "not granted" (all consents default off). */
export async function currentConsents(db: Db, userId: string): Promise<ConsentState> {
  const rows = await db
    .select({ purpose: tables.consents.purpose, granted: tables.consents.granted })
    .from(tables.consents)
    .where(eq(tables.consents.userId, userId))
    .orderBy(asc(tables.consents.id));
  const state: ConsentState = { analytics: false, marketing: false, push: false };
  for (const r of rows) {
    const purpose = CONSENT_PURPOSES.find((p) => p === r.purpose);
    if (purpose) state[purpose] = r.granted;
  }
  return state;
}

export function consentRoutes(deps: AppDeps) {
  return async (app: FastifyInstance) => {
    const r = app.withTypeProvider<ZodTypeProvider>();
    r.addHook('preHandler', requireSession(deps));

    r.get('/v1/me/consents', async (req) => ({ consents: await currentConsents(deps.db, req.session!.userId) }));

    // `buyer.consents` is append-only: a change adds a row with the policy version, nothing is updated in place
    r.put('/v1/me/consents', { schema: { body: consentsBody } }, async (req) => {
      const userId = req.session!.userId;
      const before = await currentConsents(deps.db, userId);
      const rows = CONSENT_PURPOSES.flatMap((purpose) => {
        const granted = req.body[purpose];
        return granted === undefined || granted === before[purpose]
          ? []
          : [{ userId, purpose, granted, policyVersion: deps.policyVersion ?? DEFAULT_POLICY_VERSION }];
      });
      if (rows.length > 0) await deps.db.insert(tables.consents).values(rows);
      return { consents: await currentConsents(deps.db, userId) };
    });
  };
}
