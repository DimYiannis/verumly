import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { z } from 'zod';
import type { s3EnvSchema } from '@lr/config';

export type S3Env = z.infer<typeof s3EnvSchema>;

/** The S3 operations the services need. Works against any S3 API (adobe/s3mock locally). */
export interface ObjectStore {
  bucket: string;
  /** URL the browser PUTs the bytes to; `size` is signed, so a larger body is rejected by S3 */
  presignPut(key: string, contentType: string, size: number): Promise<string>;
  presignGet(key: string, expiresInSeconds: number): Promise<string>;
  head(key: string): Promise<{ size: number } | null>;
  get(key: string): Promise<Uint8Array>;
  put(key: string, body: Uint8Array | string, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const PRESIGN_PUT_SECONDS = 600;

function isNotFound(e: unknown): boolean {
  return e instanceof S3ServiceException && (e.$metadata.httpStatusCode === 404 || e.name === 'NotFound' || e.name === 'NoSuchKey');
}

export function createObjectStore(env: S3Env): ObjectStore {
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });
  const Bucket = env.S3_BUCKET;
  return {
    bucket: Bucket,
    presignPut: (Key, ContentType, ContentLength) =>
      getSignedUrl(client, new PutObjectCommand({ Bucket, Key, ContentType, ContentLength }), { expiresIn: PRESIGN_PUT_SECONDS }),
    presignGet: (Key, expiresIn) => getSignedUrl(client, new GetObjectCommand({ Bucket, Key }), { expiresIn }),
    async head(Key) {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket, Key }));
        return { size: r.ContentLength ?? 0 };
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    async get(Key) {
      const r = await client.send(new GetObjectCommand({ Bucket, Key }));
      if (!r.Body) throw new Error('empty S3 body');
      return r.Body.transformToByteArray();
    },
    async put(Key, Body, ContentType) {
      await client.send(new PutObjectCommand({ Bucket, Key, Body, ContentType }));
    },
    async remove(Key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key }));
    },
  };
}
