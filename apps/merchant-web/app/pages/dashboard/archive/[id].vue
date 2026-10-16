<script setup lang="ts">
import type { Crf } from '@lr/schema';

definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Detail { id: string; state: string; currentVersion: number; totalMinor: number; versions: Array<{ version: number; state: string; receivedAt: string; crf: Crf }> }
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
  <NuxtLink to="/dashboard/archive" class="text-sm text-slate-600 underline">← Archive</NuxtLink>
  <h1 class="mb-1 mt-2 text-xl font-semibold">Receipt <span class="font-mono text-base" data-testid="archive-detail-id">{{ id }}</span></h1>
  <p v-if="error" class="mb-3 text-sm text-red-700" role="alert" data-testid="error">{{ error }}</p>
  <p v-if="detail" class="mb-4 text-sm text-slate-600">Current: <span data-testid="archive-detail-state">{{ detail.state }}</span> · v{{ detail.currentVersion }} · {{ euro(detail.totalMinor) }}</p>

  <section v-for="v in newestFirst" :key="v.version" class="mb-4 rounded-lg border border-slate-200 bg-white p-4" data-testid="archive-version" :data-version="v.version">
    <div class="mb-2 flex items-center justify-between">
      <h2 class="font-medium">Version {{ v.version }} · {{ v.state }} <span class="text-sm font-normal text-slate-500">{{ amsterdam(v.crf.createdAt) }}</span></h2>
      <a :href="`/api/dashboard/archive/${id}/pdf?version=${v.version}`" class="rounded border border-slate-300 px-3 py-1 text-sm" data-testid="archive-pdf" download>PDF</a>
    </div>
    <table class="w-full text-sm">
      <thead class="text-left text-slate-500"><tr><th class="py-1">Item</th><th>Qty</th><th>BTW</th><th class="text-right">Total</th></tr></thead>
      <tbody>
        <tr v-for="l in v.crf.lines" :key="l.lineNo" data-testid="archive-line">
          <td class="py-1">{{ l.description }}</td><td>{{ l.qty }}</td><td>{{ l.vatRate === null ? '—' : `${l.vatRate}%` }}</td><td class="text-right tabular-nums">{{ euro(l.total) }}</td>
        </tr>
      </tbody>
    </table>
    <dl class="mt-3 space-y-1 text-sm">
      <div v-for="s in v.crf.vatSummary" :key="s.rate" class="flex justify-between" data-testid="archive-vat"><dt>BTW {{ s.rate }}% over {{ euro(s.net) }}</dt><dd class="tabular-nums">{{ euro(s.vat) }}</dd></div>
      <div v-if="v.crf.totals.rounding" class="flex justify-between"><dt>Rounding</dt><dd class="tabular-nums">{{ euro(v.crf.totals.rounding) }}</dd></div>
      <div class="flex justify-between font-semibold"><dt>Total</dt><dd class="tabular-nums" data-testid="archive-version-total">{{ euro(v.crf.totals.gross + v.crf.totals.tip + v.crf.totals.rounding) }}</dd></div>
      <div v-for="(p, i) in v.crf.payments" :key="i" class="flex justify-between text-slate-600"><dt>Paid ({{ p.method }})</dt><dd class="tabular-nums">{{ euro(p.amount) }}</dd></div>
    </dl>
  </section>
</template>
