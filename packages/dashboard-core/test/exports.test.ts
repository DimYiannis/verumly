import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUEUES, tables } from '@lr/db';
import { listExports, makeS3, requestExport, type Actor } from '../src/index.ts';
import { fixture, userWithRole, type Fixture } from './helpers.ts';

let f: Fixture;
let owner: Actor;
let other: Actor;
const sent: Array<{ queue: string; data: unknown }> = [];
const boss = {
  send: async (queue: string, data: unknown) => {
    sent.push({ queue, data });
    return 'id';
  },
};
const s3 = { client: makeS3({ endpoint: 'http://127.0.0.1:9090', region: 'eu-west-1', bucket: 'receipts', accessKey: 'k', secretKey: 's' }), bucket: 'receipts' };

beforeAll(async () => {
  f = await fixture('dc_exp');
  owner = (await userWithRole(f, 0, 'owner')).actor;
  other = (await userWithRole(f, 1, 'owner')).actor;
});
afterAll(() => f.close());

describe('exports', () => {
  it('queues a job, and lists a 24h link only once the worker marked it done', async () => {
    const e = await requestExport(f.dash.db, boss, owner, { kind: 'btw_csv', from: '2026-01-01', to: '2026-03-31' });
    expect(sent).toEqual([{ queue: QUEUES.export, data: { exportId: e.id } }]);
    let [row] = await listExports(f.dash.db, owner, s3);
    expect(row).toMatchObject({ id: e.id, status: 'queued', kind: 'btw_csv', periodFrom: '2026-01-01', periodTo: '2026-03-31', link: null });

    await f.admin.update(tables.exportsTable).set({ status: 'done', s3Key: `exports/${owner.orgId}/${e.id}.csv` }).where(eq(tables.exportsTable.id, e.id));
    [row] = await listExports(f.dash.db, owner, s3);
    const url = new URL(row!.link!);
    expect(url.pathname).toBe(`/receipts/exports/${owner.orgId}/${e.id}.csv`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('86400');
    expect(row!.linkExpiresAt).toBeInstanceOf(Date);

    expect(await listExports(f.dash.db, other, s3)).toEqual([]);
  });

  it('validates kind and period', async () => {
    for (const bad of [{ kind: 'nope', from: '2026-01-01', to: '2026-01-02' }, { kind: 'btw_csv', from: '2026-02-01', to: '2026-01-02' }, { kind: 'btw_csv', from: 'x', to: '2026-01-02' }]) {
      await expect(requestExport(f.dash.db, boss, owner, bad)).rejects.toMatchObject({ code: 'validation' });
    }
  });
});
