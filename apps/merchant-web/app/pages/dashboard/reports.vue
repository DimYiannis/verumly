<script setup lang="ts">
import { REPORT_GROUPS, REPORT_METRICS, type ReportGroup, type ReportMetric, type ReportResult, type ReportSpec, type ReportView } from '@lr/schema';
import { Download, Printer, RefreshCw, Trash2 } from '@lucide/vue';
import { PRESETS, RUBRIEK, TIME_GROUPS, NEGATIVE_METRICS, csvAmount, defaultSpec, downloadText, isMoney, presetRange, toCsv, type Preset } from '~/lib/report';
import type { MessageKey } from '~/i18n/en';

definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Loc { id: string; name: string }
interface Term { id: string; label: string; locationId: string }

const { t, tx, intlLocale } = useLocale();
const STORAGE_KEY = 'lr-report-spec';
const SAVED_MAX = 60;

const init = defaultSpec();
const form = reactive({
  preset: 'last30' as Preset,
  from: init.from,
  to: init.to,
  groupBy: init.groupBy as ReportGroup,
  metrics: [...init.metrics] as ReportMetric[],
  locationId: '',
  terminalId: '',
  payment: '',
  compare: false,
});

const locations = ref<Loc[]>([]);
const terminals = ref<Term[]>([]);
const views = ref<ReportView[]>([]);
const result = ref<ReportResult | null>(null);
const loading = ref(false);
const error = ref('');
const viewError = ref('');
const chartMode = ref<'bars' | 'line' | 'table'>('bars');
const chartMetricPick = ref<ReportMetric>('receipts');
const sortBy = ref<'group' | ReportMetric | null>(null);
const sortDir = ref<'asc' | 'desc'>('desc');
const saveName = ref('');
const savedFlash = ref(false);
const confirmId = ref('');
let ready = false;

const currentSpec = computed<ReportSpec>(() => ({
  from: form.from,
  to: form.to,
  groupBy: form.groupBy,
  metrics: REPORT_METRICS.filter((m) => form.metrics.includes(m)),
  ...(form.locationId && { locationId: form.locationId }),
  ...(form.terminalId && { terminalId: form.terminalId }),
  ...(form.payment && { payment: form.payment as 'card' | 'cash' | 'other' }),
  compare: form.compare,
}));
const specKey = computed(() => JSON.stringify(currentSpec.value));
const specValid = computed(() => /^\d{4}-\d{2}-\d{2}$/.test(form.from) && /^\d{4}-\d{2}-\d{2}$/.test(form.to) && form.from <= form.to && form.metrics.length > 0);

function detectPreset(from: string, to: string): Preset {
  return PRESETS.find((p) => {
    const r = presetRange(p);
    return r.from === from && r.to === to;
  }) ?? 'custom';
}

function applySpec(s: ReportSpec) {
  form.from = s.from;
  form.to = s.to;
  form.preset = detectPreset(s.from, s.to);
  form.groupBy = s.groupBy;
  form.metrics = [...s.metrics];
  form.locationId = s.locationId ?? '';
  form.terminalId = s.terminalId ?? '';
  form.payment = s.payment ?? '';
  form.compare = s.compare;
  sortBy.value = null;
}

function setPreset(p: Preset) {
  form.preset = p;
  if (p !== 'custom') Object.assign(form, presetRange(p));
}

function toggleMetric(m: ReportMetric) {
  const i = form.metrics.indexOf(m);
  if (i >= 0) {
    if (form.metrics.length > 1) form.metrics.splice(i, 1);
  } else form.metrics.push(m);
}

watch(() => form.locationId, (id) => {
  if (id && form.terminalId && terminals.value.find((x) => x.id === form.terminalId)?.locationId !== id) form.terminalId = '';
});
const terminalOptions = computed(() => terminals.value.filter((x) => !form.locationId || x.locationId === form.locationId));

let seq = 0;
async function run() {
  if (!specValid.value) return;
  const mine = ++seq;
  loading.value = true;
  const r = await attempt(error, () => $fetch<ReportResult>('/api/dashboard/reports/run', { method: 'POST', body: currentSpec.value }));
  if (mine !== seq) return;
  loading.value = false;
  if (r) {
    result.value = r;
    sortBy.value = null;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
watch(specKey, () => {
  if (!ready) return;
  try {
    localStorage.setItem(STORAGE_KEY, specKey.value);
  } catch {
    /* storage unavailable */
  }
  clearTimeout(timer);
  timer = setTimeout(run, 350);
});
onBeforeUnmount(() => clearTimeout(timer));

onMounted(async () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as ReportSpec;
      if (s && typeof s.from === 'string' && Array.isArray(s.metrics) && s.metrics.length && REPORT_GROUPS.includes(s.groupBy) && s.metrics.every((m) => REPORT_METRICS.includes(m))) applySpec(s);
    }
  } catch {
    /* ignore a bad or blocked stored spec */
  }
  ready = true;
  const [l, tm, v] = await Promise.all([
    attempt(error, () => $fetch<Loc[]>('/api/dashboard/locations')),
    attempt(error, () => $fetch<Term[]>('/api/dashboard/terminals')),
    attempt(viewError, () => $fetch<ReportView[]>('/api/dashboard/reports/views')),
  ]);
  locations.value = l ?? [];
  terminals.value = tm ?? [];
  views.value = v ?? [];
  await run();
});

// ---- labels and values
const shownGroup = computed<ReportGroup>(() => result.value?.spec.groupBy ?? form.groupBy);
const shownMetrics = computed<ReportMetric[]>(() => result.value?.spec.metrics ?? currentSpec.value.metrics);
const metricName = (m: ReportMetric) => tx('reports2.metric', m);
const groupName = (g: ReportGroup) => tx('reports2.group', g);
const numFmt = computed(() => new Intl.NumberFormat(intlLocale.value));
const fmt = (m: ReportMetric, v: number | undefined) => (isMoney(m) ? money(v ?? 0) : numFmt.value.format(v ?? 0));

function rowLabel(g: ReportGroup, key: string, label: string): string {
  switch (g) {
    case 'weekday':
      return new Intl.DateTimeFormat(intlLocale.value, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, Number(key))));
    case 'hour':
      return `${key.padStart(2, '0')}:00`;
    case 'month': {
      const [y, m] = key.split('-').map(Number);
      return new Intl.DateTimeFormat(intlLocale.value, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y!, m! - 1, 1)));
    }
    case 'payment':
      return tx('reports2.payment', key);
    case 'vat_rate':
      return `${key}%`;
    case 'category':
      return key === 'uncategorised' ? t('reports2.uncategorised') : label || key;
    default:
      return label || key;
  }
}

const rows = computed(() => {
  const r = result.value;
  if (!r) return [];
  const g = r.spec.groupBy;
  const list = r.rows.map((x) => ({ key: x.key, label: rowLabel(g, x.key, x.label), values: x.values }));
  const by = sortBy.value;
  if (!by) return list;
  const dir = sortDir.value === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => (by === 'group' ? (TIME_GROUPS.includes(g) ? a.key.localeCompare(b.key) : a.label.localeCompare(b.label)) : (a.values[by] ?? 0) - (b.values[by] ?? 0)) * dir);
});

function toggleSort(by: 'group' | ReportMetric) {
  if (sortBy.value === by) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  else {
    sortBy.value = by;
    sortDir.value = by === 'group' ? 'asc' : 'desc';
  }
}
const ariaSort = (by: string) => (sortBy.value === by ? (sortDir.value === 'asc' ? 'ascending' : 'descending') : 'none');

const delta = (m: ReportMetric) => {
  const prev = result.value?.previous?.totals[m] ?? 0;
  const cur = result.value?.totals[m] ?? 0;
  if (!result.value?.previous) return null;
  if (prev === 0) return { text: t('reports2.na'), tone: 'flat' as const };
  const pct = (cur - prev) / Math.abs(prev);
  const bad = NEGATIVE_METRICS.includes(m);
  const tone: 'good' | 'bad' | 'flat' = pct === 0 ? 'flat' : (pct > 0) !== bad ? 'good' : 'bad';
  return { text: new Intl.NumberFormat(intlLocale.value, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(pct), tone };
};
const toneClass = { good: 'bg-success-soft text-success', bad: 'bg-danger-soft text-danger', flat: 'bg-muted text-text-secondary' } as const;

const partialNote = computed(() => {
  const n = result.value?.notes.find((x) => x.startsWith('partial:'));
  if (!n) return '';
  const [, g, list] = n.split(':');
  const metrics = (list ?? '').split(',').filter(Boolean).map((m) => metricName(m as ReportMetric)).join(', ');
  return t('reports2.partialNote', { metrics, group: groupName(g as ReportGroup).toLowerCase() });
});
const onceHint = computed(() => result.value?.notes.some((x) => x.includes('each receipt once')) ?? false);

const chartMetric = computed<ReportMetric>(() => (shownMetrics.value.includes(chartMetricPick.value) ? chartMetricPick.value : shownMetrics.value[0]!));
const chartPoints = computed(() => rows.value.map((r) => ({ label: r.label, value: r.values[chartMetric.value] ?? 0 })));
const chartHorizontal = computed(() => !TIME_GROUPS.includes(shownGroup.value));
const chartSummary = computed(() => {
  const m = chartMetric.value;
  const best = [...chartPoints.value].sort((a, b) => b.value - a.value)[0];
  return t('reports2.chartSummary', { metric: metricName(m), group: groupName(shownGroup.value).toLowerCase(), count: chartPoints.value.length, total: fmt(m, result.value?.totals[m]), topLabel: best?.label ?? '', top: fmt(m, best?.value) });
});
const chartFormat = (v: number) => fmt(chartMetric.value, v);
const hasRubriek = computed(() => shownGroup.value === 'vat_rate');

// ---- export
function exportCsv() {
  const r = result.value;
  if (!r) return;
  const ms = shownMetrics.value;
  const cell = (m: ReportMetric, v: number | undefined) => (isMoney(m) ? csvAmount(v ?? 0) : String(v ?? 0));
  const head = [groupName(shownGroup.value), ...(hasRubriek.value ? [t('reports2.rubriek')] : []), ...ms.map(metricName)];
  const body = rows.value.map((x) => [x.label, ...(hasRubriek.value ? [RUBRIEK[x.key] ?? ''] : []), ...ms.map((m) => cell(m, x.values[m]))]);
  const total = [t('reports2.total'), ...(hasRubriek.value ? [''] : []), ...ms.map((m) => cell(m, r.totals[m]))];
  downloadText(`report-${r.spec.from}-${r.spec.to}.csv`, toCsv([head, ...body, total]));
}

// ---- saved views
interface Preview { id: string; name: string; spec: ReportSpec; builtin: boolean }
const builtins = computed<Preview[]>(() => [
  { id: 'daily', name: t('reports2.builtin.daily'), builtin: true, spec: { ...presetRange('last30'), groupBy: 'day', metrics: ['receipts', 'gross', 'net', 'vat', 'tip', 'cancelled'], compare: false } },
  { id: 'vat', name: t('reports2.builtin.vat'), builtin: true, spec: { ...presetRange('lastMonth'), groupBy: 'vat_rate', metrics: ['gross', 'net', 'vat'], compare: false } },
]);
const allViews = computed<Preview[]>(() => [...builtins.value, ...views.value.map((v) => ({ id: v.id, name: v.name, spec: v.spec, builtin: false }))]);

async function saveView() {
  const name = saveName.value.trim();
  if (!name || !specValid.value) return;
  const v = await attempt(viewError, () => $fetch<ReportView>('/api/dashboard/reports/views', { method: 'POST', body: { name, spec: currentSpec.value } }));
  if (v) {
    views.value = [...views.value, v];
    saveName.value = '';
    savedFlash.value = true;
    setTimeout(() => (savedFlash.value = false), 2500);
  }
}
async function deleteView(id: string) {
  confirmId.value = '';
  if (await attempt(viewError, () => $fetch<{ ok: boolean }>(`/api/dashboard/reports/views/${id}`, { method: 'DELETE' }))) views.value = views.value.filter((v) => v.id !== id);
}

const chipClass = (on: boolean) => ['h-9 rounded-md border px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring', on ? 'border-primary bg-muted font-medium text-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted'];
function printPage() { window.print(); }
const mk = (k: string) => k as MessageKey;
</script>

<template>
  <AppPageHeading :title="t('reports2.title')" :description="t('reports2.description')">
    <div data-print-hide class="flex items-center gap-2">
      <Button variant="outline" :disabled="!result" data-testid="report-csv" @click="exportCsv"><Download />{{ t('reports2.csv') }}</Button>
      <Button variant="outline" :disabled="!result" data-testid="report-print" @click="printPage"><Printer />{{ t('reports2.print') }}</Button>
    </div>
  </AppPageHeading>

  <Card data-print-hide>
    <CardContent class="space-y-5">
      <div class="space-y-2">
        <Label>{{ t('reports2.period') }}</Label>
        <div class="flex flex-wrap gap-2" role="group" :aria-label="t('reports2.period')">
          <button v-for="p in [...PRESETS, 'custom' as const]" :key="p" type="button" :aria-pressed="form.preset === p" :class="chipClass(form.preset === p)" :data-testid="`report-preset-${p}`" @click="setPreset(p)">{{ t(mk(`reports2.preset.${p}`)) }}</button>
        </div>
        <div v-if="form.preset === 'custom'" class="grid max-w-md grid-cols-2 gap-3">
          <div class="space-y-1"><Label for="report-from">{{ t('reports2.from') }}</Label><Input id="report-from" v-model="form.from" type="date" data-testid="report-from" /></div>
          <div class="space-y-1"><Label for="report-to">{{ t('reports2.to') }}</Label><Input id="report-to" v-model="form.to" type="date" data-testid="report-to" /></div>
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="space-y-1">
          <Label for="report-group">{{ t('reports2.groupBy') }}</Label>
          <AppNativeSelect id="report-group" v-model="form.groupBy" data-testid="report-group"><option v-for="g in REPORT_GROUPS" :key="g" :value="g">{{ groupName(g) }}</option></AppNativeSelect>
        </div>
        <div class="space-y-1">
          <Label for="report-location">{{ t('reports2.location') }}</Label>
          <AppNativeSelect id="report-location" v-model="form.locationId" data-testid="report-location"><option value="">{{ t('reports2.all') }}</option><option v-for="l in locations" :key="l.id" :value="l.id">{{ l.name }}</option></AppNativeSelect>
        </div>
        <div class="space-y-1">
          <Label for="report-terminal">{{ t('reports2.terminal') }}</Label>
          <AppNativeSelect id="report-terminal" v-model="form.terminalId" data-testid="report-terminal"><option value="">{{ t('reports2.all') }}</option><option v-for="x in terminalOptions" :key="x.id" :value="x.id">{{ x.label }}</option></AppNativeSelect>
        </div>
        <div class="space-y-1">
          <Label for="report-payment">{{ t('reports2.paymentFilter') }}</Label>
          <AppNativeSelect id="report-payment" v-model="form.payment" data-testid="report-payment"><option value="">{{ t('reports2.all') }}</option><option v-for="p in ['card', 'cash', 'other']" :key="p" :value="p">{{ tx('reports2.payment', p) }}</option></AppNativeSelect>
        </div>
      </div>

      <div class="space-y-2">
        <Label>{{ t('reports2.metrics') }}</Label>
        <div class="flex flex-wrap gap-2" role="group" :aria-label="t('reports2.metrics')">
          <button v-for="m in REPORT_METRICS" :key="m" type="button" :aria-pressed="form.metrics.includes(m)" :class="chipClass(form.metrics.includes(m))" :data-testid="`report-metric-${m}`" @click="toggleMetric(m)">{{ metricName(m) }}</button>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <label class="flex items-center gap-2 text-sm"><Switch v-model="form.compare" data-testid="report-compare" />{{ t('reports2.compare') }}</label>
        <Button variant="outline" :disabled="loading || !specValid" data-testid="report-refresh" @click="run"><RefreshCw :class="loading && 'animate-spin'" />{{ t('reports2.refresh') }}</Button>
      </div>
    </CardContent>
  </Card>

  <AppErrorNote v-if="error" data-testid="error">{{ error }}</AppErrorNote>

  <Card data-print-hide>
    <CardHeader><CardTitle class="text-base">{{ t('reports2.views') }}</CardTitle></CardHeader>
    <CardContent class="space-y-4">
      <AppErrorNote v-if="viewError" data-testid="error-views">{{ viewError }}</AppErrorNote>
      <ul class="divide-y rounded-md border">
        <li v-for="v in allViews" :key="v.id" class="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
          <span class="min-w-0 truncate text-sm">{{ v.name }}<span class="ml-2 text-xs text-muted-foreground">{{ v.builtin ? t('reports2.viewsBuiltin') : '' }}</span></span>
          <span class="flex items-center gap-2">
            <template v-if="confirmId === v.id">
              <span class="text-sm text-muted-foreground">{{ t('reports2.deleteConfirm') }}</span>
              <Button size="sm" variant="destructive" :data-testid="`report-view-delete-confirm-${v.id}`" @click="deleteView(v.id)">{{ t('reports2.deleteYes') }}</Button>
              <Button size="sm" variant="outline" @click="confirmId = ''">{{ t('reports2.cancel') }}</Button>
            </template>
            <template v-else>
              <Button size="sm" variant="outline" :data-testid="`report-view-${v.builtin ? `builtin-${v.id}` : v.id}`" @click="applySpec(v.spec)">{{ t('reports2.apply') }}</Button>
              <Button v-if="!v.builtin" size="icon" variant="ghost" :aria-label="t('reports2.delete')" :data-testid="`report-view-delete-${v.id}`" @click="confirmId = v.id"><Trash2 /></Button>
            </template>
          </span>
        </li>
      </ul>
      <p v-if="!views.length" class="text-sm text-muted-foreground">{{ t('reports2.viewsEmpty') }}</p>
      <form class="flex flex-wrap items-end gap-3" @submit.prevent="saveView">
        <div class="min-w-48 flex-1 space-y-1">
          <Label for="report-save-name">{{ t('reports2.saveName') }}</Label>
          <Input id="report-save-name" v-model="saveName" :maxlength="SAVED_MAX" :placeholder="t('reports2.saveNamePlaceholder')" data-testid="report-save-name" />
        </div>
        <Button type="submit" variant="outline" :disabled="!saveName.trim() || !specValid" data-testid="report-save">{{ t('reports2.save') }}</Button>
        <span v-if="savedFlash" class="text-sm text-success" role="status">{{ t('reports2.saved') }}</span>
      </form>
    </CardContent>
  </Card>

  <p v-if="loading && !result" class="px-2 text-sm text-muted-foreground" role="status">{{ t('reports2.loading') }}</p>

  <template v-if="result">
    <div :class="['space-y-4', loading && 'opacity-60 transition-opacity']">
      <p class="px-2 text-sm text-muted-foreground tabular-nums">
        {{ t('reports2.periodRange', { from: result.spec.from, to: result.spec.to }) }}<template v-if="result.previous"> · {{ t('reports2.previousRange', { from: result.previous.from, to: result.previous.to }) }}</template>
      </p>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card v-for="m in shownMetrics" :key="m" :data-testid="`report-kpi-${m}`">
          <CardContent class="space-y-1">
            <p class="text-xs text-text-secondary">{{ metricName(m) }}</p>
            <p class="text-2xl font-medium tabular-nums">{{ fmt(m, result.totals[m]) }}</p>
            <p v-if="delta(m)" class="flex items-center gap-1.5 text-xs">
              <span :class="['rounded-full px-2 py-0.5 tabular-nums', toneClass[delta(m)!.tone]]" :data-testid="`report-delta-${m}`">{{ delta(m)!.text }}</span>
              <span class="text-muted-foreground">{{ t('reports2.vsPrevious') }}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card v-if="rows.length">
        <CardHeader class="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle class="text-base">{{ t('reports2.chart') }}</CardTitle>
          <div data-print-hide class="flex flex-wrap items-center gap-2">
            <AppNativeSelect :model-value="chartMetric" class="w-44" :aria-label="t('reports2.chartMetric')" data-testid="report-chart-metric" @update:model-value="(v) => (chartMetricPick = v as ReportMetric)"><option v-for="m in shownMetrics" :key="m" :value="m">{{ metricName(m) }}</option></AppNativeSelect>
            <div class="flex gap-1" role="group">
              <button v-for="c in ['bars', 'line', 'table'] as const" :key="c" type="button" :aria-pressed="chartMode === c" :class="chipClass(chartMode === c)" :data-testid="`report-chart-${c}`" @click="chartMode = c">{{ t(mk(`reports2.chart${c === 'table' ? 'Table' : c === 'bars' ? 'Bars' : 'Line'}`)) }}</button>
            </div>
          </div>
        </CardHeader>
        <CardContent v-if="chartMode !== 'table'" data-testid="report-chart">
          <AppReportChart :points="chartPoints" :mode="chartMode === 'line' && !chartHorizontal ? 'line' : 'bars'" :horizontal="chartHorizontal" :format="chartFormat" :summary="chartSummary" />
          <p v-if="chartHorizontal && chartPoints.length > 20" class="mt-2 text-xs text-muted-foreground">{{ t('reports2.chartTop', { n: 20 }) }}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle class="text-base">{{ t('reports2.table') }}</CardTitle></CardHeader>
        <CardContent class="space-y-3">
          <div class="overflow-x-auto rounded-md border">
            <Table data-testid="report-table">
              <TableHeader class="bg-muted [&_th]:text-xs [&_th]:font-medium [&_th]:text-text-secondary">
                <TableRow class="hover:bg-muted">
                  <TableHead class="px-4" :aria-sort="ariaSort('group')"><button type="button" class="font-medium" :title="t('reports2.sortBy', { name: groupName(shownGroup) })" @click="toggleSort('group')">{{ groupName(shownGroup) }}{{ sortBy === 'group' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '' }}</button></TableHead>
                  <TableHead v-if="hasRubriek">{{ t('reports2.rubriek') }}</TableHead>
                  <TableHead v-for="m in shownMetrics" :key="m" class="text-right" :aria-sort="ariaSort(m)"><button type="button" class="font-medium" :title="t('reports2.sortBy', { name: metricName(m) })" :data-testid="`report-sort-${m}`" @click="toggleSort(m)">{{ metricName(m) }}{{ sortBy === m ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '' }}</button></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody class="tabular-nums">
                <TableRow v-for="r in rows" :key="r.key" class="h-[52px]" data-testid="report-row" :data-key="r.key">
                  <TableCell class="px-4">{{ r.label }}</TableCell>
                  <TableCell v-if="hasRubriek">{{ RUBRIEK[r.key] }}</TableCell>
                  <TableCell v-for="m in shownMetrics" :key="m" class="text-right">{{ fmt(m, r.values[m]) }}</TableCell>
                </TableRow>
                <TableRow v-if="!rows.length" class="hover:bg-transparent"><TableCell :colspan="shownMetrics.length + 1 + (hasRubriek ? 1 : 0)" class="h-[52px] text-center text-muted-foreground" data-testid="report-empty">{{ t('reports2.empty') }}</TableCell></TableRow>
                <TableRow v-else class="h-[52px] bg-muted/50 font-medium" data-testid="report-total">
                  <TableCell class="px-4">{{ t('reports2.total') }}</TableCell>
                  <TableCell v-if="hasRubriek" />
                  <TableCell v-for="m in shownMetrics" :key="m" class="text-right">{{ fmt(m, result.totals[m]) }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <p v-if="partialNote" class="text-xs text-muted-foreground" data-testid="report-partial-note">{{ partialNote }}</p>
          <p v-if="onceHint" class="text-xs text-muted-foreground">{{ t('reports2.onceHint') }}</p>
        </CardContent>
      </Card>
    </div>
  </template>
</template>

<style>
@media print {
  [data-print-hide],
  [data-slot='sidebar'],
  [data-slot='sidebar-wrapper'] > header,
  aside,
  nav {
    display: none !important;
  }
}
</style>
