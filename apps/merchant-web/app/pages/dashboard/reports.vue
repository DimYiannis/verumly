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
  <h1 class="mb-4 text-xl font-semibold">Reports</h1>
  <form class="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4" @submit.prevent="load">
    <label class="text-sm">From<input v-model="filters.from" type="date" required data-testid="report-from" class="mt-1 block rounded border border-slate-300 px-3 py-2" /></label>
    <label class="text-sm">To<input v-model="filters.to" type="date" required data-testid="report-to" class="mt-1 block rounded border border-slate-300 px-3 py-2" /></label>
    <label class="text-sm">Per
      <select v-model="filters.granularity" data-testid="report-granularity" class="mt-1 block rounded border border-slate-300 px-3 py-2"><option value="day">day</option><option value="month">month</option></select>
    </label>
    <label class="text-sm">Location
      <select v-model="filters.locationId" data-testid="report-location" class="mt-1 block rounded border border-slate-300 px-3 py-2"><option value="">all</option><option v-for="l in locations" :key="l.id" :value="l.id">{{ l.name }}</option></select>
    </label>
    <button data-testid="report-run" class="rounded bg-slate-900 px-4 py-2 text-white">Show</button>
  </form>
  <p v-if="error" class="mb-3 text-sm text-red-700" role="alert" data-testid="error">{{ error }}</p>

  <h2 class="mb-2 font-medium">Sales</h2>
  <table class="mb-6 w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
    <thead class="bg-slate-100 text-left"><tr><th class="p-2">Period</th><th class="p-2 text-right">Receipts</th><th class="p-2 text-right">Gross</th><th class="p-2 text-right">Net</th><th class="p-2 text-right">BTW</th><th class="p-2 text-right">Rounding</th><th class="p-2 text-right">Voids</th></tr></thead>
    <tbody class="tabular-nums">
      <tr v-for="r in sales" :key="r.period" class="border-t border-slate-100" data-testid="report-sales-row" :data-period="r.period">
        <td class="p-2">{{ r.period }}</td><td class="p-2 text-right">{{ r.receipts }}</td><td class="p-2 text-right">{{ euro(r.gross) }}</td><td class="p-2 text-right">{{ euro(r.net) }}</td><td class="p-2 text-right">{{ euro(r.vat) }}</td><td class="p-2 text-right">{{ euro(r.rounding) }}</td><td class="p-2 text-right">{{ r.voids }} ({{ euro(r.voidGross) }})</td>
      </tr>
      <tr v-if="!sales.length"><td colspan="7" class="p-4 text-center text-slate-500" data-testid="report-empty">No sales in this period.</td></tr>
      <tr v-else class="border-t-2 border-slate-300 font-semibold" data-testid="report-total">
        <td class="p-2">Total</td><td class="p-2 text-right">{{ total.receipts }}</td><td class="p-2 text-right">{{ euro(total.gross) }}</td><td class="p-2 text-right">{{ euro(total.net) }}</td><td class="p-2 text-right">{{ euro(total.vat) }}</td><td class="p-2" /><td class="p-2 text-right">{{ total.voids }}</td>
      </tr>
    </tbody>
  </table>

  <h2 class="mb-2 font-medium">BTW per rate</h2>
  <table class="w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
    <thead class="bg-slate-100 text-left"><tr><th class="p-2">Period</th><th class="p-2">Rate</th><th class="p-2">Rubriek</th><th class="p-2 text-right">Gross</th><th class="p-2 text-right">Net</th><th class="p-2 text-right">BTW</th></tr></thead>
    <tbody class="tabular-nums">
      <tr v-for="r in vat" :key="`${r.period}-${r.rate}`" class="border-t border-slate-100" data-testid="report-vat-row" :data-period="r.period" :data-rate="r.rate">
        <td class="p-2">{{ r.period }}</td><td class="p-2">{{ r.rate }}%</td><td class="p-2">{{ RUBRIEK[r.rate] }}</td><td class="p-2 text-right">{{ euro(r.gross) }}</td><td class="p-2 text-right">{{ euro(r.net) }}</td><td class="p-2 text-right">{{ euro(r.vat) }}</td>
      </tr>
    </tbody>
  </table>
</template>
