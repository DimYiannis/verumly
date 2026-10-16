import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import webpush from 'web-push';
import { tables } from '@lr/db';
import type { NotifyVersionJob } from '@lr/db';
import { isFinalState } from '@lr/receipt-nl';
import { crf as crfSchema, type Crf } from '@lr/schema';
import type { WorkerCtx } from '../context.ts';

export interface NotifyOutcome {
  sent: number;
  removed: number;
  failed: number;
  skipped: 'no_claim' | 'no_vapid' | 'no_version' | null;
}

/** The (encrypted) payload the wallet's service worker shows. It carries the merchant name only, never amounts or lines. */
export interface PushPayload {
  title: string;
  body: string;
  receiptId: string;
  version: number;
  final: boolean;
}

export function pushPayload(crf: Crf, job: NotifyVersionJob): PushPayload {
  const final = isFinalState(crf.state, crf.fiscal.country);
  const merchant = crf.merchant.name;
  if (crf.state === 'void') {
    return { title: 'Bon vervallen', body: `${merchant}: deze bon is vervallen.`, receiptId: job.receiptId, version: job.version, final };
  }
  if (final) {
    return { title: 'Bon definitief', body: `${merchant}: je bon is betaald en definitief.`, receiptId: job.receiptId, version: job.version, final };
  }
  return { title: 'Bon bijgewerkt', body: `${merchant}: je bon is bijgewerkt (nog niet definitief).`, receiptId: job.receiptId, version: job.version, final };
}

/** Push services coalesce messages with the same Topic, so a retried job cannot show two notifications. */
const topicFor = (receiptId: string, version: number) => createHash('sha256').update(`${receiptId}:${version}`).digest('base64url').slice(0, 32);

/**
 * On a new version of a claimed receipt, Web Push every subscription of the owner. Subscriptions answering 404/410 are
 * deleted. Never logs the payload, endpoints or keys. Other failures (5xx, network) throw after all subscriptions were
 * tried, so pg-boss retries; the Topic header keeps a retry from duplicating a delivered notification.
 *
 * Uses `generateRequestDetails` + `fetch` instead of `sendNotification` so plain-http local test endpoints work.
 */
export async function notifyVersion(ctx: WorkerCtx, job: NotifyVersionJob): Promise<NotifyOutcome> {
  const none = (skipped: NotifyOutcome['skipped']): NotifyOutcome => ({ sent: 0, removed: 0, failed: 0, skipped });
  const [claim] = await ctx.db.select({ userId: tables.claims.userId }).from(tables.claims).where(eq(tables.claims.receiptId, job.receiptId));
  if (!claim) return none('no_claim');
  if (!ctx.vapid) return none('no_vapid');

  const [version] = await ctx.db
    .select({ payload: tables.receiptVersions.payload })
    .from(tables.receiptVersions)
    .where(and(eq(tables.receiptVersions.receiptId, job.receiptId), eq(tables.receiptVersions.version, job.version)));
  if (!version) return none('no_version');
  const payload = JSON.stringify(pushPayload(crfSchema.parse(version.payload), job));

  const subs = await ctx.db
    .select({ id: tables.pushSubscriptions.id, endpoint: tables.pushSubscriptions.endpoint, p256dh: tables.pushSubscriptions.p256dh, auth: tables.pushSubscriptions.auth })
    .from(tables.pushSubscriptions)
    .innerJoin(tables.users, eq(tables.users.id, tables.pushSubscriptions.userId))
    .where(and(eq(tables.pushSubscriptions.userId, claim.userId), isNull(tables.users.deletedAt)));

  const out: NotifyOutcome = { sent: 0, removed: 0, failed: 0, skipped: null };
  for (const sub of subs) {
    try {
      const req = webpush.generateRequestDetails({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
        vapidDetails: ctx.vapid,
        TTL: 24 * 3600,
        urgency: 'high',
        topic: topicFor(job.receiptId, job.version),
      });
      const res = await fetch(req.endpoint, { method: req.method, headers: req.headers, body: req.body, signal: AbortSignal.timeout(10_000) });
      if (res.status === 404 || res.status === 410) {
        await ctx.db.delete(tables.pushSubscriptions).where(eq(tables.pushSubscriptions.id, sub.id));
        out.removed++;
      } else if (res.ok) {
        await ctx.db.update(tables.pushSubscriptions).set({ lastSeenAt: ctx.now() }).where(eq(tables.pushSubscriptions.id, sub.id));
        out.sent++;
      } else {
        out.failed++;
      }
    } catch {
      // endpoint, keys and payload are deliberately not logged
      out.failed++;
    }
  }
  ctx.log('notify_version', { receiptId: job.receiptId, version: job.version, sent: out.sent, removed: out.removed, failed: out.failed });
  if (out.failed > 0) throw new Error(`push failed for ${out.failed} subscription(s)`);
  return out;
}
