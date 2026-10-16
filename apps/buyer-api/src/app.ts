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

export type { AppDeps } from './context.ts';

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { ...loggerOptions(deps.logLevel ?? 'info'), ...(deps.logStream ? { stream: deps.logStream } : {}) },
    bodyLimit: 1024 * 1024,
    genReqId: () => crypto.randomUUID(),
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(helmet);
  await app.register(cors, { origin: [deps.allowedOrigin], methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['content-type', 'authorization'] });
  // in-memory store: limits are per process (documented in DECISIONS.md); failed-secret limits live in Postgres
  await app.register(rateLimit, { global: false });

  app.get('/healthz', async () => ({ ok: true }));
  await app.register(resolveRoutes(deps));
  await app.register(authRoutes(deps));
  await app.register(meRoutes(deps));
  return app;
}
