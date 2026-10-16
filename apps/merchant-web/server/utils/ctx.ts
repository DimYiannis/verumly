import { LocalKeyProvider, makeS3, type AuthDeps } from '@lr/dashboard-core';
import { connect, makeBoss, type PgBoss } from '@lr/db';
import { useEnv } from './env.ts';

export interface Ctx {
  deps: AuthDeps;
  s3: { client: ReturnType<typeof makeS3>; bucket: string };
}

interface Shared {
  ctx?: Ctx;
  boss?: Promise<PgBoss>;
}

declare global {
  // survives dev-server module reloads, so the pool is not re-created on every HMR
  var __lrDashboard: Shared | undefined;
}

const shared = (globalThis.__lrDashboard ??= {});

/** One `dashboard`-role pool, key provider and S3 client per process. */
export function getCtx(): Ctx {
  if (shared.ctx) return shared.ctx;
  const env = useEnv();
  const { db } = connect('dashboard', env);
  shared.ctx = {
    deps: { db, keys: new LocalKeyProvider(env.encryptionKey) },
    s3: {
      client: makeS3({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION, bucket: env.S3_BUCKET, accessKey: env.S3_ACCESS_KEY, secretKey: env.S3_SECRET_KEY }),
      bucket: env.S3_BUCKET,
    },
  };
  return shared.ctx;
}

/** pg-boss sender (role `dashboard`), started on first use. */
export function getBoss(): Promise<PgBoss> {
  shared.boss ??= (async () => {
    const boss = makeBoss('dashboard', useEnv());
    await boss.start();
    return boss;
  })();
  return shared.boss;
}
