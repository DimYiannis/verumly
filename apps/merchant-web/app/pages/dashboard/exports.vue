<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Exp { id: string; kind: string; periodFrom: string; periodTo: string; status: string; createdAt: string; link: string | null; linkExpiresAt: string | null }
const KINDS = [
  { value: 'btw_csv', label: 'Accountant: VAT per day (VAT return boxes 1a / 1b / 1e)' },
  { value: 'sales_csv', label: 'Sales per receipt' },
];
const today = new Date().toISOString().slice(0, 10);
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
  <h1 class="mb-4 text-xl font-semibold">Exports</h1>
  <form class="mb-5 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4" @submit.prevent="request">
    <label class="text-sm">Export
      <select v-model="form.kind" data-testid="export-kind" class="mt-1 block rounded border border-slate-300 px-3 py-2"><option v-for="k in KINDS" :key="k.value" :value="k.value">{{ k.label }}</option></select>
    </label>
    <label class="text-sm">From<input v-model="form.from" type="date" required data-testid="export-from" class="mt-1 block rounded border border-slate-300 px-3 py-2" /></label>
    <label class="text-sm">To<input v-model="form.to" type="date" required data-testid="export-to" class="mt-1 block rounded border border-slate-300 px-3 py-2" /></label>
    <button data-testid="export-request" class="rounded bg-slate-900 px-4 py-2 text-white">Request export</button>
  </form>
  <p v-if="error" class="mb-3 text-sm text-red-700" role="alert" data-testid="error">{{ error }}</p>
  <table class="w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
    <thead class="bg-slate-100 text-left"><tr><th class="p-2">Requested</th><th class="p-2">Kind</th><th class="p-2">Period</th><th class="p-2">Status</th><th class="p-2">Download</th></tr></thead>
    <tbody>
      <tr v-for="e in rows" :key="e.id" class="border-t border-slate-100" data-testid="export-row" :data-status="e.status">
        <td class="p-2">{{ amsterdam(e.createdAt) }}</td><td class="p-2">{{ e.kind }}</td><td class="p-2">{{ e.periodFrom }} – {{ e.periodTo }}</td>
        <td class="p-2" data-testid="export-status">{{ e.status }}</td>
        <td class="p-2"><a v-if="e.link" :href="e.link" data-testid="export-link" class="underline">Download (valid 24 h)</a></td>
      </tr>
      <tr v-if="!rows.length"><td colspan="5" class="p-4 text-center text-slate-500">No exports yet.</td></tr>
    </tbody>
  </table>
</template>
