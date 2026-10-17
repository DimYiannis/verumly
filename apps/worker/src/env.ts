import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { dbEnvSchema, s3EnvSchema, sharedEnvSchema } from '@lr/config';

const defaultFixtures = fileURLToPath(new URL('../../../fixtures/receipts-nl', import.meta.url));

export const workerEnvSchema = dbEnvSchema
  .extend(s3EnvSchema.shape)
  .extend(sharedEnvSchema.shape)
  .extend({
    /** `recorded` (tests, seed): replay fixtures. `http`: a vLLM-served Qianfan-OCR endpoint. No fake extractor. */
    EXTRACTOR: z.enum(['recorded', 'http']).default('recorded'),
    FIXTURES_DIR: z.string().default(defaultFixtures),
    /** server base URL; the worker appends /v1/chat/completions (a full URL is accepted too) */
    QIANFAN_URL: z.string().default('http://127.0.0.1:8000'),
    QIANFAN_MODEL: z.string().default('baidu/Qianfan-OCR'),
    QIANFAN_REVISION: z.string().optional(),
    /** vLLM `--api-key`; sent as a bearer token */
    QIANFAN_API_KEY: z.string().optional(),
    LEAD_THRESHOLD: z.coerce.number().int().min(1).default(20),
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().default('mailto:support@receipts.test'),
  })
  .refine((e) => Boolean(e.VAPID_PUBLIC_KEY) === Boolean(e.VAPID_PRIVATE_KEY), { message: 'set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY or neither' });
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
