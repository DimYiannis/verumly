import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QIANFAN_PROMPTS } from '@lr/receipt-nl';
import { loginUser, sql } from '../../../scripts/lib/testkit.ts';
import { httpExtractor, PermanentExtractionError, recordedExtractor, sniffMime, type Extractor } from '../src/extractor.ts';
import { extractUpload } from '../src/jobs/extract-upload.ts';
import { corpusEntry, createWorkerWorld, imageBytes, uploadBytes, type WorkerWorld } from './helpers.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe('http extractor (OpenAI-compatible Qianfan endpoint)', () => {
  const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
  let status = 200;
  let baseUrl = '';
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      seen.push({ url: req.url ?? '', body });
      const content = JSON.stringify(body).includes(QIANFAN_PROMPTS.markdown) ? '# MARKDOWN' : '{"kie":true}';
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ model: 'baidu/Qianfan-OCR@abc123', choices: [{ message: { content } }] }));
    });
  });
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    if (typeof addr !== 'object' || addr === null) throw new Error('no address');
    baseUrl = `http://127.0.0.1:${addr.port}/v1/chat/completions`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('sends the image with each of the two fixed prompts, greedy decoding, and returns markdown + kie + the model revision', async () => {
    seen.length = 0;
    const ex = httpExtractor({ url: baseUrl, model: 'baidu/Qianfan-OCR' });
    const out = await ex.extract(PNG);
    expect(out).toEqual({ markdown: '# MARKDOWN', kie: '{"kie":true}', modelRevision: 'baidu/Qianfan-OCR@abc123' });
    expect(seen).toHaveLength(2);
    for (const s of seen) {
      expect(s.url).toBe('/v1/chat/completions');
      expect(s.body).toMatchObject({ model: 'baidu/Qianfan-OCR', temperature: 0 });
    }
    const texts = seen.map((s) => JSON.stringify(s.body));
    expect(texts[0]).toContain(QIANFAN_PROMPTS.markdown);
    expect(texts[1]).toContain(QIANFAN_PROMPTS.kie);
    expect(texts[0]).toContain(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`);
    expect((await httpExtractor({ url: baseUrl, model: 'm', revision: 'rev-1' }).extract(JPEG)).modelRevision).toBe('rev-1');
  });

  it('a 4xx from the model server is permanent, a 5xx is retryable; PDFs and unknown files are refused with a code', async () => {
    const ex = httpExtractor({ url: baseUrl, model: 'm' });
    status = 422;
    await expect(ex.extract(PNG)).rejects.toMatchObject({ code: 'extractor_rejected' });
    status = 503;
    const err = await ex.extract(PNG).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PermanentExtractionError);
    status = 200;
    await expect(ex.extract(new Uint8Array([0x25, 0x50, 0x44, 0x46, 1]))).rejects.toMatchObject({ code: 'pdf_unsupported' });
    await expect(ex.extract(new Uint8Array([1, 2, 3, 4]))).rejects.toMatchObject({ code: 'unsupported_file' });
  });

  it('sniffs the real type from the bytes', () => {
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(JPEG)).toBe('image/jpeg');
    expect(sniffMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp');
    expect(sniffMime(new Uint8Array([0, 1, 2, 3]))).toBeNull();
  });
});

describe('recorded extractor', () => {
  it('reads <sha256>.qianfan.json from the fixtures dir, falling back to mock/', async () => {
    const ww = await createWorkerWorld();
    try {
      const e = corpusEntry(ww, 'mock-weegschaal');
      const out = await recordedExtractor(new URL('../../../fixtures/receipts-nl', import.meta.url).pathname).extract(imageBytes(e));
      expect(out.modelRevision).toBe('mock');
      expect(out.markdown.length).toBeGreaterThan(20);
      await expect(recordedExtractor('/nonexistent-dir').extract(imageBytes(e))).rejects.toMatchObject({ code: 'no_recorded_extraction' });
    } finally {
      await ww.close();
    }
  }, 60_000);
});

describe('extract-upload failure handling', () => {
  let ww: WorkerWorld;
  beforeAll(async () => {
    ww = await createWorkerWorld();
  }, 120_000);
  afterAll(async () => {
    await ww.close();
  });

  it('a transient extractor error is rethrown for the retry; on the final attempt the upload is marked failed', async () => {
    const flaky: Extractor = {
      async extract() {
        throw new Error('connect ECONNREFUSED');
      },
    };
    ww.ctx.extractor = flaky;
    const who = await loginUser(ww.w);
    const up = await uploadBytes(ww, who, PNG);
    await expect(extractUpload(ww.ctx, { uploadId: up.uploadId }, { finalAttempt: false })).rejects.toThrow(/ECONNREFUSED/);
    expect((await sql<{ status: string }>(ww.w, 'select status from buyer.uploads where id = $1', [up.uploadId]))[0]?.status).toBe('processing');
    const out = await extractUpload(ww.ctx, { uploadId: up.uploadId }, { finalAttempt: true });
    expect(out.status).toBe('failed');
    const row = (await sql<{ status: string; extracted: { failures: string[] } }>(ww.w, 'select status, extracted from buyer.uploads where id = $1', [up.uploadId]))[0];
    expect(row).toMatchObject({ status: 'failed', extracted: { failures: ['extractor_unavailable'] } });
    // a finished (failed) upload is never processed again
    expect((await extractUpload(ww.ctx, { uploadId: up.uploadId })).status).toBe('skipped');
  });
});
