<script setup lang="ts">
import { Ban } from '@lucide/vue';
import ReceiptTemplate from '@lr/ui/src/ReceiptTemplate.vue';
import { defaultReceiptTemplate } from '@lr/schema';
import type { ReceiptDetail } from '~/utils/api-schemas';
import { receiptContext } from '~/utils/country';
import { formatDateTime, formatMoney } from '~/utils/format';

const { t, tOr, locale } = useLocale();
const props = defineProps<{ detail: Pick<ReceiptDetail, 'receipt' | 'final' | 'versions'> & { template?: ReceiptDetail['template'] } }>();
const template = computed(() => props.detail.template ?? defaultReceiptTemplate());
const labels = computed(() => ({
  company: ctx.value.companyLabel,
  vat: ctx.value.vatLabel,
  total: t('receipt.total'),
  net: t('receipt.vatNet'),
  gross: t('receipt.vatGross'),
  rate: t('receipt.vatRate'),
  rounding: t('receipt.rounding'),
  tip: t('receipt.tip'),
  card: tOr('payment', 'card'),
  cash: tOr('payment', 'cash'),
  other: tOr('payment', 'other'),
  document: t('receipt.documentNo'),
  register: t('receipt.register'),
}));

const ctx = computed(() => receiptContext(props.detail.receipt.fiscal.country));

/** null = latest version */
const selected = ref<number | null>(null);
const latest = computed(() => props.detail.receipt);
const shown = computed(() => props.detail.versions.find((v) => v.version === selected.value)?.crf ?? latest.value);
const viewingOld = computed(() => shown.value.version !== latest.value.version);
</script>

<template>
  <article class="space-y-4" data-testid="receipt-view" :data-state="shown.state" :data-version="shown.version">
    <p
      v-if="shown.state === 'void'"
      role="status"
      data-testid="void-banner"
      class="rounded-xl border-2 border-danger bg-danger-soft p-4 text-center text-lg font-semibold text-danger"
    >
      <Ban class="mx-auto mb-1 size-6" aria-hidden="true" />
      {{ t('receipt.void') }}
    </p>
    <p v-if="viewingOld" role="status" data-testid="old-version-note" class="rounded-xl border border-border bg-muted p-3 text-center text-sm text-text-secondary">
      {{ t('receipt.oldVersion', { shown: shown.version, latest: latest.version }) }}
      <button type="button" class="min-h-11 font-semibold text-primary underline" @click="selected = null">{{ t('receipt.showLatest') }}</button>
    </p>

    <!-- the receipt as the merchant designed it (Dashboard > Receipt design); the default layout when none was saved -->
    <ReceiptTemplate :template="template" :receipt="shown" :money="(c: number) => formatMoney(c, locale, shown.currency)" :date-time="(iso: string) => formatDateTime(iso, locale, ctx.timeZone)" :labels="labels" :fiscal-labels="ctx.fiscalLabels" />
    <!-- an issued receipt is paid: only a later version (cancelled, corrected) is worth a line -->
    <p v-if="shown.state !== 'paid' || shown.version > 1" class="text-center text-sm text-text-secondary">{{ tOr('state', shown.state) }} · {{ t('receipt.version', { n: shown.version }) }}</p>

    <section v-if="detail.versions.length > 1" class="rounded-xl border border-border bg-card p-4" aria-labelledby="ver-h">
      <h2 id="ver-h" class="mb-2 text-h3 font-semibold">{{ t('receipt.versions') }}</h2>
      <ol data-testid="version-history" class="space-y-1">
        <li v-for="v in [...detail.versions].reverse()" :key="v.version">
          <button
            type="button"
            :data-testid="`version-${v.version}`"
            :aria-current="v.version === shown.version ? 'true' : undefined"
            class="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-muted"
            :class="v.version === shown.version ? 'border-selected-border bg-selected font-medium' : 'border-transparent'"
            @click="selected = v.version === latest.version ? null : v.version"
          >
            <span>{{ t('receipt.versionRow', { n: v.version, state: tOr('state', v.state) }) }}</span>
            <time :datetime="v.createdAt" class="text-xs text-text-secondary">{{ formatDateTime(v.createdAt, locale, ctx.timeZone) }}</time>
          </button>
        </li>
      </ol>
    </section>
  </article>
</template>
