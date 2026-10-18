import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseExtraction, truthPrintedAtUtc } from '@lr/receipt-nl';
import { readRecorded } from '../../../scripts/lib/corpus.ts';
import { buyerCall, createReceipt, loginUser, sql } from '../../../scripts/lib/testkit.ts';
import { corpusEntry, createWorkerWorld, imageBytes, orgForCorpusEntry, uploadAndExtract, uploadBytes, type WorkerWorld } from './helpers.ts';

let ww: WorkerWorld;
beforeAll(async () => {
  ww = await createWorkerWorld({ leadThreshold: 2 });
}, 120_000);
afterAll(async () => {
  await ww.close();
});

const GOOD = 'mock-supermarkt-statiegeld-bonus';
const PLANTED = 'mock-horeca-gemengd'; // digit misread in the total

describe('upload → extraction', () => {
  it('a corpus photo goes presign → S3 → complete → extract-upload job → done, and the status endpoint shows the draft', async () => {
    const e = corpusEntry(ww, GOOD);
    const who = await loginUser(ww.w);
    const { uploadId, outcome } = await uploadAndExtract(ww, who, e);
    expect(outcome.status).toBe('done');

    // the complete call enqueued exactly one extract-upload job for this upload
    const jobs = ww.w.buyerJobs.filter((j) => j.name === 'extract-upload' && (j.data as { uploadId: string }).uploadId === uploadId);
    expect(jobs).toHaveLength(1);

    const status = await buyerCall(ww.w, 'GET', `/v1/me/uploads/${uploadId}`, { token: who.token });
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      uploadId,
      status: 'done',
      failures: [],
      draft: { merchantName: 'Supermarkt De Hoek', gross: e.truth.gross, paymentMethod: 'card' },
    });
    const [row] = await sql<{ sha256: string; status: string }>(ww.w, 'select sha256, status from buyer.uploads where id = $1', [uploadId]);
    expect(row).toEqual({ sha256: e.truth.sha256, status: 'done' });
  });

  it('a photo with an OCR error ends in needs_review with the failed checks listed; corrections make it done', async () => {
    const e = corpusEntry(ww, PLANTED);
    const who = await loginUser(ww.w);
    const { uploadId, outcome } = await uploadAndExtract(ww, who, e);
    expect(outcome.status).toBe('needs_review');
    const before = await buyerCall(ww.w, 'GET', `/v1/me/uploads/${uploadId}`, { token: who.token });
    const draft = (before.body as { draft: { gross: number; lines: unknown[] }; failures: string[] });
    expect(draft.failures.length).toBeGreaterThan(0);
    expect(draft.draft.gross).not.toBe(e.truth.gross);

    // an incomplete patch keeps it in review
    const still = await buyerCall(ww.w, 'PATCH', `/v1/me/uploads/${uploadId}`, { token: who.token, body: { merchantName: 'Café Het Plein' } });
    expect(still.status).toBe(200);
    expect(still.body).toMatchObject({ status: 'needs_review' });

    // the buyer types the printed total
    const fixed = await buyerCall(ww.w, 'PATCH', `/v1/me/uploads/${uploadId}`, { token: who.token, body: { gross: e.truth.gross } });
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({ status: 'done', failures: [], draft: { gross: e.truth.gross } });

    // done uploads are no longer correctable
    expect((await buyerCall(ww.w, 'PATCH', `/v1/me/uploads/${uploadId}`, { token: who.token, body: { gross: 1 } })).status).toBe(409);
  });

  it('another user cannot read or complete my upload', async () => {
    const e = corpusEntry(ww, GOOD);
    const mine = await loginUser(ww.w);
    const other = await loginUser(ww.w);
    const { uploadId } = await uploadAndExtract(ww, mine, e);
    expect((await buyerCall(ww.w, 'GET', `/v1/me/uploads/${uploadId}`, { token: other.token })).status).toBe(404);
    expect((await buyerCall(ww.w, 'POST', `/v1/me/uploads/${uploadId}/complete`, { token: other.token })).status).toBe(404);
    expect((await buyerCall(ww.w, 'PATCH', `/v1/me/uploads/${uploadId}`, { token: other.token, body: { gross: 1 } })).status).toBe(404);
  });

  it('complete before the file reached S3 is 409; unknown media and oversized requests are rejected', async () => {
    const who = await loginUser(ww.w);
    const created = await buyerCall(ww.w, 'POST', '/v1/me/uploads', { token: who.token, body: { contentType: 'image/png', size: 1000 } });
    const { uploadId } = created.body as { uploadId: string };
    expect((await buyerCall(ww.w, 'POST', `/v1/me/uploads/${uploadId}/complete`, { token: who.token })).status).toBe(409);
    expect((await buyerCall(ww.w, 'POST', '/v1/me/uploads', { token: who.token, body: { contentType: 'text/html', size: 10 } })).status).toBe(400);
    expect((await buyerCall(ww.w, 'POST', '/v1/me/uploads', { token: who.token, body: { contentType: 'image/png', size: 10_000_001 } })).status).toBe(400);
    expect((await buyerCall(ww.w, 'POST', '/v1/me/uploads', { body: { contentType: 'image/png', size: 10 } })).status).toBe(401);
  });

  it('complete rejects a file larger than the limit, deletes it from S3 and marks the upload failed', async () => {
    const who = await loginUser(ww.w);
    const created = await buyerCall(ww.w, 'POST', '/v1/me/uploads', { token: who.token, body: { contentType: 'image/png', size: 100 } });
    const { uploadId, uploadUrl, headers } = created.body as { uploadId: string; uploadUrl: string; headers: Record<string, string> };
    // the S3 mock does not enforce the signed length (real S3 would refuse); `complete` checks the stored size itself
    const put = await fetch(uploadUrl, { method: 'PUT', headers, body: new Uint8Array(10_000_001) });
    expect(put.ok).toBe(true);
    const complete = await buyerCall(ww.w, 'POST', `/v1/me/uploads/${uploadId}/complete`, { token: who.token });
    expect(complete.status).toBe(413);
    expect(await ww.s3.head(`uploads/${who.userId}/${uploadId}`)).toBeNull();
    expect((await buyerCall(ww.w, 'GET', `/v1/me/uploads/${uploadId}`, { token: who.token })).body).toMatchObject({ status: 'failed', failures: ['bad_size'] });
  });

  it('an image with no recorded extraction fails permanently with a code, not silently', async () => {
    const who = await loginUser(ww.w);
    const up = await uploadBytes(ww, who, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));
    const { extractUpload } = await import('../src/jobs/extract-upload.ts');
    expect((await extractUpload(ww.ctx, { uploadId: up.uploadId })).status).toBe('failed');
    expect((await buyerCall(ww.w, 'GET', `/v1/me/uploads/${up.uploadId}`, { token: who.token })).body).toMatchObject({ status: 'failed', failures: ['no_recorded_extraction'], draft: null });
  });
});

describe('a photo with a date in the future', () => {
  const FUTURE = 'mock-contant-afronding'; // printed 25 Oct 2026 08:10 Amsterdam = 07:10 UTC
  const extractAt = async (now: string) => {
    const who = await loginUser(ww.w);
    const up = await uploadBytes(ww, who, imageBytes(corpusEntry(ww, FUTURE)));
    const { extractUpload } = await import('../src/jobs/extract-upload.ts');
    const outcome = await extractUpload({ ...ww.ctx, now: () => new Date(now) }, { uploadId: up.uploadId });
    const view = await buyerCall(ww.w, 'GET', `/v1/me/uploads/${up.uploadId}`, { token: who.token });
    return { outcome, view: view.body as { status: string; failures: string[] } };
  };

  it('is needs_review with date_future when printed more than a day after the worker clock', async () => {
    const { outcome, view } = await extractAt('2026-10-18T12:00:00Z');
    expect(outcome.status).toBe('needs_review');
    expect(view).toMatchObject({ status: 'needs_review', failures: ['date_future'] });
  });

  it('is done within the one-day clock tolerance', async () => {
    const { outcome, view } = await extractAt('2026-10-24T12:00:00Z');
    expect(outcome.status).toBe('done');
    expect(view).toMatchObject({ status: 'done', failures: [] });
  });

  it('a correction cannot move the date into the future either', async () => {
    const e = corpusEntry(ww, PLANTED);
    const who = await loginUser(ww.w);
    const { uploadId } = await uploadAndExtract(ww, who, e);
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const res = await buyerCall(ww.w, 'PATCH', `/v1/me/uploads/${uploadId}`, { token: who.token, body: { gross: e.truth.gross, printedAt: future } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'needs_review', failures: ['date_future'] });
  });
});

describe('matching an upload to an official receipt', () => {
  const e = () => corpusEntry(ww, GOOD);

  /** the paper receipt's printed time, as the parser reads it from the recorded output */
  const printedAt = () => {
    const rec = readRecorded(e())!;
    return parseExtraction({ markdown: rec.markdown, kie: rec.kie }).printedAtUtc!;
  };

  it('same KvK/BTW-id, same gross, within ±30 minutes, unclaimed → matched; accept-match claims it as photo_match', async () => {
    const org = await orgForCorpusEntry(ww.w, e());
    const at = printedAt();
    expect(at).toBe(truthPrintedAtUtc(e().truth));
    const official = await createReceipt(ww.w, org, {
      state: 'paid',
      lines: [{ description: 'Boodschappen', unitPrice: e().truth.gross, vatRate: 9 }],
      createdAt: new Date(new Date(at).getTime() + 20 * 60_000).toISOString(),
    });
    const who = await loginUser(ww.w);
    const { uploadId, outcome } = await uploadAndExtract(ww, who, e());
    expect(outcome.matchedReceiptId).toBe(official.receiptId);
    // a known merchant is not a lead
    expect(outcome.lead).toBe('none');

    const status = await buyerCall(ww.w, 'GET', `/v1/me/uploads/${uploadId}`, { token: who.token });
    expect(status.body).toMatchObject({ matchedReceiptId: official.receiptId, match: { receiptId: official.receiptId, merchantName: 'Café Het Plein', total: e().truth.gross } });

    const accepted = await buyerCall(ww.w, 'POST', `/v1/me/uploads/${uploadId}/accept-match`, { token: who.token });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ receiptId: official.receiptId });
    const [claim] = await sql<{ user_id: string; source: string }>(ww.w, 'select user_id, source from buyer.claims where receipt_id = $1', [official.receiptId]);
    expect(claim).toEqual({ user_id: who.userId, source: 'photo_match' });
    const wallet = await buyerCall(ww.w, 'GET', '/v1/me/receipts', { token: who.token });
    expect(wallet.body).toMatchObject({ items: [{ receiptId: official.receiptId, source: 'photo_match' }] });
    // the upload is replaced by the official receipt; accepting again is idempotent
    expect((await buyerCall(ww.w, 'GET', `/v1/me/uploads/${uploadId}`, { token: who.token })).body).toMatchObject({ status: 'replaced' });
    expect((await buyerCall(ww.w, 'POST', `/v1/me/uploads/${uploadId}/accept-match`, { token: who.token })).body).toEqual({ receiptId: official.receiptId });
  });

  it('does not match: wrong gross, outside the 30-minute window, open/void, or already claimed by someone else', async () => {
    const org = await orgForCorpusEntry(ww.w, e());
    const at = new Date(printedAt()).getTime();
    const gross = e().truth.gross;
    const line = (total: number) => [{ description: 'Boodschappen', unitPrice: total, vatRate: 9 as const }];
    await createReceipt(ww.w, org, { state: 'paid', lines: line(gross + 1), createdAt: new Date(at).toISOString() });
    await createReceipt(ww.w, org, { state: 'paid', lines: line(gross), createdAt: new Date(at + 31 * 60_000).toISOString() });
    await createReceipt(ww.w, org, { state: 'paid', lines: line(gross), createdAt: new Date(at - 31 * 60_000).toISOString() });
    await createReceipt(ww.w, org, { state: 'open', lines: line(gross), createdAt: new Date(at).toISOString() });
    const taken = await createReceipt(ww.w, org, { state: 'paid', lines: line(gross), createdAt: new Date(at).toISOString() });
    const owner = await loginUser(ww.w);
    expect((await buyerCall(ww.w, 'POST', '/v1/me/claims', { token: owner.token, body: { receiptId: taken.receiptId, secret: taken.secret } })).status).toBe(201);

    const who = await loginUser(ww.w);
    const { uploadId, outcome } = await uploadAndExtract(ww, who, e());
    expect(outcome.matchedReceiptId).toBeNull();
    expect((await buyerCall(ww.w, 'POST', `/v1/me/uploads/${uploadId}/accept-match`, { token: who.token })).status).toBe(409);
  });

  it('a match that someone else claims before accept-match is refused with 409 already_claimed', async () => {
    const org = await orgForCorpusEntry(ww.w, corpusEntry(ww, 'mock-weegschaal'));
    const weigh = corpusEntry(ww, 'mock-weegschaal');
    const rec = readRecorded(weigh)!;
    const at = parseExtraction({ markdown: rec.markdown, kie: rec.kie }).printedAtUtc!;
    const official = await createReceipt(ww.w, org, { state: 'paid', lines: [{ description: 'Weegschaal', unitPrice: weigh.truth.gross, vatRate: 9 }], createdAt: at });
    const who = await loginUser(ww.w);
    const { uploadId, outcome } = await uploadAndExtract(ww, who, weigh);
    expect(outcome.matchedReceiptId).toBe(official.receiptId);
    const rival = await loginUser(ww.w);
    expect((await buyerCall(ww.w, 'POST', '/v1/me/claims', { token: rival.token, body: { receiptId: official.receiptId, secret: official.secret } })).status).toBe(201);
    const status = await buyerCall(ww.w, 'GET', `/v1/me/uploads/${uploadId}`, { token: who.token });
    expect(status.body).toMatchObject({ matchedReceiptId: null, match: null });
    expect((await buyerCall(ww.w, 'POST', `/v1/me/uploads/${uploadId}/accept-match`, { token: who.token })).status).toBe(409);
  });

  it('a total corrected by the buyer can produce the match', async () => {
    const planted = corpusEntry(ww, PLANTED);
    const org = await orgForCorpusEntry(ww.w, planted);
    const rec = readRecorded(planted)!;
    const at = parseExtraction({ markdown: rec.markdown, kie: rec.kie }).printedAtUtc!;
    const official = await createReceipt(ww.w, org, { state: 'paid', lines: [{ description: 'Diner', unitPrice: planted.truth.gross, vatRate: 9 }], createdAt: at });
    const who = await loginUser(ww.w);
    const { uploadId, outcome } = await uploadAndExtract(ww, who, planted);
    expect(outcome.status).toBe('needs_review');
    expect(outcome.matchedReceiptId).toBeNull();
    const fixed = await buyerCall(ww.w, 'PATCH', `/v1/me/uploads/${uploadId}`, { token: who.token, body: { gross: planted.truth.gross } });
    expect(fixed.body).toMatchObject({ status: 'done', matchedReceiptId: official.receiptId });
  });
});
