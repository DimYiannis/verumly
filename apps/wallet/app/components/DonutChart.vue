<script setup lang="ts">
import { formatMoney } from '~/utils/format';

const { locale, t } = useLocale();

/** Donut by share with a legend, hand-written SVG. Values are minor units (cents) of `currency`; the centre shows the total. */
const props = defineProps<{ title: string; items: { label: string; value: number }[]; centreLabel?: string; currency?: string; testid?: string }>();

const COLOURS = ['#3338B8', '#8A8EE0', '#B3B6EE', '#5C8F6B', '#DDECE3', '#DCDCD3'] as const;
const R = 42;
const C = 2 * Math.PI * R;

const total = computed(() => props.items.reduce((s, i) => s + Math.max(0, i.value), 0));
const segments = computed(() => {
  // the top five categories, everything else folded into "other"
  const sorted = [...props.items].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 5);
  const rest = sorted.slice(5).reduce((s, i) => s + i.value, 0);
  const list = rest > 0 ? [...top, { label: t('home.insights.other'), value: rest }] : top;
  let offset = 0;
  return list.map((item, i) => {
    const share = total.value > 0 ? item.value / total.value : 0;
    const seg = { ...item, share, pct: Math.round(share * 100), colour: COLOURS[i] ?? COLOURS[5], dash: `${share * C} ${C}`, offset: -offset * C };
    offset += share;
    return seg;
  });
});
</script>

<template>
  <figure class="flex items-center gap-4 rounded-xl border border-border bg-card p-4" :data-testid="testid">
    <figcaption class="sr-only">{{ title }}</figcaption>
    <div class="relative size-[132px] shrink-0">
      <svg viewBox="0 0 100 100" class="size-full -rotate-90" role="img" :aria-label="`${title}: ${segments.map((s) => `${s.label} ${s.pct}%`).join(', ')}`">
        <circle cx="50" cy="50" :r="R" fill="none" stroke="#DCDCD3" stroke-width="14" />
        <circle v-for="s in segments" :key="s.label" cx="50" cy="50" :r="R" fill="none" :stroke="s.colour" stroke-width="14" :stroke-dasharray="s.dash" :stroke-dashoffset="s.offset" data-testid="bar" />
      </svg>
      <div class="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
        <span v-if="centreLabel" class="text-xs text-muted-foreground">{{ centreLabel }}</span>
        <span class="font-mono text-h3 font-medium">{{ formatMoney(total, locale, currency).replace(/[,.]00(?=\D*$)/, '') }}</span>
      </div>
    </div>
    <ul class="min-w-0 flex-1 space-y-2 text-small">
      <li v-for="s in segments" :key="s.label" class="flex items-center gap-2">
        <i class="size-2.5 shrink-0 rounded-[3px]" :style="{ backgroundColor: s.colour }" />
        <span class="min-w-0 flex-1 truncate">{{ s.label }}</span>
        <span class="font-mono">{{ s.pct }}%</span>
      </li>
    </ul>
  </figure>
</template>
