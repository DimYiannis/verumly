<script setup lang="ts">
import { formatEuro } from '~/utils/format';

/** Vertical bars, hand-written SVG (no chart library). Values are euro cents. */
const props = defineProps<{ title: string; items: { label: string; value: number }[]; testid?: string }>();

const W = 320;
const H = 160;
const PAD_BOTTOM = 24;
const PAD_TOP = 8;
const max = computed(() => Math.max(1, ...props.items.map((i) => i.value)));
const slot = computed(() => W / Math.max(1, props.items.length));
const bars = computed(() =>
  props.items.map((item, i) => {
    const h = Math.round(((H - PAD_BOTTOM - PAD_TOP) * Math.max(0, item.value)) / max.value);
    const barW = Math.min(36, slot.value * 0.65);
    return { ...item, x: i * slot.value + (slot.value - barW) / 2, y: H - PAD_BOTTOM - h, w: barW, h };
  }),
);
</script>

<template>
  <figure class="card" :data-testid="testid">
    <figcaption class="mb-2 font-semibold">{{ title }}</figcaption>
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="`${title}: ${items.map((i) => `${i.label} ${formatEuro(i.value)}`).join(', ')}`" class="w-full">
      <title>{{ title }}</title>
      <line :x1="0" :x2="W" :y1="H - PAD_BOTTOM" :y2="H - PAD_BOTTOM" stroke="#94a3b8" stroke-width="1" />
      <g v-for="b in bars" :key="b.label">
        <rect :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="3" fill="#0f766e" data-testid="bar" />
        <text :x="b.x + b.w / 2" :y="H - 8" text-anchor="middle" font-size="10" fill="#334155">{{ b.label }}</text>
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
