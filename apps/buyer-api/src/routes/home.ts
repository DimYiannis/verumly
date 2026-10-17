import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ActivityItem, HomeSummary } from '@lr/schema';
import type { AppDeps } from '../context.ts';
import { publicUsers, userOrGhost } from '../social.ts';
import { requireSession } from './auth.ts';

const TZ = 'Europe/Amsterdam';
const FINAL = sql`('paid', 'fiscalised')`;

/** The wallet home (this month so far, the latest receipts) and the friends feed. Buyer side only. */
export function homeRoutes(deps: AppDeps) {
  return async (app: FastifyInstance) => {
    app.addHook('preHandler', requireSession(deps));
    const db = deps.db;

    app.get('/v1/me/home', async (req): Promise<HomeSummary> => {
      const me = req.session!.userId;
      const clock = await db.execute<{ month: string; dom: number; dim: number }>(sql`
        select to_char(now() at time zone ${TZ}, 'YYYY-MM') as month,
               extract(day from now() at time zone ${TZ})::int as dom,
               extract(day from (date_trunc('month', now() at time zone ${TZ}) + interval '1 month - 1 day'))::int as dim`);
      const { month, dom, dim } = clock.rows[0]!;

      const perDay = await db.execute<{ d: number; total: string; n: string }>(sql`
        select extract(day from r.created_on_terminal_at at time zone ${TZ})::int as d, sum(r.total_minor)::bigint as total, count(*) as n
        from buyer.claims c join merchant.receipts r on r.id = c.receipt_id
        where c.user_id = ${me}::uuid and r.state in ${FINAL}
          and to_char(r.created_on_terminal_at at time zone ${TZ}, 'YYYY-MM') = ${month}
        group by 1`);
      const daily = Array.from({ length: dom }, () => 0);
      let total = 0;
      let receipts = 0;
      for (const r of perDay.rows) {
        if (r.d >= 1 && r.d <= dom) daily[r.d - 1] = Number(r.total);
        total += Number(r.total);
        receipts += Number(r.n);
      }

      const prev = await db.execute<{ total: string | null }>(sql`
        select sum(r.total_minor)::bigint as total
        from buyer.claims c join merchant.receipts r on r.id = c.receipt_id
        where c.user_id = ${me}::uuid and r.state in ${FINAL}
          and to_char(r.created_on_terminal_at at time zone ${TZ}, 'YYYY-MM') = to_char((now() at time zone ${TZ}) - interval '1 month', 'YYYY-MM')
          and extract(day from r.created_on_terminal_at at time zone ${TZ}) <= ${dom}`);

      const recent = await db.execute<{ id: string; name: string; total: number; at: Date; state: string; items: string; with: string[] | null }>(sql`
        select r.id, v.payload->'merchant'->>'name' as name, r.total_minor as total, r.created_on_terminal_at as at, r.state,
               (select coalesce(sum((l->>'qty')::numeric), 0) from jsonb_array_elements(v.payload->'lines') l where l->>'kind' = 'item')::text as items,
               (select array_agg(distinct coalesce(u.display_name, u.handle, '?'))
                  from buyer.splits s join buyer.split_shares ss on ss.split_id = s.id
                  left join buyer.users u on u.id = ss.user_id
                  where s.receipt_id = r.id and (s.creator_id = ${me}::uuid or exists (select 1 from buyer.split_shares x where x.split_id = s.id and x.user_id = ${me}::uuid))
                    and (ss.user_id is null or ss.user_id <> ${me}::uuid)) as with
        from buyer.claims c
        join merchant.receipts r on r.id = c.receipt_id
        join merchant.receipt_versions v on v.receipt_id = r.id and v.version = r.current_version
        where c.user_id = ${me}::uuid and r.state in ('paid', 'fiscalised', 'void')
        order by r.created_on_terminal_at desc limit 8`);

      return {
        month,
        dayOfMonth: dom,
        daysInMonth: dim,
        currency: 'EUR',
        total,
        receipts,
        previousToDate: Number(prev.rows[0]?.total ?? 0),
        daily,
        recent: recent.rows.map((x) => ({
          receiptId: x.id,
          merchantName: x.name,
          total: Number(x.total),
          createdAt: new Date(x.at).toISOString(),
          state: x.state,
          splitWith: x.with ?? [],
          itemCount: Math.round(Number(x.items)),
        })),
      };
    });

    app.get('/v1/me/activity', async (req) => {
      const me = req.session!.userId;
      const items: ActivityItem[] = [];
      const ids = new Set<string>();
      const base = { merchantName: null, amountMinor: null, emoji: null, splitId: null, shareId: null, requestId: null, receiptId: null };
      const push = (i: Partial<ActivityItem> & Pick<ActivityItem, 'id' | 'kind' | 'at'> & { other?: string | null }) => {
        if (i.other) ids.add(i.other);
        items.push({ ...base, user: null, ...i } as ActivityItem & { other?: string | null });
      };

      const friends = await db.execute<{ id: string; other: string; req: string; at: Date; status: string }>(sql`
        select f.id, case when f.requester_id = ${me}::uuid then f.addressee_id else f.requester_id end as other,
               f.requester_id as req, coalesce(f.responded_at, f.created_at) as at, f.status
        from buyer.friendships f where f.requester_id = ${me}::uuid or f.addressee_id = ${me}::uuid
        order by 4 desc limit 20`);
      for (const f of friends.rows) {
        if (f.status === 'accepted') push({ id: `f-${f.id}`, kind: 'friend_added', at: new Date(f.at).toISOString(), other: f.other });
        else if (f.req !== me) push({ id: `fr-${f.id}`, kind: 'friend_request', at: new Date(f.at).toISOString(), requestId: f.id, other: f.other });
      }

      const shares = await db.execute<{ id: string; from_user_id: string; at: Date; receipt_id: string; name: string | null; total: number | null }>(sql`
        select s.id, s.from_user_id, s.created_at as at, s.receipt_id, v.payload->'merchant'->>'name' as name, r.total_minor as total
        from buyer.receipt_shares s
        left join merchant.receipts r on r.id = s.receipt_id
        left join merchant.receipt_versions v on v.receipt_id = r.id and v.version = r.current_version
        where s.to_user_id = ${me}::uuid order by s.created_at desc limit 20`);
      for (const s of shares.rows) push({ id: `s-${s.id}`, kind: 'share_received', at: new Date(s.at).toISOString(), shareId: s.id, receiptId: s.receipt_id, merchantName: s.name, amountMinor: s.total === null ? null : Number(s.total), other: s.from_user_id });

      const splits = await db.execute<{ id: string; creator_id: string; at: Date; receipt_id: string; name: string | null; mine: number | null; open: string }>(sql`
        select s.id, s.creator_id, s.created_at as at, s.receipt_id, v.payload->'merchant'->>'name' as name,
               (select ss.amount_minor from buyer.split_shares ss where ss.split_id = s.id and ss.user_id = ${me}::uuid) as mine,
               (select coalesce(sum(ss.amount_minor), 0) from buyer.split_shares ss where ss.split_id = s.id and ss.settled_at is null and ss.user_id is distinct from s.creator_id)::text as open
        from buyer.splits s
        left join merchant.receipts r on r.id = s.receipt_id
        left join merchant.receipt_versions v on v.receipt_id = r.id and v.version = r.current_version
        where s.creator_id = ${me}::uuid or exists (select 1 from buyer.split_shares x where x.split_id = s.id and x.user_id = ${me}::uuid)
        order by s.created_at desc limit 20`);
      for (const s of splits.rows) {
        if (s.creator_id === me) push({ id: `sc-${s.id}`, kind: 'split_created', at: new Date(s.at).toISOString(), splitId: s.id, receiptId: s.receipt_id, merchantName: s.name, amountMinor: Number(s.open) });
        else push({ id: `sw-${s.id}`, kind: 'split_with_me', at: new Date(s.at).toISOString(), splitId: s.id, receiptId: s.receipt_id, merchantName: s.name, amountMinor: s.mine === null ? null : Number(s.mine), other: s.creator_id });
      }

      const settled = await db.execute<{ id: string; split_id: string; who: string | null; creator_id: string; at: Date; amount: number; name: string | null }>(sql`
        select ss.id, s.id as split_id, ss.user_id as who, s.creator_id, ss.settled_at as at, ss.amount_minor as amount, v.payload->'merchant'->>'name' as name
        from buyer.split_shares ss join buyer.splits s on s.id = ss.split_id
        left join merchant.receipts r on r.id = s.receipt_id
        left join merchant.receipt_versions v on v.receipt_id = r.id and v.version = r.current_version
        where ss.settled_at is not null and ss.user_id is distinct from s.creator_id and (s.creator_id = ${me}::uuid or ss.user_id = ${me}::uuid)
        order by ss.settled_at desc limit 20`);
      for (const x of settled.rows) {
        if (x.creator_id === me) push({ id: `p-${x.id}`, kind: 'paid_you', at: new Date(x.at).toISOString(), splitId: x.split_id, merchantName: x.name, amountMinor: Number(x.amount), other: x.who });
        else push({ id: `y-${x.id}`, kind: 'you_settled', at: new Date(x.at).toISOString(), splitId: x.split_id, merchantName: x.name, amountMinor: Number(x.amount), other: x.creator_id });
      }

      const reactions = await db.execute<{ share_id: string; user_id: string; emoji: string; at: Date; name: string | null }>(sql`
        select rr.share_id, rr.user_id, rr.emoji, rr.created_at as at, v.payload->'merchant'->>'name' as name
        from buyer.share_reactions rr join buyer.receipt_shares s on s.id = rr.share_id
        left join merchant.receipts r on r.id = s.receipt_id
        left join merchant.receipt_versions v on v.receipt_id = r.id and v.version = r.current_version
        where s.from_user_id = ${me}::uuid and rr.user_id <> ${me}::uuid order by rr.created_at desc limit 20`);
      for (const x of reactions.rows) push({ id: `r-${x.share_id}-${x.user_id}`, kind: 'reaction', at: new Date(x.at).toISOString(), shareId: x.share_id, merchantName: x.name, emoji: x.emoji, other: x.user_id });

      const users = await publicUsers(db, [...ids]);
      const out = items
        .map((i) => {
          const other = (i as ActivityItem & { other?: string | null }).other;
          const { other: _o, ...rest } = i as ActivityItem & { other?: string | null };
          return { ...rest, user: other ? userOrGhost(users, other) : null };
        })
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 40);
      return { items: out };
    });
  };
}
