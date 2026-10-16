<script setup lang="ts">
import { Ban, CircleCheck, TriangleAlert } from '@lucide/vue';
import type { ReceiptDetail } from '~/utils/api-schemas';
import { STATE_LABEL, formatDateTime, formatEuro, formatQty } from '~/utils/format';

const props = defineProps<{ detail: Pick<ReceiptDetail, 'receipt' | 'final' | 'versions'> }>();

/** null = latest version */
const selected = ref<number | null>(null);
const latest = computed(() => props.detail.receipt);
const shown = computed(() => props.detail.versions.find((v) => v.version === selected.value)?.crf ?? latest.value);
const viewingOld = computed(() => shown.value.version !== latest.value.version);
const PAYMENT_LABEL: Record<string, string> = { card: 'Pinpas', cash: 'Contant', other: 'Overig' };
</script>

<template>
  <article class="space-y-4" data-testid="receipt-view" :data-state="shown.state" :data-version="shown.version">
    <p
      v-if="shown.state === 'presented'"
      role="status"
      data-testid="presented-banner"
      class="rounded-xl border-2 border-warning bg-warning-soft p-4 text-center text-lg font-semibold text-warning"
    >
      <TriangleAlert class="mx-auto mb-1 size-6" aria-hidden="true" />
      Geen definitieve bon / Not a final receipt
      <span class="mt-1 block text-sm font-normal text-text-secondary">Dit is de rekening. De definitieve bon verschijnt na betaling.</span>
    </p>
    <p
      v-else-if="shown.state === 'void'"
      role="status"
      data-testid="void-banner"
      class="rounded-xl border-2 border-danger bg-danger-soft p-4 text-center text-lg font-semibold text-danger"
    >
      <Ban class="mx-auto mb-1 size-6" aria-hidden="true" />
      Deze bon is vervallen / Voided
    </p>
    <p
      v-else-if="detail.final && !viewingOld"
      role="status"
      data-testid="final-badge"
      class="flex items-center justify-center gap-2 rounded-xl border border-success-border bg-success-soft p-3 font-semibold text-success"
    >
      <CircleCheck class="size-5" aria-hidden="true" />
      Definitieve bon
    </p>
    <p v-if="viewingOld" role="status" data-testid="old-version-note" class="rounded-xl border border-border bg-muted p-3 text-center text-sm text-text-secondary">
      Je bekijkt versie {{ shown.version }}; de nieuwste is versie {{ latest.version }}.
      <button type="button" class="min-h-11 font-semibold text-primary underline" @click="selected = null">Toon nieuwste</button>
    </p>

    <!-- the paper receipt: one sheet, dashed tear lines between blocks, mono for everything that is money -->
    <div class="rounded-xl border border-border bg-card px-5 py-6 text-foreground">
      <header class="text-center">
        <h1 class="text-h2 font-semibold" data-testid="receipt-merchant">{{ shown.merchant.name }}</h1>
        <p class="mt-1 font-mono text-xs text-text-secondary">
          <time :datetime="shown.createdAt" data-testid="receipt-time">{{ formatDateTime(shown.createdAt) }}</time>
          · KvK {{ shown.merchant.kvkNumber }}<template v-if="shown.merchant.vatNumber"> · {{ shown.merchant.vatNumber }}</template>
        </p>
        <p class="mt-1 text-sm text-text-secondary">{{ STATE_LABEL[shown.state] ?? shown.state }} · versie {{ shown.version }}</p>
      </header>

      <section class="mt-5 border-t border-dashed border-border pt-4" aria-labelledby="lines-h">
        <h2 id="lines-h" class="mb-2 text-label text-text-secondary">Regels</h2>
        <ul data-testid="receipt-lines" class="space-y-2 font-mono text-sm">
          <li v-for="line in shown.lines" :key="line.lineNo" data-testid="receipt-line" :data-kind="line.kind" class="flex justify-between gap-3">
            <span>
              <span class="block">{{ line.description }}</span>
              <span v-if="line.kind === 'item' && line.qty !== '1'" class="text-xs text-text-secondary">{{ formatQty(line.qty) }} × {{ formatEuro(line.unitPrice) }}</span>
              <span v-if="line.kind === 'deposit'" class="text-xs text-text-secondary">Statiegeld</span>
              <span v-if="line.kind === 'discount'" class="text-xs text-text-secondary">Korting</span>
            </span>
            <span class="whitespace-nowrap tabular-nums" :class="line.total < 0 ? 'text-primary' : ''">{{ formatEuro(line.total) }}</span>
          </li>
        </ul>
      </section>

      <section class="mt-4 border-t border-dashed border-border pt-4" aria-labelledby="totals-h">
        <h2 id="totals-h" class="sr-only">Totaal</h2>
        <dl class="space-y-1 font-mono text-sm">
          <div class="flex justify-between text-lg font-semibold">
            <dt>Totaal</dt>
            <dd data-testid="receipt-total" class="tabular-nums">{{ formatEuro(shown.totals.gross) }}</dd>
          </div>
          <div v-if="shown.totals.tip > 0" class="flex justify-between">
            <dt>Fooi</dt>
            <dd class="tabular-nums">{{ formatEuro(shown.totals.tip) }}</dd>
          </div>
          <div v-if="shown.totals.rounding !== 0" class="flex justify-between">
            <dt>Afronding</dt>
            <dd data-testid="receipt-rounding" class="tabular-nums">{{ formatEuro(shown.totals.rounding) }}</dd>
          </div>
          <div v-if="shown.totals.rounding !== 0 || shown.totals.tip > 0" class="flex justify-between font-semibold">
            <dt>Te betalen</dt>
            <dd data-testid="receipt-payable" class="tabular-nums">{{ formatEuro(shown.totals.gross + shown.totals.tip + shown.totals.rounding) }}</dd>
          </div>
        </dl>
      </section>

      <section v-if="shown.vatSummary.length > 0" class="mt-4 border-t border-dashed border-border pt-4" aria-labelledby="btw-h">
        <h2 id="btw-h" class="mb-2 text-label text-text-secondary">BTW</h2>
        <table class="w-full font-mono text-xs" data-testid="vat-summary">
          <thead>
            <tr class="text-left text-text-secondary">
              <th scope="col" class="font-medium">Tarief</th>
              <th scope="col" class="text-right font-medium">Excl.</th>
              <th scope="col" class="text-right font-medium">BTW</th>
              <th scope="col" class="text-right font-medium">Incl.</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in shown.vatSummary" :key="row.rate" data-testid="vat-row" :data-rate="row.rate" class="tabular-nums">
              <th scope="row" class="py-0.5 text-left font-normal">{{ row.rate }}%</th>
              <td class="text-right">{{ formatEuro(row.net) }}</td>
              <td class="text-right">{{ formatEuro(row.vat) }}</td>
              <td class="text-right">{{ formatEuro(row.gross) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="shown.payments.length > 0" class="mt-4 border-t border-dashed border-border pt-4" aria-labelledby="pay-h">
        <h2 id="pay-h" class="mb-2 text-label text-text-secondary">Betaling</h2>
        <ul data-testid="payments" class="font-mono text-sm">
          <li v-for="(p, i) in shown.payments" :key="i" class="flex justify-between">
            <span>{{ PAYMENT_LABEL[p.method] ?? p.method }}</span>
            <span class="tabular-nums">{{ formatEuro(p.amount) }}</span>
          </li>
        </ul>
      </section>
    </div>

    <section v-if="detail.versions.length > 1" class="rounded-xl border border-border bg-card p-4" aria-labelledby="ver-h">
      <h2 id="ver-h" class="mb-2 text-h3 font-semibold">Versies</h2>
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
            <span>Versie {{ v.version }} · {{ STATE_LABEL[v.state] ?? v.state }}</span>
            <time :datetime="v.createdAt" class="text-xs text-text-secondary">{{ formatDateTime(v.createdAt) }}</time>
          </button>
        </li>
      </ol>
    </section>
  </article>
</template>
