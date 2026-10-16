import { desc, eq } from 'drizzle-orm';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { QUEUES, tables, withOrg, type Db, type ExportJob } from '@lr/db';
import { DashboardError } from './errors.ts';
import { requireRole, type Actor } from './roles.ts';

/** `sales_csv`: one row per receipt line period; `btw_csv`: accountant CSV, VAT per day and VAT return box 1a/1b/1e. */
export const EXPORT_KINDS = ['sales_csv', 'btw_csv'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_LINK_TTL_SECONDS = 24 * 3600;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const exportRequestInput = z
  .object({ kind: z.enum(EXPORT_KINDS), from: date, to: date })
  .strict()
  .refine((v) => v.from <= v.to, 'from must not be after to');

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

export function makeS3(cfg: S3Config): S3Client {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });
}

/** A GET link for an exported file, valid for 24 hours from now. */
export function presignExportLink(s3: S3Client, bucket: string, key: string, ttlSeconds = EXPORT_LINK_TTL_SECONDS): Promise<string> {
  const filename = key.split('/').pop() ?? 'export.csv';
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: `attachment; filename="${filename}"` }), { expiresIn: ttlSeconds });
}

/** The part of pg-boss this module needs (tests pass a recorder). */
export interface JobSender {
  send(name: string, data: object): Promise<unknown>;
}

/** Queue an export. The `export` worker job builds the CSV, uploads it to S3 and sets status/s3_key. */
export async function requestExport(db: Db, boss: JobSender, actor: Actor, input: unknown) {
  requireRole(actor, 'exports.create');
  const v = exportRequestInput.safeParse(input);
  if (!v.success) throw new DashboardError('validation', v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const [row] = await withOrg(db, actor.orgId, (tx) =>
    tx
      .insert(tables.exportsTable)
      .values({ orgId: actor.orgId, kind: v.data.kind, periodFrom: v.data.from, periodTo: v.data.to })
      .returning({ id: tables.exportsTable.id, status: tables.exportsTable.status }),
  );
  const job: ExportJob = { exportId: row!.id };
  // after commit: a crash in between leaves a `queued` row the user can see and re-request, never a lost job in a rolled-back row
  await boss.send(QUEUES.export, job);
  return { id: row!.id, status: row!.status };
}

export interface ExportListing {
  id: string;
  kind: string;
  periodFrom: string;
  periodTo: string;
  status: string;
  createdAt: Date;
  /** presigned download link, only when the file exists; a fresh 24 h link each time the list is read */
  link: string | null;
  linkExpiresAt: Date | null;
}

export async function listExports(db: Db, actor: Actor, s3: { client: S3Client; bucket: string }, now = new Date()): Promise<ExportListing[]> {
  requireRole(actor, 'exports.read');
  const rows = await withOrg(db, actor.orgId, (tx) => tx.select().from(tables.exportsTable).orderBy(desc(tables.exportsTable.createdAt)).limit(100));
  return Promise.all(
    rows.map(async (r) => {
      const ready = r.status === 'done' && r.s3Key;
      return {
        id: r.id,
        kind: r.kind,
        periodFrom: r.periodFrom,
        periodTo: r.periodTo,
        status: r.status,
        createdAt: r.createdAt,
        link: ready ? await presignExportLink(s3.client, s3.bucket, r.s3Key!) : null,
        linkExpiresAt: ready ? new Date(now.getTime() + EXPORT_LINK_TTL_SECONDS * 1000) : null,
      };
    }),
  );
}

export async function getExport(db: Db, actor: Actor, id: string) {
  requireRole(actor, 'exports.read');
  const [row] = await withOrg(db, actor.orgId, (tx) => tx.select().from(tables.exportsTable).where(eq(tables.exportsTable.id, id)));
  if (!row) throw new DashboardError('not_found', 'export not found');
  return row;
}
