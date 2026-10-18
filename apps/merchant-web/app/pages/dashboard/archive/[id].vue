<script setup lang="ts">
import { ArrowLeftIcon, FileDownIcon } from '@lucide/vue';
import type { Crf } from '@lr/schema';

definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Detail { id: string; state: string; currentVersion: number; totalMinor: number; versions: Array<{ version: number; state: string; receivedAt: string; crf: Crf }> }
const { t, tx, intlLocale } = useLocale();
const route = useRoute();
const id = String(route.params.id);
const detail = ref<Detail | null>(null);
const error = ref('');

onMounted(async () => {
  detail.value = (await attempt(error, () => $fetch<Detail>(`/api/dashboard/archive/${id}`))) ?? null;
});
const newestFirst = computed(() => [...(detail.value?.versions ?? [])].reverse());
const latest = computed(() => newestFirst.value[0]);
const first = computed(() => detail.value?.versions[0]);
const dot = (state: string) => (state === 'void' || state === 'failed' ? 'bg-danger' : state === 'paid' || state === 'fiscalised' ? 'bg-success' : 'bg-muted-foreground');
const country = computed(() => {
  const c = latest.value?.crf.fiscal.country;
  if (!c) return '';
  try {
    return new Intl.DisplayNames(intlLocale.value, { type: 'region' }).of(c.toUpperCase()) ?? c;
  } catch {
    return c;
  }
});
const methods = (v: Detail['versions'][number]) => v.crf.payments.map((p) => tx('archive.method', p.method)).join(', ');
</script>

<template>
  <div class="px-2 pt-2">
    <NuxtLink to="/dashboard/archive" class="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"><ArrowLeftIcon class="size-4" />{{ t('archive.back') }}</NuxtLink>
    <h1 class="mt-2 flex flex-wrap items-center gap-3 text-[30px] font-semibold leading-9 tracking-tight">
      <span v-if="detail" class="tabular-nums">{{ money(detail.totalMinor) }}</span>
      <span v-else>{{ t('archive.receipt') }}</span>
      <AppStatusBadge v-if="detail && detail.state === 'void'" :status="detail.state" data-testid="archive-detail-state" />
    </h1>
    <p class="mt-1 text-sm text-muted-foreground">
      <span class="font-mono" data-testid="archive-detail-id">{{ id }}</span>
      <span v-if="detail" class="tabular-nums"> · v{{ detail.currentVersion }}</span>
    </p>
  </div>
  <AppErrorNote v-if="error" data-testid="error">{{ error }}</AppErrorNote>

  <div v-if="detail" class="flex flex-wrap items-start gap-4">
    <div class="flex min-w-0 flex-[2_1_480px] flex-col gap-4">
      <Card>
        <CardContent class="flex flex-col gap-3">
          <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ t('ov.arch.timeline') }}</span>
          <div v-for="v in newestFirst" :key="v.version" class="flex items-start gap-3" data-testid="archive-timeline-item">
            <span class="mt-1 size-3 shrink-0 rounded-full" :class="dot(v.state)" />
            <div class="flex min-w-0 flex-col">
              <span class="text-[15px] font-medium">{{ t('ov.arch.versionState', { n: v.version, state: tx('status', v.state) }) }}</span>
              <span class="text-xs text-muted-foreground">{{ amsterdam(v.crf.createdAt) }}<template v-if="v.crf.payments.length"> · {{ methods(v) }}</template></span>
            </div>
          </div>
          <div v-if="first" class="flex items-start gap-3">
            <span class="mt-1 size-3 shrink-0 rounded-full bg-border" />
            <div class="flex min-w-0 flex-col">
              <span class="text-[15px] font-medium">{{ t('ov.arch.received') }}</span>
              <span class="text-xs text-muted-foreground">{{ amsterdam(first.receivedAt) }} · {{ t('ov.arch.signatureChecked') }}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card v-for="v in newestFirst" :key="v.version" data-testid="archive-version" :data-version="v.version">
        <CardHeader>
          <CardTitle class="flex flex-wrap items-center gap-2 text-base">
            {{ t('archive.versionN', { n: v.version }) }}
            <AppStatusBadge :status="v.state" />
            <span class="text-sm font-normal text-muted-foreground">{{ amsterdam(v.crf.createdAt) }}</span>
          </CardTitle>
          <CardAction>
            <Button variant="outline" as-child><a :href="`/api/dashboard/archive/${id}/pdf?version=${v.version}`" data-testid="archive-pdf" download><FileDownIcon />PDF</a></Button>
          </CardAction>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="overflow-hidden rounded-md border">
            <Table>
              <TableHeader class="bg-muted [&_th]:text-xs [&_th]:font-medium [&_th]:text-text-secondary">
                <TableRow class="hover:bg-muted"><TableHead class="px-4">{{ t('common.item') }}</TableHead><TableHead>{{ t('archive.qty') }}</TableHead><TableHead>{{ t('common.btw') }}</TableHead><TableHead class="px-4 text-right">{{ t('common.total') }}</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="l in v.crf.lines" :key="l.lineNo" class="h-[52px]" data-testid="archive-line">
                  <TableCell class="px-4">{{ l.description }}</TableCell>
                  <TableCell class="tabular-nums">{{ l.qty }}</TableCell>
                  <TableCell class="tabular-nums">{{ l.vatRate === null ? '-' : `${l.vatRate}%` }}</TableCell>
                  <TableCell class="px-4 text-right tabular-nums">{{ money(l.total) }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <dl class="ml-auto max-w-sm space-y-2 text-sm">
            <div v-for="s in v.crf.vatSummary" :key="s.rate" class="flex justify-between text-muted-foreground" data-testid="archive-vat"><dt>{{ t('archive.vatOver', { rate: s.rate, net: money(s.net) }) }}</dt><dd class="tabular-nums">{{ money(s.vat) }}</dd></div>
            <div v-if="v.crf.totals.rounding" class="flex justify-between text-muted-foreground"><dt>{{ t('common.rounding') }}</dt><dd class="tabular-nums">{{ money(v.crf.totals.rounding) }}</dd></div>
            <div class="flex justify-between border-t pt-2 text-base font-medium"><dt>{{ t('common.total') }}</dt><dd class="tabular-nums" data-testid="archive-version-total">{{ money(v.crf.totals.gross + v.crf.totals.tip + v.crf.totals.rounding) }}</dd></div>
            <div v-for="(p, i) in v.crf.payments" :key="i" class="flex justify-between text-muted-foreground"><dt>{{ t('archive.paidWith', { method: tx('archive.method', p.method) }) }}</dt><dd class="tabular-nums">{{ money(p.amount) }}</dd></div>
          </dl>
        </CardContent>
      </Card>
    </div>

    <div v-if="latest" class="flex min-w-[260px] flex-[1_1_300px] flex-col gap-4">
      <Card>
        <CardContent class="flex flex-col gap-2 text-sm">
          <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ t('ov.arch.vat') }}</span>
          <div v-for="s in latest.crf.vatSummary" :key="s.rate" class="flex justify-between"><span>{{ t('archive.vatOver', { rate: s.rate, net: money(s.net) }) }}</span><span class="font-mono tabular-nums">{{ money(s.vat) }}</span></div>
          <div class="flex justify-between"><span>{{ t('ov.arch.net') }}</span><span class="font-mono tabular-nums">{{ money(latest.crf.totals.net) }}</span></div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="flex flex-col gap-2 text-sm">
          <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ t('ov.arch.fiscal') }}</span>
          <div class="flex justify-between"><span>{{ t('ov.arch.country') }}</span><span>{{ country }}</span></div>
          <div v-if="latest.crf.fiscal.registerSerial" class="flex justify-between gap-2"><span>{{ t('ov.arch.register') }}</span><span class="truncate font-mono">{{ latest.crf.fiscal.registerSerial }}</span></div>
          <div v-if="latest.crf.fiscal.documentNumber" class="flex justify-between gap-2"><span>{{ t('ov.arch.document') }}</span><span class="truncate font-mono">{{ latest.crf.fiscal.documentNumber }}</span></div>
        </CardContent>
      </Card>
      <Card class="border-primary/30 bg-accent">
        <CardContent class="flex flex-col gap-2 text-sm text-accent-foreground">
          <span class="text-xs font-medium uppercase tracking-wide">{{ t('ov.arch.privacy') }}</span>
          <span>{{ t('ov.arch.privacyNote') }}</span>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
