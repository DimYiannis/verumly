<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Row { id: string; locationName: string; state: string; currentVersion: number; totalMinor: number; createdAt: string; receivedAt: string }
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
  <div class="mb-4 flex items-center justify-between">
    <h1 class="text-xl font-semibold">Receipt archive</h1>
    <button class="rounded border border-slate-300 px-3 py-1 text-sm" data-testid="archive-refresh" @click="load">Refresh</button>
  </div>
  <form class="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4" @submit.prevent="search">
    <label class="text-sm">Search<input v-model="filters.q" placeholder="item or receipt id" data-testid="archive-q" class="mt-1 block rounded border border-slate-300 px-3 py-2" /></label>
    <label class="text-sm">State
      <select v-model="filters.state" data-testid="archive-state" class="mt-1 block rounded border border-slate-300 px-3 py-2">
        <option value="">any</option><option>presented</option><option>paid</option><option>void</option><option>open</option>
      </select>
    </label>
    <label class="text-sm">From<input v-model="filters.from" type="date" data-testid="archive-from" class="mt-1 block rounded border border-slate-300 px-3 py-2" /></label>
    <label class="text-sm">To<input v-model="filters.to" type="date" data-testid="archive-to" class="mt-1 block rounded border border-slate-300 px-3 py-2" /></label>
    <label class="text-sm">Amount (€)<input v-model="filters.amount" placeholder="12,50" data-testid="archive-amount" class="mt-1 block w-28 rounded border border-slate-300 px-3 py-2" /></label>
    <button data-testid="archive-search" class="rounded bg-slate-900 px-4 py-2 text-white">Search</button>
  </form>
  <p v-if="error" class="mb-3 text-sm text-red-700" role="alert" data-testid="error">{{ error }}</p>
  <table class="w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-sm" data-testid="archive-table">
    <thead class="bg-slate-100 text-left"><tr><th class="p-2">Time (Amsterdam)</th><th class="p-2">Location</th><th class="p-2">State</th><th class="p-2">Version</th><th class="p-2 text-right">Total</th></tr></thead>
    <tbody>
      <tr v-for="r in rows" :key="r.id" class="cursor-pointer border-t border-slate-100 hover:bg-slate-50" data-testid="archive-row" :data-receipt-id="r.id" :data-state="r.state" @click="navigateTo(`/dashboard/archive/${r.id}`)">
        <td class="p-2"><NuxtLink :to="`/dashboard/archive/${r.id}`" data-testid="archive-link">{{ amsterdam(r.createdAt) }}</NuxtLink></td>
        <td class="p-2">{{ r.locationName }}</td>
        <td class="p-2"><span class="rounded bg-slate-100 px-2 py-0.5" data-testid="archive-state-cell">{{ r.state }}</span></td>
        <td class="p-2">v{{ r.currentVersion }}</td>
        <td class="p-2 text-right tabular-nums" data-testid="archive-total">{{ euro(r.totalMinor) }}</td>
      </tr>
      <tr v-if="!rows.length && !loading"><td colspan="5" class="p-4 text-center text-slate-500" data-testid="archive-empty">No receipts found.</td></tr>
    </tbody>
  </table>
  <div class="mt-3 flex items-center gap-3 text-sm">
    <button :disabled="offset === 0" class="rounded border border-slate-300 px-3 py-1 disabled:opacity-40" data-testid="archive-prev" @click="page(-1)">Previous</button>
    <button :disabled="rows.length < PAGE" class="rounded border border-slate-300 px-3 py-1 disabled:opacity-40" data-testid="archive-next" @click="page(1)">Next</button>
  </div>
</template>
