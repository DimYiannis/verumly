<script setup lang="ts">
import type { MessageKey } from '~/i18n';
import { ApiError } from '~/utils/api';
import type { Insights } from '~/utils/api-schemas';
import { formatMoney } from '~/utils/format';

definePageMeta({ middleware: 'auth' });
const { t, tOr, locale } = useLocale();
useHead({ title: () => t('insights.title') });

const wallet = useWallet();
const data = ref<Insights | null>(null);
const error = ref<MessageKey | null>(null);
/** the Insights consent (Settings) is off: the API computes nothing */
const consentOff = ref(false);

function monthLabel(month: string): string {
  const m = /^\d{4}-(\d{2})$/.exec(month);
  return (m && t('insights.months').split(',')[Number(m[1]) - 1]) || month;
}

/** The three Dutch rates (also at zero), unless some VAT is at another rate: then the rates that have VAT, highest first. */
const NL_RATES = [21, 9, 0];
const vatItems = computed(() => {
  const found = data.value?.vatPerRate ?? [];
  const dutch = found.every((v) => NL_RATES.includes(v.rate));
  const rates = dutch ? NL_RATES : found.map((v) => v.rate).sort((a, b) => b - a);
  return rates.map((rate) => ({ label: t('insights.vatRate', { rate }), value: found.find((v) => v.rate === rate)?.vat ?? 0 }));
});

onMounted(async () => {
  try {
    data.value = await wallet.api.insights();
  } catch (e) {
    if (e instanceof ApiError && e.status === 403 && e.code === 'consent_required') {
      consentOff.value = true;
      return;
    }
    error.value = e instanceof ApiError && e.isNetwork ? 'insights.err.offline' : 'insights.err.failed';
  }
});
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between"><h1 class="text-h2 font-semibold">{{ t('insights.title') }}</h1></div>
    <section v-if="consentOff" class="space-y-2 rounded-xl border border-border bg-card p-4" data-testid="insights-consent-off">
      <h2 class="text-h3 font-semibold">{{ t('insights.consentOff.title') }}</h2>
      <p class="text-text-secondary">{{ t('insights.consentOff.body') }}</p>
      <Button as-child variant="secondary" size="sm"><NuxtLink to="/settings" class="no-underline" data-testid="insights-consent-link">{{ t('insights.consentOff.link') }}</NuxtLink></Button>
    </section>
    <p v-else-if="error" role="alert" class="rounded-xl border border-danger-border bg-danger-soft p-4 text-sm text-danger">{{ t(error) }}</p>
    <div v-else-if="!data" class="space-y-4">
      <p role="status" class="flex items-center gap-2 text-sm text-text-secondary">
        <Spinner role="presentation" aria-hidden="true" />
        {{ t('common.loading') }}
      </p>
      <Skeleton class="h-48 w-full" />
    </div>
    <template v-else>
      <p v-if="data.perMonth.length === 0" class="rounded-xl border border-border bg-card p-4 text-text-secondary" data-testid="no-insights">{{ t('insights.empty') }}</p>
      <template v-else>
        <DonutChart :currency="data.currency" testid="chart-categories" :title="t('insights.perCategory')" :items="data.perCategory.map((c) => ({ label: tOr('category', c.category), value: c.total }))" />
        <BarChart :currency="data.currency" testid="chart-months" :title="t('insights.perMonth')" :items="data.perMonth.map((m) => ({ label: monthLabel(m.month), value: m.total }))" />
        <HBarChart :currency="data.currency" testid="chart-vat" :title="t('insights.vatPerRate')" :items="vatItems" />
        <p class="-mt-2 text-xs text-text-secondary">{{ t('insights.vatNote') }}</p>
        <HBarChart :currency="data.currency" testid="chart-merchants" :title="t('insights.topMerchants')" :items="data.topMerchants.map((m) => ({ label: m.merchantName, value: m.total }))" />
      </template>
      <p v-if="data.refunds.count > 0" class="text-sm text-text-secondary" data-testid="insights-refunds">{{ t('insights.refunds', { amount: formatMoney(data.refunds.total, locale, data.currency) }) }}</p>
    </template>
  </div>
</template>
