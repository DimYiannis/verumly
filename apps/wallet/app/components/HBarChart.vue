<script setup lang="ts">
import { formatEuro } from '~/utils/format';

/** Horizontal bars with a label and amount per row, hand-written SVG. Values are euro cents. */
const props = defineProps<{ title: string; items: { label: string; value: number; note?: string }[]; testid?: string }>();

const ROW = 34;
const W = 320;
const LABEL_W = 110;
const AMOUNT_W = 64;
const max = computed(() => Math.max(1, ...props.items.map((i) => i.value)));
const rows = computed(() =>
  props.items.map((item, i) => ({
    ...item,
    y: i * ROW,
    w: Math.round(((W - LABEL_W - AMOUNT_W) * Math.max(0, item.value)) / max.value),
  })),
);
</script>

<template>
  <figure class="card" :data-testid="testid">
    <figcaption class="mb-2 font-semibold">{{ title }}</figcaption>
    <svg :viewBox="`0 0 ${W} ${Math.max(1, items.length) * ROW}`" role="img" :aria-label="`${title}: ${items.map((i) => `${i.label} ${formatEuro(i.value)}`).join(', ')}`" class="w-full">
      <title>{{ title }}</title>
      <g v-for="r in rows" :key="r.label">
        <text :x="0" :y="r.y + 20" font-size="12" fill="#0f172a">{{ r.label.length > 16 ? `${r.label.slice(0, 15)}…` : r.label }}</text>
        <rect :x="LABEL_W" :y="r.y + 8" :width="Math.max(2, r.w)" height="16" rx="3" fill="#0f766e" data-testid="bar" />
        <text :x="W" :y="r.y + 20" text-anchor="end" font-size="11" fill="#334155">{{ formatEuro(r.value) }}</text>
      </g>
    </svg>
    <table class="sr-only">
      <caption>{{ title }}</caption>
      <tbody>
        <tr v-for="i in items" :key="i.label">
          <th scope="row">{{ i.label }}</th>
          <td>{{ formatEuro(i.value) }}</td>
        </tr>
      </tbody>
    </table>
  </figure>
</template>
