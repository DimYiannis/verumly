<script setup lang="ts">
import { validateSetup } from '@lr/compliance';
import type { ReportResult, ReportSpec } from '@lr/schema';
import { USUAL_WEEKS, addDays, amsterdamNow, countWeekday, cumulative, hourlyGross, isLate, isOnline } from '~/lib/overview';

definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Row { id: string; locationName: string; state: string; currentVersion: number; totalMinor: number; createdAt: string; receivedAt: string }
interface Term { id: string; label: string; locationName: string; lastSeenAt: string | null; revokedAt: string | null }
interface Loc { id: string; name: string }
interface Org { country: string; kvkNumber: string; vatNumber: string | null; compliance: { country: string; values: Record<string, string | boolean>; confirmedAt: string | null } }

const { t, intlLocale } = useLocale();
const session = sessionState();
const canTerminals = computed(() => session.value.user?.role !== 'accountant');

const locations = ref<Loc[]>([]);
const selected = ref<string>('');
const today = ref<ReportResult | null>(null);
const usual = ref<ReportResult | null>(null);
const items = ref<ReportResult | null>(null);
const terminals = ref<Term[]>([]);
const recent = ref<Row[]>([]);
const org = ref<Org | null>(null);
const template = ref<{ template: { logo: string | null } | null } | null>(null);
const error = ref('');
const loaded = ref(false);
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
let seq = 0;

const ams = computed(() => amsterdamNow(new Date(now.value)));
const intl = (opts: Intl.DateTimeFormatOptions, d = new Date(now.value)) => new Intl.DateTimeFormat(intlLocale.value, { timeZone: 'Europe/Amsterdam', ...opts }).format(d);
const weekdayName = computed(() => intl({ weekday: 'long' }));
const title = computed(() => t('ov.title', { date: intl({ weekday: 'long', day: 'numeric', month: 'long' }) }));
const timeOf = (iso: string) => intl({ hour: '2-digit', minute: '2-digit' }, new Date(iso));

async function loadAll() {
  const mine = ++seq;
  now.value = Date.now();
  const day = ams.value.ymd;
  const loc = selected.value ? { locationId: selected.value } : {};
  const run = (spec: Pick<ReportSpec, 'from' | 'to' | 'groupBy' | 'metrics'> & { weekday?: number }) =>
    attempt(error, () => $fetch<ReportResult>('/api/dashboard/reports/run', { method: 'POST', body: { ...spec, ...loc } }));
  const locName = locations.value.find((l) => l.id === selected.value)?.name;
  const [a, b, c, terms, rec, o, tpl] = await Promise.all([
    run({ from: day, to: day, groupBy: 'hour', metrics: ['gross', 'receipts', 'cancelled'] }),
    run({ from: addDays(day, -28), to: addDays(day, -1), groupBy: 'hour', metrics: ['gross'], weekday: ams.value.isoWeekday }),
    run({ from: day, to: day, groupBy: 'item', metrics: ['items', 'gross'] }),
    canTerminals.value ? $fetch<Term[]>('/api/dashboard/terminals').catch(() => null) : Promise.resolve(null),
    // the archive has no location filter: fetch more and narrow down here
    attempt(error, () => $fetch<Row[]>('/api/dashboard/archive', { query: { limit: locName ? 60 : 8 } })),
    $fetch<Org>('/api/dashboard/org').catch(() => null),
    $fetch<{ template: { logo: string | null } | null }>('/api/dashboard/receipt-template').catch(() => null),
  ]);
  if (mine !== seq) return;
  if (a) today.value = a;
  if (b) usual.value = b;
  if (c) items.value = c;
  if (terms) terminals.value = terms;
  if (rec) recent.value = locName ? rec.filter((r) => r.locationName === locName).slice(0, 8) : rec;
  org.value = o;
  template.value = tpl;
  loaded.value = true;
}

function tick() {
  if (!document.hidden) void loadAll();
}
onMounted(async () => {
  const locs = await attempt(error, () => $fetch<Loc[]>('/api/dashboard/locations'));
  if (locs) locations.value = locs;
  await loadAll();
  timer = setInterval(tick, 30_000);
});
onBeforeUnmount(() => clearInterval(timer));
watch(selected, () => void loadAll());

// terminals
const activeTerminals = computed(() => terminals.value.filter((x) => !x.revokedAt));
const online = (x: Term) => isOnline(x.lastSeenAt, now.value);
const offlineTerminals = computed(() => activeTerminals.value.filter((x) => x.lastSeenAt && !online(x)));
function relative(iso: string | null) {
  if (!iso) return '';
  const mins = Math.min(0, Math.round((new Date(iso).getTime() - now.value) / 60_000));
  const f = new Intl.RelativeTimeFormat(intlLocale.value, { numeric: 'auto' });
  if (Math.abs(mins) < 60) return f.format(mins, 'minute');
  if (Math.abs(mins) < 1440) return f.format(Math.round(mins / 60), 'hour');
  return f.format(Math.round(mins / 1440), 'day');
}

// needs a look
interface Att { key: string; variant: 'danger' | 'warning'; tag: string; text: string; to?: string }
const setupIncomplete = computed(() => {
  const o = org.value;
  if (!o) return false;
  const sameCountry = o.compliance?.country === o.country;
  const problems = validateSetup(o.country, { companyId: o.kvkNumber || null, vatId: o.vatNumber }, sameCountry ? (o.compliance.values ?? {}) : {});
  return problems.some((p) => p.endsWith(': required')) || !sameCountry || !o.compliance?.confirmedAt;
});
const attention = computed<Att[]>(() => {
  const out: Att[] = [];
  const cancelled = today.value?.totals.cancelled ?? 0;
  if (cancelled > 0) out.push({ key: 'cancelled', variant: 'danger', tag: t('ov.tag.cancelled'), text: t('ov.att.cancelled', { n: cancelled }), to: '/dashboard/archive?state=void' });
  if (setupIncomplete.value) out.push({ key: 'setup', variant: 'warning', tag: t('ov.tag.setup'), text: t('ov.att.setup'), to: '/dashboard/organisation' });
  if (template.value && (!template.value.template || !template.value.template.logo)) out.push({ key: 'design', variant: 'warning', tag: t('ov.tag.design'), text: t('ov.att.design'), to: '/dashboard/template' });
  if (offlineTerminals.value.length) out.push({ key: 'offline', variant: 'warning', tag: t('ov.tag.offline'), text: t('ov.att.offline', { n: offlineTerminals.value.length }), to: '/dashboard/terminals' });
  return out;
});

// top items
const topItems = computed(() =>
  (items.value?.rows ?? [])
    .map((r) => ({ label: r.label, n: r.values.items ?? 0 }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 4),
);

// chart
const W = 900;
const H = 150;
const PAD = 12;
const usualWeeks = computed(() => countWeekday(addDays(ams.value.ymd, -28), addDays(ams.value.ymd, -1), ams.value.isoWeekday) || USUAL_WEEKS);
const todayCum = computed(() => cumulative(hourlyGross(today.value?.rows ?? [])));
const usualCum = computed(() => cumulative(hourlyGross(usual.value?.rows ?? [], usualWeeks.value)));
const hasChartData = computed(() => (todayCum.value[23] ?? 0) > 0 || (usualCum.value[23] ?? 0) > 0);
const span = computed(() => {
  const firstWith = (c: number[]) => c.findIndex((v) => v > 0);
  // the hour where the running total reaches its final value
  const lastWith = (c: number[]) => c.findIndex((v) => v > 0 && v === c[23]);
  const firsts = [firstWith(todayCum.value), firstWith(usualCum.value)].filter((i) => i >= 0);
  const start = Math.min(8, ...firsts);
  const end = Math.min(23, Math.max(ams.value.hour, lastWith(usualCum.value), start + 6));
  return { start, end };
});
const curHour = computed(() => Math.min(Math.max(ams.value.hour, span.value.start), span.value.end));
const yMax = computed(() => Math.max(1, todayCum.value[curHour.value] ?? 0, ...usualCum.value.slice(span.value.start, span.value.end + 1)));
const xAt = (h: number) => ((h - span.value.start) / Math.max(span.value.end - span.value.start, 1)) * W;
const yAt = (v: number) => H - PAD - (v / yMax.value) * (H - 2 * PAD);
const pts = (cum: number[], from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${xAt(from + i).toFixed(1)},${yAt(cum[from + i] ?? 0).toFixed(1)}`).join(' ');
const usualPoints = computed(() => pts(usualCum.value, span.value.start, span.value.end));
const todayPoints = computed(() => pts(todayCum.value, span.value.start, curHour.value));
const dot = computed(() => ({ x: xAt(curHour.value), y: yAt(todayCum.value[curHour.value] ?? 0) }));
const hourLabels = computed(() => {
  const { start, end } = span.value;
  const stepH = Math.max(1, Math.ceil((end - start) / 5));
  const out: string[] = [];
  for (let h = start; h <= end; h += stepH) out.push(`${String(h).padStart(2, '0')}:00`);
  return out;
});
const caption = computed(() => {
  const todaySoFar = euro(Math.round(todayCum.value[ams.value.hour] ?? 0));
  const usualSoFar = usualCum.value[ams.value.hour] ?? 0;
  return usualSoFar > 0 ? t('ov.caption', { today: todaySoFar, usual: euro(Math.round(usualSoFar)), weekday: weekdayName.value }) : t('ov.captionNoUsual', { today: todaySoFar, weekday: weekdayName.value });
});
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <AppPageHeading :title="title" />
    <Badge v-if="loaded" :variant="attention.length ? 'warning' : 'success'" class="mr-2" data-testid="overview-status">● {{ attention.length ? t('ov.statusAttention', { n: attention.length }) : t('ov.statusOk') }}</Badge>
  </div>
  <div class="flex flex-wrap items-center gap-2 px-2">
    <button v-for="c in [{ id: '', name: t('ov.allLocations') }, ...locations]" :key="c.id" type="button" data-testid="overview-location" :aria-pressed="selected === c.id"
      class="rounded-full border px-3 py-1 text-sm font-medium transition-colors"
      :class="selected === c.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-text-secondary hover:bg-muted'" @click="selected = c.id">{{ c.name }}</button>
  </div>
  <AppErrorNote v-if="error" data-testid="error">{{ error }}</AppErrorNote>

  <Card>
    <CardContent class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ t('ov.chartTitle') }}</span>
        <span class="text-xs text-muted-foreground">{{ t('ov.chartVs', { weekday: weekdayName }) }}</span>
      </div>
      <template v-if="hasChartData">
        <svg :viewBox="`0 0 ${W} ${H}`" class="h-auto w-full" role="img" :aria-label="caption" data-testid="overview-chart">
          <polyline fill="none" stroke="var(--chart-3)" stroke-width="2" stroke-dasharray="5 5" :points="usualPoints" />
          <polyline fill="none" stroke="var(--chart-1)" stroke-width="3" stroke-linejoin="round" :points="todayPoints" />
          <circle :cx="dot.x" :cy="dot.y" r="5" fill="var(--chart-1)" />
        </svg>
        <div class="flex items-center justify-between text-xs text-muted-foreground" aria-hidden="true"><span v-for="l in hourLabels" :key="l">{{ l }}</span></div>
        <p class="text-sm text-text-secondary" data-testid="overview-chart-caption">{{ caption }}</p>
      </template>
      <p v-else-if="loaded" class="flex h-[150px] items-center justify-center text-sm text-muted-foreground">{{ t('ov.noSalesToday') }}</p>
    </CardContent>
  </Card>

  <div class="grid gap-4 lg:grid-cols-3">
    <Card v-if="canTerminals">
      <CardContent class="flex flex-col gap-3">
        <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ t('ov.terminals') }}</span>
        <div v-for="x in activeTerminals" :key="x.id" class="flex items-center justify-between gap-2 text-sm" data-testid="overview-terminal">
          <span class="truncate">{{ x.locationName }} · {{ x.label }}</span>
          <Badge v-if="online(x)" variant="success">{{ t('ov.online') }}</Badge>
          <Badge v-else variant="warning">{{ x.lastSeenAt ? t('ov.offlineSince', { when: relative(x.lastSeenAt) }) : t('ov.neverSeen') }}</Badge>
        </div>
        <p v-if="loaded && !activeTerminals.length" class="text-sm text-muted-foreground">{{ t('ov.noTerminals') }}</p>
        <span v-if="activeTerminals.length" class="text-xs text-muted-foreground">{{ t('ov.terminalsNote') }}</span>
      </CardContent>
    </Card>

    <Card>
      <CardContent class="flex flex-col gap-3">
        <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ t('ov.attention') }}</span>
        <NuxtLink v-for="a in attention" :key="a.key" :to="a.to ?? '#'" class="flex items-center gap-2 text-sm hover:underline" data-testid="overview-attention">
          <Badge :variant="a.variant">{{ a.tag }}</Badge><span class="min-w-0 flex-1">{{ a.text }}</span>
        </NuxtLink>
        <p v-if="loaded && !attention.length" class="text-sm text-muted-foreground" data-testid="overview-attention-none">{{ t('ov.nothingAttention') }}</p>
      </CardContent>
    </Card>

    <Card>
      <CardContent class="flex flex-col gap-3">
        <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ t('ov.topItems') }}</span>
        <div v-for="i in topItems" :key="i.label" class="flex items-center justify-between gap-2 text-sm" data-testid="overview-top-item">
          <span class="truncate">{{ i.label }}</span><span class="font-mono tabular-nums">{{ i.n }}</span>
        </div>
        <p v-if="loaded && !topItems.length" class="text-sm text-muted-foreground">{{ t('ov.noItems') }}</p>
      </CardContent>
    </Card>
  </div>

  <Card>
    <CardContent class="flex flex-col gap-3">
      <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ t('ov.lastReceipts') }}</span>
      <div class="overflow-hidden rounded-md border">
        <Table>
          <TableHeader class="bg-muted [&_th]:text-xs [&_th]:font-medium [&_th]:text-text-secondary">
            <TableRow class="hover:bg-muted">
              <TableHead class="px-4">{{ t('common.time') }}</TableHead><TableHead>{{ t('common.location') }}</TableHead><TableHead class="px-4 text-right">{{ t('common.total') }}</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="r in recent" :key="r.id" class="h-[52px] cursor-pointer" data-testid="overview-row" @click="navigateTo(`/dashboard/archive/${r.id}`)">
              <TableCell class="px-4"><NuxtLink :to="`/dashboard/archive/${r.id}`" class="font-medium hover:underline">{{ timeOf(r.createdAt) }}</NuxtLink></TableCell>
              <TableCell>{{ r.locationName }}</TableCell>
              <TableCell class="px-4 text-right tabular-nums">{{ euro(r.totalMinor) }}</TableCell>
              <TableCell><div class="flex justify-end gap-2"><Badge v-if="r.state === 'void'" variant="danger">{{ t('ov.tag.cancelled') }}</Badge><Badge v-if="isLate(r)" variant="warning">{{ t('ov.arch.late') }}</Badge></div></TableCell>
            </TableRow>
            <TableRow v-if="loaded && !recent.length" class="hover:bg-transparent"><TableCell colspan="4" class="h-[52px] text-center text-muted-foreground">{{ t('overview.empty') }}</TableCell></TableRow>
          </TableBody>
        </Table>
      </div>
    </CardContent>
  </Card>
</template>
