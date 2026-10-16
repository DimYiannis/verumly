<script setup lang="ts">
import { ApiError } from '~/utils/api';
import type { Insights } from '~/utils/api-schemas';

definePageMeta({ middleware: 'auth' });
useHead({ title: 'Inzichten' });

const wallet = useWallet();
const data = ref<Insights | null>(null);
const error = ref<string | null>(null);

const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
function monthLabel(month: string): string {
  const m = /^\d{4}-(\d{2})$/.exec(month);
  return (m && MONTHS[Number(m[1]) - 1]) || month;
}

const CATEGORY_LABEL: Record<string, string> = {
  dining: 'Eten & drinken',
  boodschappen: 'Boodschappen',
  huishouden: 'Huishouden',
  vervoer: 'Vervoer',
  kleding: 'Kleding',
  elektronica: 'Elektronica',
  statiegeld: 'Statiegeld',
  gezondheid: 'Gezondheid',
  overig: 'Overig',
};

onMounted(async () => {
  try {
    data.value = await wallet.api.insights();
  } catch (e) {
    error.value = e instanceof ApiError && e.isNetwork ? 'Inzichten zijn alleen online beschikbaar.' : 'Inzichten laden is niet gelukt.';
  }
});
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-bold">Inzichten</h1>
    <p v-if="error" role="alert" class="card">{{ error }}</p>
    <p v-else-if="!data" role="status">Laden…</p>
    <template v-else>
      <p v-if="data.perMonth.length === 0" class="card" data-testid="no-insights">Nog geen gegevens. Sla een paar bonnen op om je uitgaven te zien.</p>
      <template v-else>
        <BarChart testid="chart-months" title="Uitgaven per maand" :items="data.perMonth.map((m) => ({ label: monthLabel(m.month), value: m.total }))" />
        <HBarChart testid="chart-categories" title="Per categorie" :items="data.perCategory.map((c) => ({ label: CATEGORY_LABEL[c.category] ?? c.category, value: c.total }))" />
        <HBarChart testid="chart-merchants" title="Meest bezochte winkels" :items="data.topMerchants.map((m) => ({ label: m.merchantName, value: m.total }))" />
      </template>
    </template>
  </div>
</template>
