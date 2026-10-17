<script setup lang="ts">
import type { ReportResult, ReportSpec } from '@lr/schema';
import type { MessageKey } from '~/i18n/en';

definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Row { id: string; locationName: string; state: string; currentVersion: number; totalMinor: number; createdAt: string; receivedAt: string }
interface Term { id: string; label: string; locationName: string; lastSeenAt: string | null; revokedAt: string | null }
type Period = 'today' | 'month' | 'quarter' | 'year';
type Unit = 'hour' | 'day' | 'week' | 'month';

const { t, intlLocale } = useLocale();
const session = sessionState();
const PERIODS: Period[] = ['today', 'month', 'quarter', 'year'];
const ONLINE_MS = 5 * 60_000;

const period = ref<Period>('month');
const report = ref<ReportResult | null>(null);
const terminals = ref<Term[]>([]);
const recent = ref<Row[]>([]);
const error = ref('');
const loaded = ref(false);
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function range(p: Period): { from: string; to: string; unit: Unit } {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  if (p === 'today') return { from: ymd(d), to: ymd(d), unit: 'hour' };
  if (p === 'month') return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)), unit: 'day' };
  if (p === 'quarter') {
    const q = Math.floor(m / 3) * 3;
    return { from: ymd(new Date(y, q, 1)), to: ymd(new Date(y, q + 3, 0)), unit: 'week' };
  }
  return { from: `${y}-01-01`, to: `${y}-12-31`, unit: 'month' };
}
const unit = computed(() => range(period.value).unit);

async function loadReport() {
  const r = range(period.value);
  const spec: Pick<ReportSpec, 'from' | 'to' | 'groupBy' | 'metrics' | 'compare'> = { from: r.from, to: r.to, groupBy: r.unit, metrics: ['receipts', 'gross', 'cancelled', 'avgTicket'], compare: true };
  const res = await attempt(error, () => $fetch<ReportResult>('/api/dashboard/reports/run', { method: 'POST', body: spec }));
  if (res) report.value = res;
}

onMounted(async () => {
  const canTerminals = session.value.user?.role !== 'accountant';
  await Promise.all([
    loadReport(),
    canTerminals ? $fetch<Term[]>('/api/dashboard/terminals').then((r) => (terminals.value = r)).catch(() => undefined) : Promise.resolve(),
    attempt(error, () => $fetch<Row[]>('/api/dashboard/archive', { query: { limit: 5 } })).then((r) => r && (recent.value = r)),
  ]);
  loaded.value = true;
  timer = setInterval(() => (now.value = Date.now()), 30_000);
});
onBeforeUnmount(() => clearInterval(timer));
watch(period, () => void loadReport());

// greeting
const name = computed(() => {
  const local = (session.value.user?.email ?? '').split('@')[0] ?? '';
  const first = local.split(/[._-]/)[0] ?? '';
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : '';
});
const greeting = computed(() => {
  const h = new Date(now.value).getHours();
  return t(h < 12 ? 'ov.greet.morning' : h < 18 ? 'ov.greet.afternoon' : 'ov.greet.evening', { name: name.value });
});
const activeTerminals = computed(() => terminals.value.filter((x) => !x.revokedAt));
const subtitle = computed(() => {
  const p = t(`ov.phrase.${period.value}` as MessageKey);
  const locs = new Set(activeTerminals.value.map((x) => x.locationName)).size;
  return locs > 1 ? t('ov.subtitleMany', { period: p, n: locs }) : locs === 1 ? t('ov.subtitleOne', { period: p }) : t('ov.subtitle', { period: p });
});

// KPIs
const cur = computed(() => report.value?.totals ?? {});
const prev = computed(() => report.value?.previous?.totals ?? null);
function pct(c = 0, p = 0): { text: string; good: boolean; up: boolean } | null {
  if (!prev.value || p === 0) return null;
  const v = Math.round(((c - p) / p) * 100);
  return { text: `${v > 0 ? '+' : ''}${v}%`, good: v >= 0, up: v >= 0 };
}
function pctLine(key: 'gross' | 'receipts' | 'avgTicket') {
  const p = pct(cur.value[key], prev.value?.[key]);
  if (!p) return { text: t('ov.noPrev'), cls: 'text-muted-foreground' };
  if (p.text === '+0%' || p.text === '0%') return { text: t('ov.noChange'), cls: 'text-muted-foreground' };
  return { text: `${p.up ? '▲' : '▼'} ${t('ov.vsPrev', { change: p.text.replace('+', '') })}`, cls: p.good ? 'text-success' : 'text-danger' };
}
const cancelledLine = computed(() => {
  if (!prev.value) return { text: t('ov.noPrev'), cls: 'text-muted-foreground' };
  const d = (cur.value.cancelled ?? 0) - (prev.value.cancelled ?? 0);
  if (d === 0) return { text: t('ov.noChange'), cls: 'text-muted-foreground' };
  return d > 0 ? { text: `▲ ${t('ov.cancelledMore', { n: d })}`, cls: 'text-danger' } : { text: `▼ ${t('ov.cancelledFewer', { n: -d })}`, cls: 'text-success' };
});
const kpis = computed(() => [
  { id: 'overview-gross', label: t('overview.sales'), value: euro(cur.value.gross ?? 0), line: pctLine('gross') },
  { id: 'overview-receipts', label: t('overview.receipts'), value: String(cur.value.receipts ?? 0), line: pctLine('receipts') },
  { id: 'overview-avg', label: t('ov.kpi.avg'), value: euro(Math.round(cur.value.avgTicket ?? 0)), line: pctLine('avgTicket') },
  { id: 'overview-voids', label: t('overview.voids'), value: String(cur.value.cancelled ?? 0), line: cancelledLine.value },
]);

// chart
interface Bar { label: string; value: number; weekend: boolean }
const bars = computed<Bar[]>(() => {
  const r = range(period.value);
  const byKey = new Map((report.value?.rows ?? []).map((x) => [x.key, x] as const));
  if (r.unit === 'day') {
    const out: Bar[] = [];
    for (let d = new Date(`${r.from}T12:00:00`); ymd(d) <= r.to; d.setDate(d.getDate() + 1)) {
      const k = ymd(d);
      out.push({ label: new Intl.DateTimeFormat(intlLocale.value, { day: 'numeric', month: 'short' }).format(d), value: byKey.get(k)?.values.gross ?? 0, weekend: d.getDay() === 0 || d.getDay() === 6 });
    }
    return out;
  }
  if (r.unit === 'hour') return Array.from({ length: 24 }, (_, h) => ({ label: `${pad(h)}:00`, value: byKey.get(String(h))?.values.gross ?? 0, weekend: false }));
  return (report.value?.rows ?? []).map((x) => ({ label: x.label, value: x.values.gross ?? 0, weekend: false }));
});
const W = 620;
const H = 200;
const max = computed(() => Math.max(1, ...bars.value.map((b) => b.value)));
const step = computed(() => W / Math.max(bars.value.length, 1));
const bw = computed(() => Math.max(2, Math.min(28, step.value * 0.7)));
const bx = (i: number) => i * step.value + (step.value - bw.value) / 2;
const bh = (v: number) => (v <= 0 ? 0 : Math.max(2, (v / max.value) * (H - 40)));
const hasSales = computed(() => bars.value.some((b) => b.value > 0));
const showWeekends = computed(() => unit.value === 'day');

// right now
const relative = (iso: string | null) => {
  if (!iso) return '';
  const mins = Math.round((new Date(iso).getTime() - now.value) / 60_000);
  const f = new Intl.RelativeTimeFormat(intlLocale.value, { numeric: 'auto' });
  if (Math.abs(mins) < 60) return f.format(mins, 'minute');
  if (Math.abs(mins) < 1440) return f.format(Math.round(mins / 60), 'hour');
  return f.format(Math.round(mins / 1440), 'day');
};
const isOnline = (x: Term) => !!x.lastSeenAt && now.value - new Date(x.lastSeenAt).getTime() < ONLINE_MS;
const anyOnline = computed(() => activeTerminals.value.some(isOnline));
</script>

<template>
  <div class="flex flex-wrap items-center justify-end gap-2 px-2">
    <button v-for="p in PERIODS" :key="p" type="button" :data-testid="`overview-period-${p}`" :aria-pressed="period === p"
      class="rounded-full border px-3 py-1 text-sm font-medium transition-colors"
      :class="period === p ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-text-secondary hover:bg-muted'" @click="period = p">{{ t(`ov.period.${p}` as MessageKey) }}</button>
  </div>
  <AppPageHeading :title="greeting" :description="subtitle">
    <Button as-child><NuxtLink to="/dashboard/reports">{{ t('ov.openReports') }}</NuxtLink></Button>
  </AppPageHeading>
  <AppErrorNote v-if="error" data-testid="error">{{ error }}</AppErrorNote>

  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <Card v-for="k in kpis" :key="k.id" class="gap-1.5 py-4">
      <CardContent class="flex flex-col gap-1.5">
        <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ k.label }}</span>
        <span class="text-[28px] font-semibold leading-8 tracking-tight tabular-nums" :data-testid="k.id">{{ loaded ? k.value : '-' }}</span>
        <span class="text-xs" :class="k.line.cls">{{ loaded ? k.line.text : '' }}</span>
      </CardContent>
    </Card>
  </div>

  <div class="flex flex-wrap items-stretch gap-4">
    <Card class="min-w-[300px] flex-[2_1_480px]">
      <CardContent class="flex flex-col gap-3">
        <span class="text-[17px] font-semibold">{{ t(`ov.chart.${unit}` as MessageKey) }}</span>
        <svg v-if="hasSales" :viewBox="`0 0 ${W} ${H}`" width="100%" :height="H" role="img" :aria-label="t('ov.chartAria')" data-testid="overview-chart">
          <g stroke="var(--border)" stroke-width="1"><line x1="0" y1="40" :x2="W" y2="40" /><line x1="0" y1="100" :x2="W" y2="100" /><line x1="0" y1="160" :x2="W" y2="160" /></g>
          <g>
            <rect v-for="(b, i) in bars" :key="i" :x="bx(i)" :y="160 - bh(b.value)" :width="bw" :height="bh(b.value)" rx="3" :fill="b.weekend ? 'var(--chart-1)' : 'var(--chart-3)'" :fill-opacity="b.weekend ? 1 : 0.7"><title>{{ b.label }}: {{ euro(b.value) }}</title></rect>
          </g>
        </svg>
        <p v-else-if="loaded" class="flex h-[200px] items-center justify-center text-sm text-muted-foreground">{{ t('ov.noSales') }}</p>
        <div v-if="bars.length" class="flex items-center justify-between text-xs text-muted-foreground"><span>{{ bars[0]?.label }}</span><span v-if="showWeekends">{{ t('ov.weekends') }}</span><span>{{ bars[bars.length - 1]?.label }}</span></div>
      </CardContent>
    </Card>

    <Card class="min-w-[280px] flex-[1_1_300px]">
      <CardContent class="flex flex-col gap-3">
        <span class="text-[17px] font-semibold">{{ t('ov.rightNow') }}</span>
        <div class="flex items-center gap-3">
          <Badge v-if="anyOnline" variant="success">● {{ t('ov.live') }}</Badge>
          <span class="text-xs text-muted-foreground">{{ recent[0] ? t('ov.lastReceipt', { when: relative(recent[0].receivedAt) }) : t('ov.noReceiptsYet') }}</span>
        </div>
        <div v-if="activeTerminals.length" class="flex flex-col gap-2">
          <div v-for="x in activeTerminals" :key="x.id" class="flex items-center justify-between gap-2 text-sm" data-testid="overview-terminal">
            <span class="truncate">{{ x.locationName }} · {{ x.label }}</span>
            <Badge v-if="isOnline(x)" variant="success">{{ t('ov.online') }}</Badge>
            <Badge v-else variant="warning">{{ x.lastSeenAt ? t('ov.offlineSince', { when: relative(x.lastSeenAt) }) : t('ov.neverSeen') }}</Badge>
          </div>
        </div>
        <p v-else-if="loaded && session.user?.role !== 'accountant'" class="text-sm text-muted-foreground">{{ t('ov.noTerminals') }}</p>
        <Separator />
        <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ t('ov.lastReceipts') }}</span>
        <NuxtLink v-for="r in recent" :key="r.id" :to="`/dashboard/archive/${r.id}`" class="flex items-center justify-between gap-2 text-sm hover:underline" data-testid="overview-row">
          <span class="tabular-nums">{{ euro(r.totalMinor) }} · {{ r.locationName }}</span>
          <span class="shrink-0 text-muted-foreground">{{ relative(r.createdAt) }}</span>
        </NuxtLink>
        <p v-if="loaded && !recent.length" class="text-sm text-muted-foreground">{{ t('overview.empty') }}</p>
      </CardContent>
    </Card>
  </div>
</template>
