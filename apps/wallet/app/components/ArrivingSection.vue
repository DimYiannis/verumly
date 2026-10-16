<script setup lang="ts">
import type { ClosedReason } from '~/utils/pending-claims';
import { formatDateTime } from '~/utils/format';

const wallet = useWallet();
const CLOSED_TEXT: Record<ClosedReason, string> = {
  expired: "Couldn't get this receipt — ask the shop.",
  already_claimed: 'This receipt was already saved by someone else.',
  claim_expired: 'The retention period of this receipt had passed.',
};

async function dismiss(receiptId: string) {
  await wallet.claims.remove(receiptId);
  await wallet.refreshPending();
}
</script>

<template>
  <section v-if="wallet.pending.value.length > 0 || wallet.closed.value.length > 0" aria-labelledby="arriving-h" class="mb-6" data-testid="arriving-section">
    <h2 id="arriving-h" class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">Arriving</h2>
    <ul v-if="wallet.pending.value.length > 0" data-testid="arriving-list" class="space-y-2" aria-live="polite">
      <li v-for="c in wallet.pending.value" :key="c.receiptId" data-testid="arriving-item" :data-receipt-id="c.receiptId" class="card">
        <NuxtLink :to="`/r/${c.receiptId}`" class="block">
          <span class="font-semibold">{{ c.autoClaim ? 'Receipt arriving…' : 'Waiting for your confirmation' }}</span>
          <span class="block text-sm text-slate-700">
            Scanned {{ formatDateTime(new Date(c.createdAt).toISOString()) }} ·
            {{ c.autoClaim ? 'will be saved as soon as possible' : 'tap to confirm' }}
          </span>
        </NuxtLink>
      </li>
    </ul>
    <ul v-if="wallet.closed.value.length > 0" data-testid="closed-list" class="mt-2 space-y-2">
      <li v-for="c in wallet.closed.value" :key="c.receiptId" data-testid="closed-item" :data-reason="c.reason" class="card flex items-start justify-between gap-3" role="status">
        <span>{{ CLOSED_TEXT[c.reason] }}</span>
        <button type="button" class="btn btn-secondary shrink-0" data-testid="dismiss-closed" @click="dismiss(c.receiptId)">Close</button>
      </li>
    </ul>
  </section>
</template>
