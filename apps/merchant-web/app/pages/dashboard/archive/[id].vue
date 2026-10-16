<script setup lang="ts">
import { ArrowLeftIcon, FileDownIcon } from '@lucide/vue';
import type { Crf } from '@lr/schema';

definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Detail { id: string; state: string; currentVersion: number; totalMinor: number; versions: Array<{ version: number; state: string; receivedAt: string; crf: Crf }> }
const { t, tx } = useLocale();
const route = useRoute();
const id = String(route.params.id);
const detail = ref<Detail | null>(null);
const error = ref('');

onMounted(async () => {
  detail.value = (await attempt(error, () => $fetch<Detail>(`/api/dashboard/archive/${id}`))) ?? null;
});
const newestFirst = computed(() => [...(detail.value?.versions ?? [])].reverse());
</script>

<template>
  <div class="px-2 pt-2">
    <NuxtLink to="/dashboard/archive" class="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"><ArrowLeftIcon class="size-4" />{{ t('archive.back') }}</NuxtLink>
    <h1 class="mt-2 text-2xl font-medium tracking-tight">{{ t('archive.receipt') }} <span class="font-mono text-base text-muted-foreground" data-testid="archive-detail-id">{{ id }}</span></h1>
    <p v-if="detail" class="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>{{ t('archive.currentState') }}</span><AppStatusBadge :status="detail.state" data-testid="archive-detail-state" /><span class="tabular-nums">v{{ detail.currentVersion }} · {{ euro(detail.totalMinor) }}</span>
    </p>
  </div>
  <AppErrorNote v-if="error" data-testid="error">{{ error }}</AppErrorNote>

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
              <TableCell class="px-4 text-right tabular-nums">{{ euro(l.total) }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <dl class="ml-auto max-w-sm space-y-2 text-sm">
        <div v-for="s in v.crf.vatSummary" :key="s.rate" class="flex justify-between text-muted-foreground" data-testid="archive-vat"><dt>{{ t('archive.vatOver', { rate: s.rate, net: euro(s.net) }) }}</dt><dd class="tabular-nums">{{ euro(s.vat) }}</dd></div>
        <div v-if="v.crf.totals.rounding" class="flex justify-between text-muted-foreground"><dt>{{ t('common.rounding') }}</dt><dd class="tabular-nums">{{ euro(v.crf.totals.rounding) }}</dd></div>
        <div class="flex justify-between border-t pt-2 text-base font-medium"><dt>{{ t('common.total') }}</dt><dd class="tabular-nums" data-testid="archive-version-total">{{ euro(v.crf.totals.gross + v.crf.totals.tip + v.crf.totals.rounding) }}</dd></div>
        <div v-for="(p, i) in v.crf.payments" :key="i" class="flex justify-between text-muted-foreground"><dt>{{ t('archive.paidWith', { method: tx('archive.method', p.method) }) }}</dt><dd class="tabular-nums">{{ euro(p.amount) }}</dd></div>
      </dl>
    </CardContent>
  </Card>
</template>
