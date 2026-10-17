<script setup lang="ts">
import type { MessageKey } from '~/i18n/en';
import { amsterdamNow } from '~/lib/overview';

definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Exp { id: string; kind: string; periodFrom: string; periodTo: string; status: string; createdAt: string; link: string | null; linkExpiresAt: string | null }
const { t, te } = useLocale();
const KINDS = [
  { value: 'btw_csv', label: 'exports.kind.btw_csv' },
  { value: 'sales_csv', label: 'exports.kind.sales_csv' },
] as const;
// the exports group by Amsterdam day, so the default period ends on the Amsterdam day, not the UTC one
const today = amsterdamNow(new Date()).ymd;
const rows = ref<Exp[]>([]);
const error = ref('');
const form = reactive({ kind: 'btw_csv', from: today.slice(0, 8) + '01', to: today });
let timer: ReturnType<typeof setInterval> | undefined;

async function load() {
  const r = await attempt(error, () => $fetch<Exp[]>('/api/dashboard/exports'));
  if (r) rows.value = r;
}
onMounted(() => {
  void load();
  // keep polling while the worker is still producing a file
  timer = setInterval(() => {
    if (rows.value.some((r) => r.status === 'queued' || r.status === 'processing')) void load();
  }, 3000);
});
onBeforeUnmount(() => clearInterval(timer));

async function request() {
  if (await attempt(error, () => $fetch<unknown>('/api/dashboard/exports', { method: 'POST', body: { ...form } }))) await load();
}
</script>

<template>
  <AppPageHeading :title="t('nav.exports')" :description="t('exports.description')" />

  <div class="grid gap-4 sm:grid-cols-2">
    <button v-for="k in KINDS" :key="k.value" type="button" :data-testid="`export-card-${k.value}`" :aria-pressed="form.kind === k.value"
      class="flex flex-col items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted"
      :class="form.kind === k.value ? 'border-primary ring-[3px] ring-accent' : ''" @click="form.kind = k.value">
      <span class="text-[17px] font-semibold">{{ t(`ov.exp.kind.${k.value}` as MessageKey) }}</span>
      <span class="text-sm text-muted-foreground">{{ t(`ov.exp.desc.${k.value}` as MessageKey) }}</span>
      <Badge variant="accent">CSV</Badge>
    </button>
  </div>

  <Card>
    <form @submit.prevent="request">
      <CardContent class="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="space-y-2">
          <Label for="export-kind">{{ t('exports.export') }}</Label>
          <AppNativeSelect id="export-kind" v-model="form.kind" data-testid="export-kind"><option v-for="k in KINDS" :key="k.value" :value="k.value">{{ t(k.label) }}</option></AppNativeSelect>
        </div>
        <div class="space-y-2"><Label for="export-from">{{ t('common.from') }}</Label><Input id="export-from" v-model="form.from" type="date" required data-testid="export-from" /></div>
        <div class="space-y-2"><Label for="export-to">{{ t('common.to') }}</Label><Input id="export-to" v-model="form.to" type="date" required data-testid="export-to" /></div>
        <div class="flex lg:justify-end"><Button data-testid="export-request">{{ t('common.requestExport') }}</Button></div>
      </CardContent>
    </form>
  </Card>

  <AppErrorNote v-if="error" data-testid="error">{{ error }}</AppErrorNote>

  <Card>
    <CardContent>
      <div class="overflow-hidden rounded-md border">
        <Table>
          <TableHeader class="bg-muted [&_th]:text-xs [&_th]:font-medium [&_th]:text-text-secondary">
            <TableRow class="hover:bg-muted"><TableHead class="px-4">{{ t('exports.requested') }}</TableHead><TableHead>{{ t('exports.kind') }}</TableHead><TableHead>{{ t('common.period') }}</TableHead><TableHead>{{ t('common.status') }}</TableHead><TableHead class="px-4">{{ t('exports.download') }}</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="e in rows" :key="e.id" class="h-[52px]" data-testid="export-row" :data-status="e.status">
              <TableCell class="px-4">{{ amsterdam(e.createdAt) }}</TableCell>
              <TableCell class="font-medium">{{ te(`ov.exp.kind.${e.kind}`) ? t(`ov.exp.kind.${e.kind}` as MessageKey) : e.kind }}</TableCell>
              <TableCell class="tabular-nums">{{ t('exports.period', { from: e.periodFrom, to: e.periodTo }) }}</TableCell>
              <TableCell><AppStatusBadge :status="e.status" data-testid="export-status" /></TableCell>
              <TableCell class="px-4"><Button v-if="e.link" variant="outline" size="sm" as-child><a :href="e.link" data-testid="export-link">{{ t('exports.downloadLink') }}</a></Button></TableCell>
            </TableRow>
            <TableRow v-if="!rows.length" class="hover:bg-transparent"><TableCell colspan="5" class="h-[52px] text-center text-muted-foreground">{{ t('exports.empty') }}</TableCell></TableRow>
          </TableBody>
        </Table>
      </div>
    </CardContent>
  </Card>
</template>
