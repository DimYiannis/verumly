<script setup lang="ts">
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
      class="rounded-xl border-2 border-amber-500 bg-amber-100 p-3 text-center font-bold text-amber-950"
    >
      Geen definitieve bon / Not a final receipt
      <span class="mt-1 block text-sm font-normal">Dit is de rekening. De definitieve bon verschijnt na betaling.</span>
    </p>
    <p v-else-if="shown.state === 'void'" role="status" data-testid="void-banner" class="rounded-xl border-2 border-red-600 bg-red-50 p-3 text-center font-bold text-red-900">
      Deze bon is vervallen / Voided
    </p>
    <p v-else-if="detail.final && !viewingOld" role="status" data-testid="final-badge" class="rounded-xl bg-brand-100 p-3 text-center font-semibold text-brand-900">
      Definitieve bon
    </p>
    <p v-if="viewingOld" role="status" data-testid="old-version-note" class="rounded-xl bg-slate-200 p-3 text-center text-sm text-slate-900">
      Je bekijkt versie {{ shown.version }}; de nieuwste is versie {{ latest.version }}.
      <button type="button" class="font-semibold underline" @click="selected = null">Toon nieuwste</button>
    </p>

    <header class="card">
      <h1 class="text-xl font-bold" data-testid="receipt-merchant">{{ shown.merchant.name }}</h1>
      <p class="text-sm text-slate-700">
        <time :datetime="shown.createdAt" data-testid="receipt-time">{{ formatDateTime(shown.createdAt) }}</time>
        · KvK {{ shown.merchant.kvkNumber }}<template v-if="shown.merchant.vatNumber"> · {{ shown.merchant.vatNumber }}</template>
      </p>
      <p class="mt-1 text-sm text-slate-700">{{ STATE_LABEL[shown.state] ?? shown.state }} · versie {{ shown.version }}</p>
    </header>

    <section class="card" aria-labelledby="lines-h">
      <h2 id="lines-h" class="mb-2 font-semibold">Regels</h2>
      <ul data-testid="receipt-lines" class="divide-y divide-slate-100">
        <li v-for="line in shown.lines" :key="line.lineNo" data-testid="receipt-line" :data-kind="line.kind" class="flex justify-between gap-3 py-2">
          <span>
            <span class="block">{{ line.description }}</span>
            <span v-if="line.kind === 'item' && line.qty !== '1'" class="text-sm text-slate-700">{{ formatQty(line.qty) }} × {{ formatEuro(line.unitPrice) }}</span>
            <span v-if="line.kind === 'deposit'" class="text-sm text-slate-700">Statiegeld</span>
            <span v-if="line.kind === 'discount'" class="text-sm text-slate-700">Korting</span>
          </span>
          <span class="whitespace-nowrap tabular-nums" :class="line.total < 0 ? 'text-brand-700' : ''">{{ formatEuro(line.total) }}</span>
        </li>
      </ul>
    </section>

    <section class="card" aria-labelledby="totals-h">
      <h2 id="totals-h" class="sr-only">Totaal</h2>
      <dl class="space-y-1">
        <div class="flex justify-between text-lg font-bold">
          <dt>Totaal</dt>
          <dd data-testid="receipt-total" class="tabular-nums">{{ formatEuro(shown.totals.gross) }}</dd>
        </div>
        <div v-if="shown.totals.tip > 0" class="flex justify-between text-sm">
          <dt>Fooi</dt>
          <dd class="tabular-nums">{{ formatEuro(shown.totals.tip) }}</dd>
        </div>
        <div v-if="shown.totals.rounding !== 0" class="flex justify-between text-sm">
          <dt>Afronding</dt>
          <dd data-testid="receipt-rounding" class="tabular-nums">{{ formatEuro(shown.totals.rounding) }}</dd>
        </div>
        <div v-if="shown.totals.rounding !== 0 || shown.totals.tip > 0" class="flex justify-between font-semibold">
          <dt>Te betalen</dt>
          <dd data-testid="receipt-payable" class="tabular-nums">{{ formatEuro(shown.totals.gross + shown.totals.tip + shown.totals.rounding) }}</dd>
        </div>
      </dl>
    </section>

    <section v-if="shown.vatSummary.length > 0" class="card" aria-labelledby="btw-h">
      <h2 id="btw-h" class="mb-2 font-semibold">BTW</h2>
      <table class="w-full text-sm" data-testid="vat-summary">
        <thead>
          <tr class="text-left text-slate-700">
            <th scope="col" class="font-medium">Tarief</th>
            <th scope="col" class="text-right font-medium">Excl.</th>
            <th scope="col" class="text-right font-medium">BTW</th>
            <th scope="col" class="text-right font-medium">Incl.</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in shown.vatSummary" :key="row.rate" data-testid="vat-row" :data-rate="row.rate" class="tabular-nums">
            <th scope="row" class="text-left font-normal">{{ row.rate }}%</th>
            <td class="text-right">{{ formatEuro(row.net) }}</td>
            <td class="text-right">{{ formatEuro(row.vat) }}</td>
            <td class="text-right">{{ formatEuro(row.gross) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="shown.payments.length > 0" class="card" aria-labelledby="pay-h">
      <h2 id="pay-h" class="mb-2 font-semibold">Betaling</h2>
      <ul data-testid="payments">
        <li v-for="(p, i) in shown.payments" :key="i" class="flex justify-between">
          <span>{{ PAYMENT_LABEL[p.method] ?? p.method }}</span>
          <span class="tabular-nums">{{ formatEuro(p.amount) }}</span>
        </li>
      </ul>
    </section>

    <section v-if="detail.versions.length > 1" class="card" aria-labelledby="ver-h">
      <h2 id="ver-h" class="mb-2 font-semibold">Versies</h2>
      <ol data-testid="version-history" class="space-y-1">
        <li v-for="v in [...detail.versions].reverse()" :key="v.version">
          <button
            type="button"
            :data-testid="`version-${v.version}`"
            :aria-current="v.version === shown.version ? 'true' : undefined"
            class="flex w-full min-h-11 items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-slate-100"
            :class="v.version === shown.version ? 'bg-brand-50 font-semibold' : ''"
            @click="selected = v.version === latest.version ? null : v.version"
          >
            <span>Versie {{ v.version }} · {{ STATE_LABEL[v.state] ?? v.state }}</span>
            <time :datetime="v.createdAt" class="text-sm text-slate-700">{{ formatDateTime(v.createdAt) }}</time>
          </button>
        </li>
      </ol>
    </section>
  </article>
</template>
