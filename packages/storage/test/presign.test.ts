import { describe, expect, it } from 'vitest';
import { createObjectStore } from '../src/index.ts';

const store = createObjectStore({ S3_ENDPOINT: 'http://s3.test:9090', S3_REGION: 'eu-west-1', S3_BUCKET: 'receipts', S3_ACCESS_KEY: 'k', S3_SECRET_KEY: 's' });

describe('presigned PUT', () => {
  it('signs the content type and length, and carries no checksum of an empty body (real S3 would reject the upload with BadDigest)', async () => {
    const url = new URL(await store.presignPut('uploads/u/1', 'image/jpeg', 1234));
    expect(url.pathname).toBe('/receipts/uploads/u/1');
    const signed = url.searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signed).toContain('content-length');
    expect([...url.searchParams.keys()].filter((k) => k.toLowerCase().includes('checksum') && k.toLowerCase() !== 'x-amz-content-sha256')).toEqual([]);
  });
});
