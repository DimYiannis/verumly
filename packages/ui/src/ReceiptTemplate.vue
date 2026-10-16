<script setup lang="ts">
/**
 * Draws a receipt from a merchant's template. Shared by the wallet (the real receipt) and the dashboard designer
 * (a sample). Inline styles only: the package lives outside each app's Tailwind scan, and the colours come from
 * the template anyway. Static text is rendered as text, never as HTML.
 */
import { computed } from 'vue';
import type { ReceiptTemplate, TemplateBlock } from '@lr/schema';

interface Line { description: string; qty: string; unitPrice: number; total: number; kind: string }
interface VatRow { rate: number; net: number; vat: number; gross: number }
export interface ReceiptLike {
  merchant: { name: string; kvkNumber: string; vatNumber: string | null };
  createdAt: string;
  lines: Line[];
  vatSummary: VatRow[];
  totals: { gross: number; net: number; vat: number; tip: number; rounding: number };
  payments: Array<{ method: string; amount: number }>;
  fiscal: { country: string; registerSerial: string | null; documentNumber: string | null; extra: Record<string, string> };
  currency?: string;
}

const props = withDefaults(
  defineProps<{
    template: ReceiptTemplate;
    receipt: ReceiptLike;
    money?: (cents: number) => string;
    dateTime?: (iso: string) => string;
    /** text of the fixed labels (translate in the host app); missing keys fall back to English */
    labels?: Record<string, string>;
    /** designer mode: empty blocks show a placeholder so they can be selected */
    designer?: boolean;
    selectedId?: string | null;
  }>(),
  { money: undefined, dateTime: undefined, labels: () => ({}), designer: false, selectedId: null },
);
const emit = defineEmits<{ select: [id: string] }>();

const EN: Record<string, string> = {
  company: 'Company no.',
  vat: 'VAT',
  total: 'Total',
  net: 'Net',
  gross: 'Gross',
  rounding: 'Rounding',
  tip: 'Tip',
  rate: 'Rate',
  card: 'Card',
  cash: 'Cash',
  other: 'Other',
  document: 'Receipt no.',
  register: 'Register',
  logo: 'Logo',
  text: 'Text',
  fiscalData: 'Fiscal data',
};
const t = (k: string) => props.labels[k] ?? EN[k] ?? k;
const money = (c: number) => (props.money ? props.money(c) : new Intl.NumberFormat('en-GB', { style: 'currency', currency: props.receipt.currency ?? 'EUR' }).format(c / 100));
const when = (iso: string) => (props.dateTime ? props.dateTime(iso) : new Date(iso).toLocaleString('en-GB'));

const FONT = { sans: "'Outfit', system-ui, sans-serif", serif: "Georgia, 'Times New Roman', serif", mono: "'JetBrains Mono', ui-monospace, monospace" } as const;
const SIZE = { sm: 12, md: 14, lg: 18, xl: 24 } as const;

const paperStyle = computed(() => {
  const s = props.template.style;
  const base: Record<string, string> = { background: s.background, color: s.text, fontFamily: FONT[s.font], padding: '24px 20px', boxSizing: 'border-box', width: '100%' };
  if (s.paper === 'card') return { ...base, borderRadius: '12px', border: '1px solid rgba(0,0,0,0.14)' };
  if (s.paper === 'thermal') return { ...base, fontFamily: FONT.mono, borderRadius: '2px', border: '1px dashed rgba(0,0,0,0.25)', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' };
  return { ...base, padding: '8px 0' };
});

function blockStyle(b: TemplateBlock): Record<string, string> {
  const o: Record<string, string> = {
    textAlign: b.align,
    fontSize: `${SIZE[b.size]}px`,
    fontWeight: b.bold ? '700' : '400',
    color: b.color ?? props.template.style.text,
    lineHeight: '1.35',
    padding: '3px 0',
    wordBreak: 'break-word',
  };
  if (props.designer) {
    o.cursor = 'pointer';
    o.outline = props.selectedId === b.id ? `2px solid ${props.template.style.accent}` : '1px dashed rgba(0,0,0,0.12)';
    o.outlineOffset = '2px';
    o.borderRadius = '4px';
  }
  return o;
}

const visible = computed(() => props.template.blocks.filter((b) => props.designer || !b.hidden));
const row = { display: 'flex', justifyContent: 'space-between', gap: '12px' } as const;
const num = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;
const method = (m: string) => t(m === 'card' ? 'card' : m === 'cash' ? 'cash' : 'other');
const fiscalRows = computed(() => {
  const f = props.receipt.fiscal;
  const out: Array<[string, string]> = [];
  if (f.documentNumber) out.push([t('document'), f.documentNumber]);
  if (f.registerSerial) out.push([t('register'), f.registerSerial]);
  for (const [k, v] of Object.entries(f.extra)) out.push([k, v]);
  return out;
});
</script>

<template>
  <div :style="paperStyle" data-testid="receipt-template">
    <div v-for="b in visible" :key="b.id" :style="{ ...blockStyle(b), opacity: b.hidden ? 0.4 : 1 }" :data-block="b.type" @click="designer && emit('select', b.id)">
      <template v-if="b.type === 'logo'">
        <img v-if="template.logo" :src="template.logo" alt="" :style="{ maxHeight: '64px', maxWidth: '60%', objectFit: 'contain', display: 'inline-block' }" />
        <span v-else-if="designer" :style="{ display: 'inline-block', padding: '10px 18px', border: '1px dashed currentColor', opacity: 0.5, fontSize: '12px' }">{{ t('logo') }}</span>
      </template>

      <template v-else-if="b.type === 'merchantName'"><span data-testid="receipt-merchant">{{ receipt.merchant.name }}</span></template>

      <template v-else-if="b.type === 'merchantIds'">
        <div>{{ t('company') }} {{ receipt.merchant.kvkNumber }}<template v-if="receipt.merchant.vatNumber"> · {{ t('vat') }} {{ receipt.merchant.vatNumber }}</template></div>
        <div><time :datetime="receipt.createdAt" data-testid="receipt-time">{{ when(receipt.createdAt) }}</time></div>
      </template>

      <template v-else-if="b.type === 'text'">
        <span v-if="b.text" style="white-space: pre-wrap">{{ b.text }}</span>
        <span v-else-if="designer" style="opacity: 0.45">{{ t('text') }}</span>
      </template>

      <hr v-else-if="b.type === 'divider'" :style="{ border: 0, borderTop: '1px dashed currentColor', opacity: 0.35, margin: '4px 0' }" />

      <div v-else-if="b.type === 'spacer'" style="height: 16px" />

      <template v-else-if="b.type === 'lines'">
        <div v-for="(l, i) in receipt.lines" :key="i" :style="row" data-testid="receipt-line" :data-kind="l.kind">
          <span style="min-width: 0">{{ l.description }}<span v-if="l.qty !== '1'" style="opacity: 0.65"> × {{ l.qty }}</span></span>
          <span :style="num">{{ money(l.total) }}</span>
        </div>
      </template>

      <template v-else-if="b.type === 'vatTable'">
        <div :style="{ ...row, opacity: 0.65 }"><span>{{ t('rate') }}</span><span>{{ t('net') }} · {{ t('vat') }} · {{ t('gross') }}</span></div>
        <div v-for="v in receipt.vatSummary" :key="v.rate" :style="row">
          <span>{{ v.rate }}%</span><span :style="num">{{ money(v.net) }} · {{ money(v.vat) }} · {{ money(v.gross) }}</span>
        </div>
      </template>

      <template v-else-if="b.type === 'totals'">
        <div v-if="receipt.totals.rounding" :style="{ ...row, fontSize: '0.75em', fontWeight: 400, opacity: 0.7 }"><span>{{ t('rounding') }}</span><span :style="num">{{ money(receipt.totals.rounding) }}</span></div>
        <div v-if="receipt.totals.tip" :style="{ ...row, fontSize: '0.75em', fontWeight: 400, opacity: 0.7 }"><span>{{ t('tip') }}</span><span :style="num">{{ money(receipt.totals.tip) }}</span></div>
        <div :style="row"><span>{{ t('total') }}</span><span :style="num" data-testid="receipt-total">{{ money(receipt.totals.gross) }}</span></div>
      </template>

      <template v-else-if="b.type === 'payment'">
        <div v-for="(p, i) in receipt.payments" :key="i" :style="row"><span>{{ method(p.method) }}</span><span :style="num">{{ money(p.amount) }}</span></div>
      </template>

      <template v-else-if="b.type === 'fiscal'">
        <div v-for="([k, v], i) in fiscalRows" :key="i" :style="row"><span style="opacity: 0.7">{{ k }}</span><span style="word-break: break-all">{{ v }}</span></div>
        <span v-if="!fiscalRows.length && designer" style="opacity: 0.45">{{ t('fiscalData') }}</span>
      </template>
    </div>
  </div>
</template>
