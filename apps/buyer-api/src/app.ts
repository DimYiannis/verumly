import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { loggerOptions } from '@lr/config';
import type { AppDeps } from './context.ts';
import { authRoutes } from './routes/auth.ts';
import { meRoutes } from './routes/me.ts';
import { resolveRoutes } from './routes/resolve.ts';
import { insightRoutes } from './routes/insights.ts';
import { pushRoutes } from './routes/push.ts';
import { uploadRoutes } from './routes/uploads.ts';
import { exportRoutes } from './routes/export.ts';
import { pdfRoutes } from './routes/pdf.ts';
import { accountRoutes } from './routes/account.ts';
import { consentRoutes } from './routes/consents.ts';

export type { AppDeps } from './context.ts';

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { ...loggerOptions(deps.logLevel ?? 'info'), ...(deps.logStream ? { stream: deps.logStream } : {}) },
    bodyLimit: 1024 * 1024,
    genReqId: () => crypto.randomUUID(),
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // fetch wrappers send `content-type: application/json` even on body-less POST/DELETE; Fastify's default parser would
  // answer 400. An empty body is "no body"; a malformed one is still 400.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.length === 0) return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      done(Object.assign(new Error('invalid json'), { statusCode: 400 }), undefined);
    }
  });
  await app.register(helmet);
  await app.register(cors, { origin: [deps.allowedOrigin], methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['content-type', 'authorization'] });
  // in-memory store: limits are per process (documented in DECISIONS.md); failed-secret limits live in Postgres
  await app.register(rateLimit, { global: false });

  app.get('/healthz', async () => ({ ok: true }));
  await app.register(resolveRoutes(deps));
  await app.register(authRoutes(deps));
  await app.register(meRoutes(deps));
  await app.register(uploadRoutes(deps));
  await app.register(insightRoutes(deps));
  await app.register(consentRoutes(deps));
  await app.register(pushRoutes(deps));
  await app.register(exportRoutes(deps));
  await app.register(pdfRoutes(deps));
  await app.register(accountRoutes(deps));
  return app;
}
