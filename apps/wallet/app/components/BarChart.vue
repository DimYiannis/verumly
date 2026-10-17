<script setup lang="ts">
import { formatEuro } from '~/utils/format';

const { locale } = useLocale();

/** Vertical bars as plain HTML (no chart library); the last one is highlighted. Values are euro cents. */
const props = defineProps<{ title: string; items: { label: string; value: number }[]; testid?: string }>();

const max = computed(() => Math.max(1, ...props.items.map((i) => i.value)));
const bars = computed(() => props.items.map((item, i) => ({ ...item, pct: Math.max(4, Math.round((100 * Math.max(0, item.value)) / max.value)), last: i === props.items.length - 1 })));
</script>

<template>
  <figure class="space-y-3 rounded-xl border border-border bg-card p-4" :data-testid="testid">
    <figcaption class="text-label text-text-secondary uppercase">{{ title }}</figcaption>
    <div class="flex h-24 items-end gap-3" role="img" :aria-label="`${title}: ${items.map((i) => `${i.label} ${formatEuro(i.value, locale)}`).join(', ')}`">
      <div v-for="b in bars" :key="b.label" class="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
        <i class="block w-full rounded-t-md rounded-b-[2px]" :class="b.last ? 'bg-primary' : 'bg-[#B3B6EE]'" :style="{ height: `${b.pct}%` }" data-testid="bar" />
        <span class="text-xs" :class="b.last ? 'text-foreground' : 'text-muted-foreground'">{{ b.label }}</span>
      </div>
    </div>
    <table class="sr-only">
      <caption>{{ title }}</caption>
      <tbody>
        <tr v-for="i in items" :key="i.label">
          <th scope="row">{{ i.label }}</th>
          <td>{{ formatEuro(i.value, locale) }}</td>
        </tr>
      </tbody>
    </table>
  </figure>
</template>
