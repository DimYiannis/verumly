import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { tables } from '@lr/db';
import { FALLBACK_CATEGORY, HEALTH_CATEGORY } from '@lr/receipt-nl';
import type { AppDeps } from '../context.ts';
import { readExtracted } from '../uploads.ts';
import { mainCurrency } from '../currency.ts';
import { requireSession } from './auth.ts';
import { currentConsents } from './consents.ts';

const TOP_MERCHANTS = 10;
const AMSTERDAM_MONTH = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit' });

const monthOf = (d: Date) => {
  const parts = Object.fromEntries(AMSTERDAM_MONTH.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}`;
};

/**
 * Needs the `analytics` consent (the Settings "Insights" switch): without it the route answers 403 `consent_required`
 * and computes nothing.
 *
 * Refunds (receipts or uploads with a negative total) never enter the spend figures: months, categories, VAT and
 * merchants count purchases only, and the refunds are reported on their own as `refunds` (positive amount, count). A
 * category whose lines net out to zero or less is left out, so no share is ever negative.
 *
 * Spend per month, per category, top merchants and VAT per rate: nothing else (v2 §10). Counts the user's claimed
 * receipts that are final (`paid`/`fiscalised`; pre-bills and voids are not spending) and finished uploads. Upload
 * lines count under the category stored on the line (worker or buyer), never recomputed here. Health lines
 * (`sensitive`, or the health category) are reported under `overig`, so the insights never reveal a health category.
 */
export function insightRoutes(deps: AppDeps) {
  return async (app: FastifyInstance) => {
    app.get('/v1/me/insights', { preHandler: requireSession(deps) }, async (req, reply) => {
      const userId = req.session!.userId;
      if (!(await currentConsents(deps.db, userId)).analytics) return reply.code(403).send({ error: 'consent_required', purpose: 'analytics' });
      const currency = await mainCurrency(deps.db, userId);
      // dynamic keys (merchant names come from receipts): Maps, never plain objects
      const month = new Map<string, number>();
      const category = new Map<string, number>();
      const merchant = new Map<string, { total: number; count: number }>();
      const vat = new Map<number, number>();
      const refunds = { total: 0, count: 0 };
      const add = (map: Map<string, number>, key: string, v: number) => {
        map.set(key, (map.get(key) ?? 0) + v);
      };

      const perMonth = await deps.db.execute<{ m: string; total: string }>(sql`
        select to_char(r.created_on_terminal_at at time zone 'Europe/Amsterdam', 'YYYY-MM') as m, sum(r.total_minor)::bigint as total
        from buyer.claims c join merchant.receipts r on r.id = c.receipt_id
        where c.user_id = ${userId}::uuid and r.state in ('paid', 'fiscalised') and r.currency = ${currency} and r.total_minor >= 0
        group by 1`);
      for (const r of perMonth.rows) add(month, r.m, Number(r.total));

      const refunded = await deps.db.execute<{ total: string; n: string }>(sql`
        select coalesce(sum(-r.total_minor), 0)::bigint as total, count(*) as n
        from buyer.claims c join merchant.receipts r on r.id = c.receipt_id
        where c.user_id = ${userId}::uuid and r.state in ('paid', 'fiscalised') and r.currency = ${currency} and r.total_minor < 0`);
      refunds.total += Number(refunded.rows[0]?.total ?? 0);
      refunds.count += Number(refunded.rows[0]?.n ?? 0);

      const perCategory = await deps.db.execute<{ cat: string; total: string }>(sql`
        select case when l.sensitive then ${FALLBACK_CATEGORY} else coalesce(l.category, ${FALLBACK_CATEGORY}) end as cat, sum(l.total_minor)::bigint as total
        from buyer.claims c
        join merchant.receipts r on r.id = c.receipt_id
        join merchant.receipt_lines l on l.receipt_id = r.id
        where c.user_id = ${userId}::uuid and r.state in ('paid', 'fiscalised') and r.currency = ${currency} and r.total_minor >= 0
        group by 1`);
      for (const r of perCategory.rows) add(category, r.cat, Number(r.total));

      const perVat = await deps.db.execute<{ rate: number; vat: string }>(sql`
        select (e->>'rate')::numeric as rate, sum((e->>'vat')::bigint)::bigint as vat
        from buyer.claims c
        join merchant.receipts r on r.id = c.receipt_id
        join merchant.receipt_versions v on v.receipt_id = r.id and v.version = r.current_version
        cross join lateral jsonb_array_elements(v.payload->'vatSummary') e
        where c.user_id = ${userId}::uuid and r.state in ('paid', 'fiscalised') and r.currency = ${currency} and r.total_minor >= 0
        group by 1`);
      for (const r of perVat.rows) vat.set(Number(r.rate), (vat.get(Number(r.rate)) ?? 0) + Number(r.vat));

      const perMerchant = await deps.db.execute<{ name: string; total: string; n: string }>(sql`
        select v.payload->'merchant'->>'name' as name, sum(r.total_minor)::bigint as total, count(*) as n
        from buyer.claims c
        join merchant.receipts r on r.id = c.receipt_id
        join merchant.receipt_versions v on v.receipt_id = r.id and v.version = r.current_version
        where c.user_id = ${userId}::uuid and r.state in ('paid', 'fiscalised') and r.currency = ${currency} and r.total_minor >= 0
        group by 1`);
      for (const r of perMerchant.rows) merchant.set(r.name, { total: Number(r.total), count: Number(r.n) });

      // uploaded photos are Dutch receipts: they only count towards totals in euro
      const uploads = currency !== 'EUR' ? [] : await deps.db
        .select({ extracted: tables.uploads.extracted, createdAt: tables.uploads.createdAt })
        .from(tables.uploads)
        .where(and(eq(tables.uploads.userId, userId), eq(tables.uploads.status, 'done')));
      for (const u of uploads) {
        const parsed = readExtracted(u)?.parsed;
        if (!parsed || parsed.gross === null) continue;
        if (parsed.gross < 0) {
          refunds.total -= parsed.gross;
          refunds.count += 1;
          continue;
        }
        add(month, monthOf(parsed.printedAtUtc ? new Date(parsed.printedAtUtc) : u.createdAt), parsed.gross);
        for (const l of parsed.lines) {
          const stored = l.category ?? FALLBACK_CATEGORY;
          add(category, l.sensitive || stored === HEALTH_CATEGORY ? FALLBACK_CATEGORY : stored, l.total);
        }
        for (const b of parsed.vatBreakdown) vat.set(b.rate, (vat.get(b.rate) ?? 0) + b.vat);
        const name = parsed.merchant.name ?? 'Onbekend';
        const m = merchant.get(name) ?? { total: 0, count: 0 };
        merchant.set(name, { total: m.total + parsed.gross, count: m.count + 1 });
      }

      return {
        currency,
        perMonth: [...month.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, total]) => ({ month: m, total })),
        perCategory: [...category.entries()].filter(([, total]) => total > 0).sort(([, a], [, b]) => b - a).map(([c, total]) => ({ category: c, total })),
        vatPerRate: [...vat.entries()].sort(([a], [b]) => b - a).map(([rate, total]) => ({ rate, vat: total })),
        topMerchants: [...merchant.entries()]
          .sort(([, a], [, b]) => b.total - a.total)
          .slice(0, TOP_MERCHANTS)
          .map(([merchantName, v]) => ({ merchantName, total: v.total, count: v.count })),
        refunds,
      };
    });
  };
}
