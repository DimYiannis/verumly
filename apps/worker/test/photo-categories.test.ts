import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buyerCall, loginUser, sql } from '../../../scripts/lib/testkit.ts';
import { corpusEntry, createWorkerWorld, uploadAndExtract, type WorkerWorld } from './helpers.ts';

let ww: WorkerWorld;
beforeAll(async () => {
  ww = await createWorkerWorld();
}, 120_000);
afterAll(async () => {
  await ww.close();
});

const GOOD = 'mock-supermarkt-statiegeld-bonus';
const PLANTED = 'mock-horeca-gemengd'; // digit misread in the total: needs_review until the total is corrected

interface Line {
  description: string;
  total: number;
  vatRate: number | null;
  category?: string;
  sensitive?: boolean;
  userCategory?: string | null;
}
interface View {
  status: string;
  draft: { merchantName: string; gross: number; lines: Line[]; vatBreakdown: Array<{ rate: number; base: number | null; vat: number }> };
}
const get = async (who: { token: string }, uploadId: string) => (await buyerCall(ww.w, 'GET', `/v1/me/uploads/${uploadId}`, { token: who.token })).body as View;

describe('photo receipts: stored categories, VAT per rate, user edits, delete', () => {
  it('the worker stores category and sensitive on every line at extraction time, and the per-line VAT rate and per-rate breakdown', async () => {
    const who = await loginUser(ww.w);
    const { uploadId, outcome } = await uploadAndExtract(ww, who, corpusEntry(ww, GOOD));
    expect(outcome.status).toBe('done');

    // from the database row, not from the API view: the category is stored, not derived on read
    const [row] = await sql<{ lines: Line[] }>(ww.w, "select extracted->'parsed'->'lines' as lines from buyer.uploads where id = $1", [uploadId]);
    expect(row!.lines.map((l) => [l.description, l.category, l.sensitive, l.vatRate])).toEqual([
      ['Halfvolle melk 1L', 'boodschappen', false, 9],
      ['Volkoren brood', 'boodschappen', false, 9],
      ['Pak koffie 500g', 'dining', false, 9],
      ['BONUS Pak koffie', 'dining', false, 9],
      ['Cola 1,5L', 'dining', false, 21],
      ['Chips paprika', 'boodschappen', false, 21],
      ['Wasmiddel', 'huishouden', false, 21],
      ['Statiegeld fles', 'statiegeld', false, null],
    ]);
    const view = await get(who, uploadId);
    expect(view.draft.vatBreakdown).toEqual([
      { rate: 21, base: 906, vat: 190 },
      { rate: 9, base: 759, vat: 68 },
    ]);
  });

  it('a PATCH re-categorises the lines (new shop name, new description) and keeps the stored fields in step', async () => {
    const who = await loginUser(ww.w);
    const { uploadId } = await uploadAndExtract(ww, who, corpusEntry(ww, PLANTED));
    const before = await get(who, uploadId);
    expect(before.status).toBe('needs_review');
    expect(before.draft.lines.every((l) => typeof l.category === 'string' && l.sensitive === false)).toBe(true);

    // the shop becomes a pharmacy: every line is health now, flagged sensitive
    const asPharmacy = await buyerCall(ww.w, 'PATCH', `/v1/me/uploads/${uploadId}`, { token: who.token, body: { merchantName: 'Apotheek Het Plein' } });
    expect(asPharmacy.status).toBe(200);
    expect((asPharmacy.body as View).draft.lines.every((l) => l.category === 'gezondheid' && l.sensitive === true)).toBe(true);
    const [stored] = await sql<{ n: number }>(ww.w, "select count(*)::int as n from buyer.uploads u, jsonb_array_elements(u.extracted->'parsed'->'lines') l where u.id = $1 and l->>'category' = 'gezondheid' and (l->>'sensitive')::boolean", [uploadId]);
    expect(stored!.n).toBe(before.draft.lines.length);

    // a corrected description is categorised by the rules, not by the category and flag the client sends along
    const lines = before.draft.lines.map((l, i) => (i === 0 ? { ...l, description: 'Parkeerkaart', category: 'dining', sensitive: true } : l));
    const edited = await buyerCall(ww.w, 'PATCH', `/v1/me/uploads/${uploadId}`, { token: who.token, body: { merchantName: 'Café Het Plein', lines } });
    expect(edited.status).toBe(200);
    const after = edited.body as View;
    expect(after.draft.lines[0]).toMatchObject({ description: 'Parkeerkaart', category: 'vervoer', sensitive: false });
    expect(after.draft.lines[1]).toMatchObject({ category: before.draft.lines[1]!.category, sensitive: false });
  });

  it('a category the buyer set survives every later PATCH and is never marked sensitive; clearing it hands the line back to the rules', async () => {
    const who = await loginUser(ww.w);
    const e = corpusEntry(ww, PLANTED);
    const { uploadId } = await uploadAndExtract(ww, who, e);
    const first = await get(who, uploadId);
    expect(first.draft.lines[0]!.category).toBe('dining'); // Koffie

    const set = await buyerCall(ww.w, 'PUT', `/v1/me/uploads/${uploadId}/categories`, { token: who.token, body: { lines: [{ index: 0, category: 'vervoer' }] } });
    expect(set.status).toBe(200);
    expect((set.body as View).status).toBe('needs_review');
    expect((set.body as View).draft.lines[0]).toMatchObject({ category: 'vervoer', sensitive: false, userCategory: 'vervoer' });

    // PATCH 1: the shop becomes a pharmacy: the rule-based lines turn into health, the buyer's line does not
    const pharmacy = (await buyerCall(ww.w, 'PATCH', `/v1/me/uploads/${uploadId}`, { token: who.token, body: { merchantName: 'Apotheek Het Plein' } })).body as View;
    expect(pharmacy.draft.lines[0]).toMatchObject({ category: 'vervoer', sensitive: false, userCategory: 'vervoer' });
    expect(pharmacy.draft.lines.slice(1).every((l) => l.category === 'gezondheid' && l.sensitive)).toBe(true);

    // PATCH 2, sent the way the wallet form does: the full line list with the buyer's choice, plus the corrected total
    const lines = pharmacy.draft.lines.map(stripDerived);
    const fixed = await buyerCall(ww.w, 'PATCH', `/v1/me/uploads/${uploadId}`, { token: who.token, body: { merchantName: 'Café Het Plein', gross: e.truth.gross, lines } });
    expect(fixed.status).toBe(200);
    const done = fixed.body as View;
    expect((fixed.body as View).status).toBe('done');
    expect(done.draft.lines[0]).toMatchObject({ category: 'vervoer', sensitive: false, userCategory: 'vervoer' });
    expect(done.draft.lines[1]!.category).not.toBe('gezondheid'); // back at a café: the rules decided again

    // a done upload keeps accepting category edits, and a null clears the choice
    const cleared = (await buyerCall(ww.w, 'PUT', `/v1/me/uploads/${uploadId}/categories`, { token: who.token, body: { lines: [{ index: 0, category: null }] } })).body as View;
    expect(cleared.draft.lines[0]).toMatchObject({ category: 'dining', userCategory: null });
    // done uploads are still not PATCH-correctable (no re-matching on typed totals)
    expect((await buyerCall(ww.w, 'PATCH', `/v1/me/uploads/${uploadId}`, { token: who.token, body: { gross: 1 } })).status).toBe(409);
  });

  it('insights count a done upload under its stored categories, follow the buyer’s edit, and report VAT per rate', async () => {
    const who = await loginUser(ww.w);
    const { uploadId } = await uploadAndExtract(ww, who, corpusEntry(ww, GOOD));
    const insights = async () => (await buyerCall(ww.w, 'GET', '/v1/me/insights', { token: who.token })).body as { perCategory: Array<{ category: string; total: number }>; vatPerRate: Array<{ rate: number; vat: number }> };

    const before = await insights();
    // melk 129 + brood 249 + chips 219 = 597; koffie 599 - 150 bonus + cola 378 = 827; wasmiddel 499; statiegeld 50
    expect(before.perCategory).toEqual([
      { category: 'dining', total: 827 },
      { category: 'boodschappen', total: 597 },
      { category: 'huishouden', total: 499 },
      { category: 'statiegeld', total: 50 },
    ]);
    expect(before.vatPerRate).toEqual([{ rate: 21, vat: 190 }, { rate: 9, vat: 68 }]);

    // the buyer moves the cola (index 4) from dining to boodschappen
    expect((await buyerCall(ww.w, 'PUT', `/v1/me/uploads/${uploadId}/categories`, { token: who.token, body: { lines: [{ index: 4, category: 'boodschappen' }] } })).status).toBe(200);
    const after = await insights();
    expect(after.perCategory).toEqual([
      { category: 'boodschappen', total: 597 + 378 },
      { category: 'huishouden', total: 499 },
      { category: 'dining', total: 827 - 378 },
      { category: 'statiegeld', total: 50 },
    ]);
    expect(after.vatPerRate).toEqual(before.vatPerRate);
  });

  it('the list filter finds a photo receipt by the category of any line, including one the buyer set', async () => {
    const who = await loginUser(ww.w);
    const { uploadId } = await uploadAndExtract(ww, who, corpusEntry(ww, GOOD));
    const ids = async (category: string) => ((await buyerCall(ww.w, 'GET', `/v1/me/uploads?category=${category}`, { token: who.token })).body as { items: Array<{ uploadId: string }> }).items.map((i) => i.uploadId);
    expect(await ids('huishouden')).toEqual([uploadId]);
    expect(await ids('vervoer')).toEqual([]);
    await buyerCall(ww.w, 'PUT', `/v1/me/uploads/${uploadId}/categories`, { token: who.token, body: { lines: [{ index: 0, category: 'vervoer' }] } });
    expect(await ids('vervoer')).toEqual([uploadId]);
  });

  it('DELETE removes the extracted upload row and its S3 object', async () => {
    const who = await loginUser(ww.w);
    const { uploadId, key } = await uploadAndExtract(ww, who, corpusEntry(ww, GOOD));
    expect(await ww.s3.head(key)).not.toBeNull();
    expect((await buyerCall(ww.w, 'DELETE', `/v1/me/uploads/${uploadId}`, { token: who.token })).status).toBe(204);
    expect(await ww.s3.head(key)).toBeNull();
    expect(await sql(ww.w, 'select 1 from buyer.uploads where id = $1', [uploadId])).toHaveLength(0);
    expect((await buyerCall(ww.w, 'GET', `/v1/me/uploads/${uploadId}`, { token: who.token })).status).toBe(404);
  });

  it('someone else’s upload cannot be deleted (404), nothing is removed', async () => {
    const mine = await loginUser(ww.w);
    const other = await loginUser(ww.w);
    const { uploadId, key } = await uploadAndExtract(ww, mine, corpusEntry(ww, GOOD));
    expect((await buyerCall(ww.w, 'DELETE', `/v1/me/uploads/${uploadId}`, { token: other.token })).status).toBe(404);
    expect(await ww.s3.head(key)).not.toBeNull();
    expect(await sql(ww.w, 'select 1 from buyer.uploads where id = $1', [uploadId])).toHaveLength(1);
  });

  it('HEIC uploads are refused before anything is stored (PDF is accepted)', async () => {
    const who = await loginUser(ww.w);
    for (const contentType of ['image/heic']) {
      expect((await buyerCall(ww.w, 'POST', '/v1/me/uploads', { token: who.token, body: { contentType, size: 1000 } })).status, contentType).toBe(400);
    }
    expect(await sql(ww.w, 'select 1 from buyer.uploads where user_id = $1', [who.userId])).toHaveLength(0);
  });
});

/** The wallet sends the editable fields only: the server derives category and sensitive, the client never decides them. */
function stripDerived(l: Line) {
  return Object.fromEntries(Object.entries(l).filter(([k]) => k !== 'category' && k !== 'sensitive'));
}
