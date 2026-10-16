import { z } from 'zod';
import { dbEnvSchema, loadEnv, sharedEnvSchema } from '@lr/config';
import { connect, makeBoss } from '@lr/db';
import { buildApp } from './app.ts';

const env = loadEnv(dbEnvSchema.extend(sharedEnvSchema.shape).extend({ PORT: z.coerce.number().default(4001), HOST: z.string().default('127.0.0.1') }));

const { db } = connect('merchant_api', env);
const boss = makeBoss('merchant_api', env);
await boss.start();
const app = await buildApp({ db, boss, claimWindowDays: env.CLAIM_WINDOW_DAYS, logLevel: env.LOG_LEVEL });
await app.listen({ port: env.PORT, host: env.HOST });
