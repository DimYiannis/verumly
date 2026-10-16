<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface SalesRow { period: string; receipts: number; gross: number; net: number; vat: number; voids: number }
interface Row { id: string; locationName: string; state: string; currentVersion: number; totalMinor: number; createdAt: string }

const { t } = useLocale();
const DAYS = 30;
const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const sales = ref<SalesRow[]>([]);
const recent = ref<Row[]>([]);
const error = ref('');
const loaded = ref(false);

onMounted(async () => {
  const [r, a] = await Promise.all([
    attempt(error, () => $fetch<{ sales: SalesRow[] }>('/api/dashboard/reports', { query: { from: iso(new Date(today.getTime() - DAYS * 86400_000)), to: iso(today), granularity: 'month' } })),
    attempt(error, () => $fetch<Row[]>('/api/dashboard/archive', { query: { limit: 6 } })),
  ]);
  if (r) sales.value = r.sales;
  if (a) recent.value = a;
  loaded.value = true;
});

const total = computed(() => sales.value.reduce((t, r) => ({ receipts: t.receipts + r.receipts, gross: t.gross + r.gross, vat: t.vat + r.vat, voids: t.voids + r.voids }), { receipts: 0, gross: 0, vat: 0, voids: 0 }));
const stats = computed(() => [
  { label: t('overview.sales'), value: euro(total.value.gross), id: 'overview-gross' },
  { label: t('overview.receipts'), value: String(total.value.receipts), id: 'overview-receipts' },
  { label: t('common.btw'), value: euro(total.value.vat), id: 'overview-vat' },
  { label: t('overview.voids'), value: String(total.value.voids), id: 'overview-voids' },
]);
</script>

<template>
  <AppPageHeading :title="t('nav.overview')" :description="t('overview.description', { days: DAYS })">
    <Button as-child><NuxtLink to="/dashboard/exports">{{ t('common.requestExport') }}</NuxtLink></Button>
  </AppPageHeading>
  <AppErrorNote v-if="error" data-testid="error">{{ error }}</AppErrorNote>

  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <Card v-for="s in stats" :key="s.id" class="gap-1">
      <CardHeader><CardDescription>{{ s.label }}</CardDescription></CardHeader>
      <CardContent><p class="text-3xl font-medium tracking-tight tabular-nums" :data-testid="s.id">{{ loaded ? s.value : '-' }}</p></CardContent>
    </Card>
  </div>

  <Card>
    <CardHeader>
      <CardTitle class="text-base">{{ t('overview.recent') }}</CardTitle>
      <CardAction><Button variant="outline" as-child><NuxtLink to="/dashboard/archive">{{ t('overview.viewArchive') }}</NuxtLink></Button></CardAction>
    </CardHeader>
    <CardContent>
      <div class="overflow-hidden rounded-md border">
        <Table>
          <TableHeader class="bg-muted [&_th]:text-xs [&_th]:font-medium [&_th]:text-text-secondary">
            <TableRow class="hover:bg-muted"><TableHead class="px-4">{{ t('common.time') }}</TableHead><TableHead>{{ t('common.location') }}</TableHead><TableHead>{{ t('common.state') }}</TableHead><TableHead class="px-4 text-right">{{ t('common.total') }}</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="r in recent" :key="r.id" class="h-[52px] cursor-pointer" data-testid="overview-row" @click="navigateTo(`/dashboard/archive/${r.id}`)">
              <TableCell class="px-4 font-medium">{{ amsterdam(r.createdAt) }}</TableCell>
              <TableCell>{{ r.locationName }}</TableCell>
              <TableCell><AppStatusBadge :status="r.state" /></TableCell>
              <TableCell class="px-4 text-right tabular-nums">{{ euro(r.totalMinor) }}</TableCell>
            </TableRow>
            <TableRow v-if="loaded && !recent.length" class="hover:bg-transparent"><TableCell colspan="4" class="h-[52px] text-center text-muted-foreground">{{ t('overview.empty') }}</TableCell></TableRow>
          </TableBody>
        </Table>
      </div>
    </CardContent>
  </Card>
</template>
