<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface SalesRow { period: string; receipts: number; gross: number; net: number; vat: number; tip: number; rounding: number; voids: number; voidGross: number }
interface VatRow { period: string; rate: number; gross: number; net: number; vat: number }
interface Loc { id: string; name: string }

const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const filters = reactive({ from: iso(new Date(today.getTime() - 30 * 86400_000)), to: iso(today), granularity: 'day', locationId: '' });
const sales = ref<SalesRow[]>([]);
const vat = ref<VatRow[]>([]);
const locations = ref<Loc[]>([]);
const error = ref('');

async function load() {
  const r = await attempt(error, () =>
    $fetch<{ sales: SalesRow[]; vatByRate: VatRow[] }>('/api/dashboard/reports', { query: { from: filters.from, to: filters.to, granularity: filters.granularity, ...(filters.locationId && { locationId: filters.locationId }) } }),
  );
  if (r) {
    sales.value = r.sales;
    vat.value = r.vatByRate;
  }
}
onMounted(async () => {
  locations.value = (await attempt(error, () => $fetch<Loc[]>('/api/dashboard/locations'))) ?? [];
  await load();
});

const total = computed(() => sales.value.reduce((t, r) => ({ receipts: t.receipts + r.receipts, gross: t.gross + r.gross, net: t.net + r.net, vat: t.vat + r.vat, voids: t.voids + r.voids }), { receipts: 0, gross: 0, net: 0, vat: 0, voids: 0 }));
const RUBRIEK: Record<number, string> = { 21: '1a', 9: '1b', 0: '1e' };
</script>

<template>
  <AppPageHeading title="Reports" description="Sales and BTW for the period you choose." />

  <Card>
    <form @submit.prevent="load">
      <CardContent class="grid items-end gap-6 sm:grid-cols-2 lg:grid-cols-5">
        <div class="space-y-2"><Label for="report-from">From</Label><Input id="report-from" v-model="filters.from" type="date" required data-testid="report-from" /></div>
        <div class="space-y-2"><Label for="report-to">To</Label><Input id="report-to" v-model="filters.to" type="date" required data-testid="report-to" /></div>
        <div class="space-y-2">
          <Label for="report-granularity">Per</Label>
          <AppNativeSelect id="report-granularity" v-model="filters.granularity" data-testid="report-granularity"><option value="day">day</option><option value="month">month</option></AppNativeSelect>
        </div>
        <div class="space-y-2">
          <Label for="report-location">Location</Label>
          <AppNativeSelect id="report-location" v-model="filters.locationId" data-testid="report-location"><option value="">all</option><option v-for="l in locations" :key="l.id" :value="l.id">{{ l.name }}</option></AppNativeSelect>
        </div>
        <div><Button data-testid="report-run">Show</Button></div>
      </CardContent>
    </form>
  </Card>

  <AppErrorNote v-if="error" data-testid="error">{{ error }}</AppErrorNote>

  <Card>
    <CardHeader><CardTitle class="text-base">Sales</CardTitle></CardHeader>
    <CardContent>
      <div class="overflow-hidden rounded-md border">
        <Table>
          <TableHeader class="bg-muted [&_th]:text-xs [&_th]:font-medium [&_th]:text-text-secondary">
            <TableRow class="hover:bg-muted"><TableHead class="px-4">Period</TableHead><TableHead class="text-right">Receipts</TableHead><TableHead class="text-right">Gross</TableHead><TableHead class="text-right">Net</TableHead><TableHead class="text-right">BTW</TableHead><TableHead class="text-right">Rounding</TableHead><TableHead class="px-4 text-right">Voids</TableHead></TableRow>
          </TableHeader>
          <TableBody class="tabular-nums">
            <TableRow v-for="r in sales" :key="r.period" class="h-[52px]" data-testid="report-sales-row" :data-period="r.period">
              <TableCell class="px-4">{{ r.period }}</TableCell><TableCell class="text-right">{{ r.receipts }}</TableCell><TableCell class="text-right">{{ euro(r.gross) }}</TableCell><TableCell class="text-right">{{ euro(r.net) }}</TableCell><TableCell class="text-right">{{ euro(r.vat) }}</TableCell><TableCell class="text-right">{{ euro(r.rounding) }}</TableCell><TableCell class="px-4 text-right">{{ r.voids }} ({{ euro(r.voidGross) }})</TableCell>
            </TableRow>
            <TableRow v-if="!sales.length" class="hover:bg-transparent"><TableCell colspan="7" class="h-[52px] text-center text-muted-foreground" data-testid="report-empty">No sales in this period.</TableCell></TableRow>
            <TableRow v-else class="h-[52px] bg-muted/50 font-medium" data-testid="report-total">
              <TableCell class="px-4">Total</TableCell><TableCell class="text-right">{{ total.receipts }}</TableCell><TableCell class="text-right">{{ euro(total.gross) }}</TableCell><TableCell class="text-right">{{ euro(total.net) }}</TableCell><TableCell class="text-right">{{ euro(total.vat) }}</TableCell><TableCell /><TableCell class="px-4 text-right">{{ total.voids }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </CardContent>
  </Card>

  <Card>
    <CardHeader><CardTitle class="text-base">BTW per rate</CardTitle></CardHeader>
    <CardContent>
      <div class="overflow-hidden rounded-md border">
        <Table>
          <TableHeader class="bg-muted [&_th]:text-xs [&_th]:font-medium [&_th]:text-text-secondary">
            <TableRow class="hover:bg-muted"><TableHead class="px-4">Period</TableHead><TableHead>Rate</TableHead><TableHead>Rubriek</TableHead><TableHead class="text-right">Gross</TableHead><TableHead class="text-right">Net</TableHead><TableHead class="px-4 text-right">BTW</TableHead></TableRow>
          </TableHeader>
          <TableBody class="tabular-nums">
            <TableRow v-for="r in vat" :key="`${r.period}-${r.rate}`" class="h-[52px]" data-testid="report-vat-row" :data-period="r.period" :data-rate="r.rate">
              <TableCell class="px-4">{{ r.period }}</TableCell><TableCell>{{ r.rate }}%</TableCell><TableCell>{{ RUBRIEK[r.rate] }}</TableCell><TableCell class="text-right">{{ euro(r.gross) }}</TableCell><TableCell class="text-right">{{ euro(r.net) }}</TableCell><TableCell class="px-4 text-right">{{ euro(r.vat) }}</TableCell>
            </TableRow>
            <TableRow v-if="!vat.length" class="hover:bg-transparent"><TableCell colspan="6" class="h-[52px] text-center text-muted-foreground">No BTW in this period.</TableCell></TableRow>
          </TableBody>
        </Table>
      </div>
    </CardContent>
  </Card>
</template>
