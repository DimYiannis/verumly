import { z } from 'zod';
import { dbEnvSchema, loadEnv, sharedEnvSchema } from '@lr/config';
import { connect, makeBoss } from '@lr/db';
import { buildApp } from './app.ts';
import { smtpMailer } from './mail.ts';

const env = loadEnv(
  dbEnvSchema.extend(sharedEnvSchema.shape).extend({
    PORT: z.coerce.number().default(4002),
    HOST: z.string().default('127.0.0.1'),
    SMTP_HOST: z.string().default('127.0.0.1'),
    SMTP_PORT: z.coerce.number().default(1025),
    MAIL_FROM: z.string().default('Receipts <no-reply@receipts.test>'),
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
});
await app.listen({ port: env.PORT, host: env.HOST });
