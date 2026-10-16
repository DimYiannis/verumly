import { z } from 'zod';
import { dbEnvSchema, loadEnv, s3EnvSchema, sharedEnvSchema } from '@lr/config';
import { connect, makeBoss } from '@lr/db';
import { createObjectStore } from '@lr/storage';
import { buildApp } from './app.ts';
import { smtpMailer } from './mail.ts';

const env = loadEnv(
  dbEnvSchema.extend(s3EnvSchema.shape).extend(sharedEnvSchema.shape).extend({
    PORT: z.coerce.number().default(4002),
    HOST: z.string().default('127.0.0.1'),
    SMTP_HOST: z.string().default('127.0.0.1'),
    SMTP_PORT: z.coerce.number().default(1025),
    MAIL_FROM: z.string().default('Receipts <no-reply@receipts.test>'),
    /** served to the wallet so it can subscribe to Web Push; keep in sync with the worker's VAPID_PUBLIC_KEY */
    VAPID_PUBLIC_KEY: z.string().optional(),
    /** accept plain-http loopback push endpoints (local tests). Off in production. */
    PUSH_ALLOW_LOOPBACK: z.stringbool().default(process.env.NODE_ENV !== 'production'),
    POLICY_VERSION: z.string().default('2026-10'),
  }),
);

const { db } = connect('buyer_api', env);
const boss = makeBoss('buyer_api', env);
await boss.start();
const app = await buildApp({
  db,
  boss,
  mailer: smtpMailer({ host: env.SMTP_HOST, port: env.SMTP_PORT, from: env.MAIL_FROM }),
  allowedOrigin: env.RECEIPT_HOST,
  logLevel: env.LOG_LEVEL,
  s3: createObjectStore(env),
  vapidPublicKey: env.VAPID_PUBLIC_KEY ?? null,
  allowLoopbackPush: env.PUSH_ALLOW_LOOPBACK,
  policyVersion: env.POLICY_VERSION,
});
await app.listen({ port: env.PORT, host: env.HOST });
