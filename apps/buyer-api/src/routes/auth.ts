import { randomInt } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { constantTimeEqual, generateToken, sha256Hex } from '@lr/crypto';
import { tables } from '@lr/db';
import { emailStartBody, emailVerifyBody } from '@lr/schema';
import type { AppDeps, Req, Reply } from '../context.ts';

const CODE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 30 * 86_400_000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;

const norm = (email: string) => email.trim().toLowerCase();
const codeHash = (email: string, code: string) => sha256Hex(`${email}:${code}`);

/** preHandler: resolves a Bearer session token (stored hashed) to `req.session`. */
export function requireSession(deps: AppDeps) {
  return async (req: Req, reply: Reply) => {
    const m = /^Bearer (\S{20,100})$/.exec(req.headers.authorization ?? '');
    if (!m) return reply.code(401).send({ error: 'unauthorized' });
    const [row] = await deps.db
      .select({ userId: tables.sessions.userId })
      .from(tables.sessions)
      .innerJoin(tables.users, eq(tables.users.id, tables.sessions.userId))
      .where(and(eq(tables.sessions.tokenHash, sha256Hex(m[1]!)), gt(tables.sessions.expiresAt, new Date()), isNull(tables.users.deletedAt)));
    if (!row) return reply.code(401).send({ error: 'unauthorized' });
    req.session = { userId: row.userId };
  };
}

export function authRoutes(deps: AppDeps) {
  return async (app: FastifyInstance) => {
    const r = app.withTypeProvider<ZodTypeProvider>();

    r.post('/v1/auth/email/start', { schema: { body: emailStartBody } }, async (req, reply) => {
      const email = norm(req.body.email);
      const [recent] = await deps.db
        .select({ n: sql<number>`count(*)::int` })
        .from(tables.emailCodes)
        .where(and(eq(tables.emailCodes.email, email), gt(tables.emailCodes.createdAt, new Date(Date.now() - 3_600_000))));
      if ((recent?.n ?? 0) >= MAX_CODES_PER_HOUR) return reply.code(429).send({ error: 'too_many_requests' });
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await deps.db.insert(tables.emailCodes).values({ email, codeHash: codeHash(email, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) });
      await deps.mailer.sendCode(email, code);
      // same answer whether or not the address is known
      return reply.code(202).send({ ok: true });
    });

    r.post('/v1/auth/email/verify', { schema: { body: emailVerifyBody } }, async (req, reply) => {
      const email = norm(req.body.email);
      const [row] = await deps.db
        .select()
        .from(tables.emailCodes)
        .where(and(eq(tables.emailCodes.email, email), isNull(tables.emailCodes.consumedAt), gt(tables.emailCodes.expiresAt, new Date())))
        .orderBy(desc(tables.emailCodes.createdAt))
        .limit(1);
      if (!row || row.attempts >= MAX_ATTEMPTS) return reply.code(401).send({ error: 'invalid_code' });
      if (!constantTimeEqual(row.codeHash, codeHash(email, req.body.code))) {
        await deps.db
          .update(tables.emailCodes)
          .set({ attempts: sql`${tables.emailCodes.attempts} + 1` })
          .where(eq(tables.emailCodes.id, row.id));
        return reply.code(401).send({ error: 'invalid_code' });
      }
      // single use: only one concurrent verify can win this update
      const consumed = await deps.db
        .update(tables.emailCodes)
        .set({ consumedAt: new Date() })
        .where(and(eq(tables.emailCodes.id, row.id), isNull(tables.emailCodes.consumedAt)))
        .returning({ id: tables.emailCodes.id });
      if (consumed.length === 0) return reply.code(401).send({ error: 'invalid_code' });

      const [existing] = await deps.db.select().from(tables.users).where(eq(tables.users.email, email));
      let userId = existing?.id;
      // a soft-deleted account cannot sign in; it is hard-deleted by the retention job after 30 days
      if (existing?.deletedAt) return reply.code(401).send({ error: 'invalid_code' });
      if (!userId) {
        const [created] = await deps.db.insert(tables.users).values({ email }).returning({ id: tables.users.id });
        userId = created!.id;
      }
      const { token, hash } = generateToken();
      await deps.db.insert(tables.sessions).values({ tokenHash: hash, userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
      return { token, userId };
    });

    // demo sign-in: only answers when the server was started with a demo user
    r.get('/v1/auth/demo', async () => (deps.demoUserEmail ? { enabled: true, email: deps.demoUserEmail } : { enabled: false }));
    r.post('/v1/auth/demo', async (_req, reply) => {
      if (!deps.demoUserEmail) return reply.code(404).send({ error: 'not_found' });
      const [user] = await deps.db.select().from(tables.users).where(and(eq(tables.users.email, deps.demoUserEmail), isNull(tables.users.deletedAt)));
      if (!user) return reply.code(404).send({ error: 'demo_user_missing' });
      const { token, hash } = generateToken();
      await deps.db.insert(tables.sessions).values({ tokenHash: hash, userId: user.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
      return { token, userId: user.id };
    });

    r.post('/v1/auth/logout', { preHandler: requireSession(deps) }, async (req, reply) => {
      const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
      if (m) await deps.db.delete(tables.sessions).where(eq(tables.sessions.tokenHash, sha256Hex(m[1]!)));
      return reply.code(204).send();
    });
  };
}
