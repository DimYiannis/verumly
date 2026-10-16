<script setup lang="ts">
import type { ClosedReason } from '~/utils/pending-claims';
import type { MessageKey } from '~/i18n';
import { formatDateTime } from '~/utils/format';

const wallet = useWallet();
const { t, locale } = useLocale();
const CLOSED_KEY = {
  expired: 'arriving.closed.expired',
  already_claimed: 'arriving.closed.already_claimed',
  claim_expired: 'arriving.closed.claim_expired',
} as const satisfies Record<ClosedReason, MessageKey>;

async function dismiss(receiptId: string) {
  await wallet.claims.remove(receiptId);
  await wallet.refreshPending();
}
</script>

<template>
  <section v-if="wallet.pending.value.length > 0 || wallet.closed.value.length > 0" aria-labelledby="arriving-h" class="mb-4" data-testid="arriving-section">
    <h2 id="arriving-h" class="mb-2 text-label text-text-secondary">{{ t('arriving.title') }}</h2>
    <ul v-if="wallet.pending.value.length > 0" data-testid="arriving-list" class="space-y-2" aria-live="polite">
      <li v-for="c in wallet.pending.value" :key="c.receiptId" data-testid="arriving-item" :data-receipt-id="c.receiptId">
        <NuxtLink :to="`/r/${c.receiptId}`" class="block rounded-lg border border-border bg-card p-4 text-foreground no-underline transition-shadow duration-150 hover:text-foreground hover:shadow-sm">
          <span class="flex items-center gap-2 font-medium">
            <Spinner v-if="c.autoClaim" class="text-primary" role="presentation" aria-hidden="true" />
            {{ c.autoClaim ? t('arriving.autoTitle') : t('arriving.manualTitle') }}
          </span>
          <span class="mt-1 block text-sm text-text-secondary">
            {{ t('arriving.scanned', { time: formatDateTime(new Date(c.createdAt).toISOString(), locale) }) }} ·
            {{ c.autoClaim ? t('arriving.autoHint') : t('arriving.manualHint') }}
          </span>
        </NuxtLink>
      </li>
    </ul>
    <ul v-if="wallet.closed.value.length > 0" data-testid="closed-list" class="mt-2 space-y-2">
      <li
        v-for="c in wallet.closed.value"
        :key="c.receiptId"
        data-testid="closed-item"
        :data-reason="c.reason"
        class="flex items-start justify-between gap-3 rounded-lg border border-warning-border bg-warning-soft p-4 text-sm text-warning"
        role="status"
      >
        <span>{{ t(CLOSED_KEY[c.reason]) }}</span>
        <Button type="button" variant="secondary" class="shrink-0" data-testid="dismiss-closed" @click="dismiss(c.receiptId)">{{ t('arriving.close') }}</Button>
      </li>
    </ul>
  </section>
</template>
