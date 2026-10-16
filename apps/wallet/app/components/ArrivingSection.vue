<script setup lang="ts">
import type { ClosedReason } from '~/utils/pending-claims';
import { formatDateTime } from '~/utils/format';

const wallet = useWallet();
const CLOSED_TEXT: Record<ClosedReason, string> = {
  expired: "Couldn't get this receipt — ask the shop. (Deze bon is niet binnengekomen; vraag het aan de winkel.)",
  already_claimed: 'Deze bon was al opgeslagen door iemand anders.',
  claim_expired: 'De bewaartermijn van deze bon was verstreken.',
};

async function dismiss(receiptId: string) {
  await wallet.claims.remove(receiptId);
  await wallet.refreshPending();
}
</script>

<template>
  <section v-if="wallet.pending.value.length > 0 || wallet.closed.value.length > 0" aria-labelledby="arriving-h" class="mb-4" data-testid="arriving-section">
    <h2 id="arriving-h" class="mb-2 text-label text-text-secondary">Onderweg / Arriving</h2>
    <ul v-if="wallet.pending.value.length > 0" data-testid="arriving-list" class="space-y-2" aria-live="polite">
      <li v-for="c in wallet.pending.value" :key="c.receiptId" data-testid="arriving-item" :data-receipt-id="c.receiptId">
        <NuxtLink :to="`/r/${c.receiptId}`" class="block rounded-lg border border-border bg-card p-4 text-foreground no-underline transition-shadow duration-150 hover:text-foreground hover:shadow-sm">
          <span class="flex items-center gap-2 font-medium">
            <Spinner v-if="c.autoClaim" class="text-primary" role="presentation" aria-hidden="true" />
            {{ c.autoClaim ? 'Bon onderweg…' : 'Wacht op jouw bevestiging' }}
          </span>
          <span class="mt-1 block text-sm text-text-secondary">
            Gescand {{ formatDateTime(new Date(c.createdAt).toISOString()) }} ·
            {{ c.autoClaim ? 'wordt opgeslagen zodra het kan' : 'tik om te bevestigen' }}
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
        <span>{{ CLOSED_TEXT[c.reason] }}</span>
        <Button type="button" variant="secondary" class="shrink-0" data-testid="dismiss-closed" @click="dismiss(c.receiptId)">Sluiten</Button>
      </li>
    </ul>
  </section>
</template>
