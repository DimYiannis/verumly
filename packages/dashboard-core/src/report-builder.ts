import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { PARTIAL_GROUPS, PARTIAL_METRICS, REPORT_METRICS, reportSpec, reportViewBody, type ReportMetric, type ReportResult, type ReportRow, type ReportSpec, type ReportValues, type ReportView } from '@lr/schema';
import { tables, withOrg, type Db } from '@lr/db';
import { DashboardError } from './errors.ts';
import { requireRole, type Actor } from './roles.ts';

/**
 * The customisable report. One SQL statement per call: the latest version of every `paid` or `void` receipt in the period
 * (Europe/Amsterdam calendar days), grouped by whatever the merchant chose. Sales = paid, cancellations = void.
 */

const MAX_ROWS = 500;
const MAX_VIEWS = 30;
const TZ = 'Europe/Amsterdam';

const parse = (input: unknown): ReportSpec => {
  const v = reportSpec.safeParse(input);
  if (!v.success) throw new DashboardError('validation', v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return v.data;
};

interface Agg extends Record<string, unknown> {
  key: string;
  label: string | null;
  receipts: string;
  gross: string;
  net: string;
  vat: string;
  tip: string;
  rounding: string;
  cancelled: string;
  cancelled_gross: string;
  items: string;
}

const num = (v: string | null | undefined) => Number(v ?? 0);

function toValues(a: Agg): ReportValues {
  const receipts = num(a.receipts);
  const gross = num(a.gross);
  return {
    receipts,
    gross,
    net: num(a.net),
    vat: num(a.vat),
    tip: num(a.tip),
    rounding: num(a.rounding),
    cancelled: num(a.cancelled),
    cancelledGross: num(a.cancelled_gross),
    avgTicket: receipts > 0 ? Math.round(gross / receipts) : 0,
    items: num(a.items),
  };
}

/** The receipts of the period (latest version), already filtered. `local_ts` is the Amsterdam wall-clock time. */
function baseCte(from: string, to: string, spec: Pick<ReportSpec, 'locationId' | 'terminalId' | 'payment' | 'weekday'>): SQL {
  const parts: SQL[] = [
    sql`r.state in ('paid', 'fiscalised', 'void')`,
    sql`(v.created_on_terminal_at at time zone ${TZ})::date between ${from}::date and ${to}::date`,
  ];
  if (spec.locationId) parts.push(sql`r.location_id = ${spec.locationId}::uuid`);
  if (spec.terminalId) parts.push(sql`r.terminal_id = ${spec.terminalId}::uuid`);
  if (spec.weekday) parts.push(sql`extract(isodow from (v.created_on_terminal_at at time zone ${TZ}))::int = ${spec.weekday}`);
  if (spec.payment) parts.push(sql`exists (select 1 from jsonb_array_elements(v.payload->'payments') p where p->>'method' = ${spec.payment})`);
  return sql`
    select r.id, r.state, r.location_id, r.terminal_id, v.payload,
           (v.created_on_terminal_at at time zone ${TZ}) as local_ts
    from merchant.receipts r
    join merchant.receipt_versions v on v.receipt_id = r.id and v.version = r.current_version
    where ${sql.join(parts, sql` and `)}`;
}

const itemsOf = sql`(select coalesce(sum((l->>'qty')::numeric), 0) from jsonb_array_elements(b.payload->'lines') l where l->>'kind' = 'item')`;

/** Aggregates whose source is the receipt itself (totals of the signed receipt). */
const receiptAggs = sql`
  count(*) filter (where b.state in ('paid', 'fiscalised')) as receipts,
  coalesce(sum((b.payload->'totals'->>'gross')::bigint) filter (where b.state in ('paid', 'fiscalised')), 0) as gross,
  coalesce(sum((b.payload->'totals'->>'net')::bigint) filter (where b.state in ('paid', 'fiscalised')), 0) as net,
  coalesce(sum((b.payload->'totals'->>'vat')::bigint) filter (where b.state in ('paid', 'fiscalised')), 0) as vat,
  coalesce(sum((b.payload->'totals'->>'tip')::bigint) filter (where b.state in ('paid', 'fiscalised')), 0) as tip,
  coalesce(sum((b.payload->'totals'->>'rounding')::bigint) filter (where b.state in ('paid', 'fiscalised')), 0) as rounding,
  count(*) filter (where b.state = 'void') as cancelled,
  coalesce(sum((b.payload->'totals'->>'gross')::bigint) filter (where b.state = 'void'), 0) as cancelled_gross,
  coalesce(sum(${itemsOf}) filter (where b.state in ('paid', 'fiscalised')), 0) as items`;

async function totalsFor(tx: Pick<Db, 'execute'>, from: string, to: string, spec: ReportSpec): Promise<ReportValues> {
  const res = await tx.execute<Agg>(sql`
    with b as (${baseCte(from, to, spec)})
    select 'all' as key, null as label, ${receiptAggs} from b`);
  return toValues(res.rows[0] ?? ({ key: 'all' } as Agg));
}

function groupQuery(spec: ReportSpec): SQL {
  const base = baseCte(spec.from, spec.to, spec);
  const g = spec.groupBy;
  if (g === 'day' || g === 'week' || g === 'month' || g === 'weekday' || g === 'hour') {
    const key =
      g === 'day' ? sql`to_char(b.local_ts::date, 'YYYY-MM-DD')`
      : g === 'week' ? sql`to_char(b.local_ts, 'IYYY-"W"IW')`
      : g === 'month' ? sql`to_char(b.local_ts, 'YYYY-MM')`
      : g === 'weekday' ? sql`extract(isodow from b.local_ts)::int::text`
      : sql`lpad(extract(hour from b.local_ts)::int::text, 2, '0')`;
    return sql`with b as (${base}) select ${key} as key, null as label, ${receiptAggs} from b group by 1`;
  }
  if (g === 'location') {
    return sql`with b as (${base}) select b.location_id::text as key, max(l.name) as label, ${receiptAggs}
               from b join merchant.locations l on l.id = b.location_id group by 1`;
  }
  if (g === 'terminal') {
    return sql`with b as (${base}) select b.terminal_id::text as key, max(t.label) as label, ${receiptAggs}
               from b join merchant.terminals t on t.id = b.terminal_id group by 1`;
  }
  // groupings from a part of the receipt: only paid receipts, only the metrics that make sense (the rest stay 0)
  const zero = sql`0::bigint`;
  if (g === 'payment') {
    return sql`with b as (${base})
      select p->>'method' as key, null as label, count(distinct b.id) as receipts,
             coalesce(sum((p->>'amount')::bigint), 0) as gross, ${zero} as net, ${zero} as vat, ${zero} as tip, ${zero} as rounding,
             ${zero} as cancelled, ${zero} as cancelled_gross, ${zero} as items
      from b cross join lateral jsonb_array_elements(b.payload->'payments') p where b.state in ('paid', 'fiscalised') group by 1`;
  }
  if (g === 'vat_rate') {
    return sql`with b as (${base})
      select (row->>'rate') as key, null as label, count(distinct b.id) as receipts,
             coalesce(sum((row->>'gross')::bigint), 0) as gross, coalesce(sum((row->>'net')::bigint), 0) as net, coalesce(sum((row->>'vat')::bigint), 0) as vat,
             ${zero} as tip, ${zero} as rounding, ${zero} as cancelled, ${zero} as cancelled_gross, ${zero} as items
      from b cross join lateral jsonb_array_elements(b.payload->'vatSummary') row where b.state in ('paid', 'fiscalised') group by 1`;
  }
  if (g === 'item') {
    return sql`with b as (${base})
      select l->>'description' as key, null as label, count(distinct b.id) as receipts,
             coalesce(sum((l->>'total')::bigint), 0) as gross, ${zero} as net, ${zero} as vat, ${zero} as tip, ${zero} as rounding,
             ${zero} as cancelled, ${zero} as cancelled_gross,
             coalesce(sum((l->>'qty')::numeric) filter (where l->>'kind' = 'item'), 0) as items
      from b cross join lateral jsonb_array_elements(b.payload->'lines') l where b.state in ('paid', 'fiscalised') and l->>'kind' = 'item' group by 1`;
  }
  return sql`with b as (${base})
    select coalesce(l->>'category', 'uncategorised') as key, null as label, count(distinct b.id) as receipts,
           coalesce(sum((l->>'total')::bigint), 0) as gross, ${zero} as net, ${zero} as vat, ${zero} as tip, ${zero} as rounding,
           ${zero} as cancelled, ${zero} as cancelled_gross,
           coalesce(sum((l->>'qty')::numeric) filter (where l->>'kind' = 'item'), 0) as items
    from b cross join lateral jsonb_array_elements(b.payload->'lines') l where b.state in ('paid', 'fiscalised') group by 1`;
}

/** The period just before `from..to`, the same number of days long. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const day = 86_400_000;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  const days = Math.round((b - a) / day) + 1;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(a - days * day), to: iso(a - day) };
}

export async function runReport(db: Db, actor: Actor, input: unknown): Promise<ReportResult> {
  requireRole(actor, 'reports.read');
  const spec = parse(input);
  const days = (Date.parse(`${spec.to}T00:00:00Z`) - Date.parse(`${spec.from}T00:00:00Z`)) / 86_400_000;
  if (days > 366 * 5) throw new DashboardError('validation', 'the period can be at most 5 years');
  const wanted = new Set<ReportMetric>(spec.metrics);
  const pick = (v: ReportValues): ReportValues => Object.fromEntries(REPORT_METRICS.filter((m) => wanted.has(m)).map((m) => [m, v[m] ?? 0]));

  return withOrg(db, actor.orgId, async (tx) => {
    const res = await tx.execute<Agg>(groupQuery(spec));
    let rows: ReportRow[] = res.rows.map((a) => ({ key: a.key, label: a.label ?? a.key, values: pick(toValues(a)) }));

    const by = spec.sort?.by ?? (['day', 'week', 'month', 'weekday', 'hour'].includes(spec.groupBy) ? 'group' : 'gross');
    const dir = spec.sort?.dir ?? (by === 'group' ? 'asc' : 'desc');
    const mult = dir === 'asc' ? 1 : -1;
    rows.sort((x, y) => mult * (by === 'group' ? x.key.localeCompare(y.key, undefined, { numeric: true }) : (x.values[by] ?? 0) - (y.values[by] ?? 0)) || x.key.localeCompare(y.key));
    if (rows.length > MAX_ROWS) rows = rows.slice(0, MAX_ROWS);

    const totals = pick(await totalsFor(tx, spec.from, spec.to, spec));
    let previous: ReportResult['previous'] = null;
    if (spec.compare) {
      const p = previousPeriod(spec.from, spec.to);
      previous = { ...p, totals: pick(await totalsFor(tx, p.from, p.to, spec)) };
    }

    const notes: string[] = [];
    if ((PARTIAL_GROUPS as readonly string[]).includes(spec.groupBy)) {
      const ok = PARTIAL_METRICS[spec.groupBy] ?? [];
      const off = spec.metrics.filter((m) => !ok.includes(m));
      if (off.length) notes.push(`partial:${spec.groupBy}:${off.join(',')}`);
      notes.push('totals count each receipt once');
    }
    return { spec, rows, totals, previous, notes };
  });
}

// ---------------------------------------------------------------------------------------------- saved views

export async function listReportViews(db: Db, actor: Actor): Promise<ReportView[]> {
  requireRole(actor, 'reports.read');
  const rows = await withOrg(db, actor.orgId, (tx) => tx.select().from(tables.reportViews).orderBy(desc(tables.reportViews.createdAt)));
  return rows.flatMap((r) => {
    const spec = reportSpec.safeParse(r.spec);
    return spec.success ? [{ id: r.id, name: r.name, spec: spec.data, createdAt: r.createdAt.toISOString() }] : [];
  });
}

export async function createReportView(db: Db, actor: Actor, input: unknown): Promise<ReportView> {
  requireRole(actor, 'reports.read');
  const v = reportViewBody.safeParse(input);
  if (!v.success) throw new DashboardError('validation', v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return withOrg(db, actor.orgId, async (tx) => {
    const existing = await tx.select({ id: tables.reportViews.id }).from(tables.reportViews);
    if (existing.length >= MAX_VIEWS) throw new DashboardError('conflict', `at most ${MAX_VIEWS} saved views`);
    const [row] = await tx.insert(tables.reportViews).values({ orgId: actor.orgId, name: v.data.name, spec: v.data.spec, createdBy: actor.userId }).returning();
    return { id: row!.id, name: row!.name, spec: v.data.spec, createdAt: row!.createdAt.toISOString() };
  });
}

export async function deleteReportView(db: Db, actor: Actor, id: string): Promise<void> {
  requireRole(actor, 'reports.read');
  const done = await withOrg(db, actor.orgId, (tx) => tx.delete(tables.reportViews).where(and(eq(tables.reportViews.id, id), eq(tables.reportViews.orgId, actor.orgId))).returning({ id: tables.reportViews.id }));
  if (done.length === 0) throw new DashboardError('not_found', 'view not found');
}
