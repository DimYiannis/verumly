<script setup lang="ts">
import { formatMoney } from '~/utils/format';

const { locale } = useLocale();

/** Ranked rows: merchant logo, name, a thin bar and the amount. Values are minor units (cents) of `currency`. */
const props = defineProps<{ title: string; items: { label: string; value: number; note?: string }[]; currency?: string; testid?: string }>();

const max = computed(() => Math.max(1, ...props.items.map((i) => i.value)));
const rows = computed(() => props.items.map((item) => ({ ...item, pct: Math.max(2, Math.round((100 * Math.max(0, item.value)) / max.value)) })));
</script>

<template>
  <figure class="space-y-2" :data-testid="testid">
    <figcaption class="text-label text-text-secondary uppercase">{{ title }}</figcaption>
    <ul class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      <li v-for="r in rows" :key="r.label" class="flex items-center gap-3 px-4 py-3">
        <MerchantLogo :name="r.label" />
        <div class="min-w-0 flex-1">
          <span class="block truncate font-medium">{{ r.label }}</span>
          <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><i class="block h-full rounded-full bg-primary" :style="{ width: `${r.pct}%` }" data-testid="bar" /></div>
        </div>
        <span class="font-mono text-sm">{{ formatMoney(r.value, locale, currency) }}</span>
      </li>
    </ul>
  </figure>
</template>
