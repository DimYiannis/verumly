<script setup lang="ts">
import { RefreshCwIcon } from '@lucide/vue';

definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Row { id: string; locationName: string; state: string; currentVersion: number; totalMinor: number; createdAt: string; receivedAt: string }
const { t, tx } = useLocale();
const PAGE = 50;
const rows = ref<Row[]>([]);
const error = ref('');
const loading = ref(false);
const offset = ref(0);
const filters = reactive({ q: '', state: '', from: '', to: '', amount: '' });

function euroToCents(s: string): number | undefined {
  const m = /^\s*(\d+)(?:[.,](\d{1,2}))?\s*$/.exec(s);
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0) : undefined;
}

async function load() {
  loading.value = true;
  const query = { ...(filters.q && { q: filters.q }), ...(filters.state && { state: filters.state }), ...(filters.from && { from: filters.from }), ...(filters.to && { to: filters.to }), limit: PAGE, offset: offset.value, ...(euroToCents(filters.amount) !== undefined && { amount: euroToCents(filters.amount) }) };
  const r = await attempt(error, () => $fetch<Row[]>('/api/dashboard/archive', { query }));
  loading.value = false;
  if (r) rows.value = r;
}
onMounted(load);

function search() {
  offset.value = 0;
  return load();
}
function page(delta: number) {
  offset.value = Math.max(0, offset.value + delta * PAGE);
  return load();
}
</script>

<template>
  <AppPageHeading :title="t('archive.title')" :description="t('archive.description')">
    <Button variant="outline" data-testid="archive-refresh" @click="load"><RefreshCwIcon />{{ t('archive.refresh') }}</Button>
  </AppPageHeading>

  <Card>
    <CardContent>
      <form class="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-6" @submit.prevent="search">
        <div class="space-y-2 lg:col-span-2"><Label for="archive-q">{{ t('common.search') }}</Label><Input id="archive-q" v-model="filters.q" :placeholder="t('archive.searchPlaceholder')" data-testid="archive-q" /></div>
        <div class="space-y-2">
          <Label for="archive-state">{{ t('common.state') }}</Label>
          <AppNativeSelect id="archive-state" v-model="filters.state" data-testid="archive-state">
            <option value="">{{ t('common.any') }}</option><option v-for="s in ['presented', 'paid', 'void', 'open']" :key="s" :value="s">{{ tx('status', s) }}</option>
          </AppNativeSelect>
        </div>
        <div class="space-y-2"><Label for="archive-from">{{ t('common.from') }}</Label><Input id="archive-from" v-model="filters.from" type="date" data-testid="archive-from" /></div>
        <div class="space-y-2"><Label for="archive-to">{{ t('common.to') }}</Label><Input id="archive-to" v-model="filters.to" type="date" data-testid="archive-to" /></div>
        <div class="space-y-2"><Label for="archive-amount">{{ t('archive.amount') }}</Label><Input id="archive-amount" v-model="filters.amount" placeholder="12,50" data-testid="archive-amount" /></div>
        <div class="sm:col-span-2 lg:col-span-6"><Button data-testid="archive-search">{{ t('common.search') }}</Button></div>
      </form>
    </CardContent>
  </Card>

  <AppErrorNote v-if="error" data-testid="error">{{ error }}</AppErrorNote>

  <Card>
    <CardContent class="space-y-4">
      <div class="overflow-hidden rounded-md border">
        <Table data-testid="archive-table">
          <TableHeader class="bg-muted [&_th]:text-xs [&_th]:font-medium [&_th]:text-text-secondary">
            <TableRow class="hover:bg-muted">
              <TableHead class="px-4">{{ t('common.time') }}</TableHead><TableHead>{{ t('common.location') }}</TableHead><TableHead>{{ t('common.state') }}</TableHead><TableHead>{{ t('archive.version') }}</TableHead><TableHead class="px-4 text-right">{{ t('common.total') }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="r in rows" :key="r.id" class="h-[52px] cursor-pointer" data-testid="archive-row" :data-receipt-id="r.id" :data-state="r.state" @click="navigateTo(`/dashboard/archive/${r.id}`)">
              <TableCell class="px-4"><NuxtLink :to="`/dashboard/archive/${r.id}`" class="font-medium hover:underline" data-testid="archive-link">{{ amsterdam(r.createdAt) }}</NuxtLink></TableCell>
              <TableCell>{{ r.locationName }}</TableCell>
              <TableCell><AppStatusBadge :status="r.state" data-testid="archive-state-cell" /></TableCell>
              <TableCell class="tabular-nums">v{{ r.currentVersion }}</TableCell>
              <TableCell class="px-4 text-right tabular-nums" data-testid="archive-total">{{ euro(r.totalMinor) }}</TableCell>
            </TableRow>
            <TableRow v-if="!rows.length && !loading" class="hover:bg-transparent"><TableCell colspan="5" class="h-[52px] text-center text-muted-foreground" data-testid="archive-empty">{{ t('archive.empty') }}</TableCell></TableRow>
          </TableBody>
        </Table>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" :disabled="offset === 0" data-testid="archive-prev" @click="page(-1)">{{ t('archive.previous') }}</Button>
        <Button variant="outline" :disabled="rows.length < PAGE" data-testid="archive-next" @click="page(1)">{{ t('archive.next') }}</Button>
      </div>
    </CardContent>
  </Card>
</template>
