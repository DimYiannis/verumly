<script setup lang="ts">
import { ApiError } from '~/utils/api';
import type { Insights } from '~/utils/api-schemas';

definePageMeta({ middleware: 'auth' });
useHead({ title: 'Insights' });

const wallet = useWallet();
const data = ref<Insights | null>(null);
const error = ref<string | null>(null);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel(month: string): string {
  const m = /^\d{4}-(\d{2})$/.exec(month);
  return (m && MONTHS[Number(m[1]) - 1]) || month;
}

const CATEGORY_LABEL: Record<string, string> = {
  dining: 'Dining',
  boodschappen: 'Groceries',
  huishouden: 'Household',
  vervoer: 'Transport',
  kleding: 'Clothing',
  elektronica: 'Electronics',
  statiegeld: 'Deposit',
  gezondheid: 'Health',
  overig: 'Other',
};

onMounted(async () => {
  try {
    data.value = await wallet.api.insights();
  } catch (e) {
    error.value = e instanceof ApiError && e.isNetwork ? 'Insights are only available online.' : 'Loading insights failed.';
  }
});
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-bold">Insights</h1>
    <p v-if="error" role="alert" class="card">{{ error }}</p>
    <p v-else-if="!data" role="status">Loading…</p>
    <template v-else>
      <p v-if="data.perMonth.length === 0" class="card" data-testid="no-insights">No data yet. Save a few receipts to see your spending.</p>
      <template v-else>
        <BarChart testid="chart-months" title="Spending per month" :items="data.perMonth.map((m) => ({ label: monthLabel(m.month), value: m.total }))" />
        <HBarChart testid="chart-categories" title="By category" :items="data.perCategory.map((c) => ({ label: CATEGORY_LABEL[c.category] ?? c.category, value: c.total }))" />
        <HBarChart testid="chart-merchants" title="Most visited shops" :items="data.topMerchants.map((m) => ({ label: m.merchantName, value: m.total }))" />
      </template>
    </template>
  </div>
</template>
