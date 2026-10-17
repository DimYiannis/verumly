<script setup lang="ts">
// A slim bar for one plan limit. `limit`: a number = bar (amber from 80%, red when over), null = unlimited, undefined = no plan (count only).
const props = defineProps<{ label: string; used: number; limit: number | null | undefined }>();
const { t } = useLocale();

const hasLimit = computed(() => typeof props.limit === 'number');
const over = computed(() => typeof props.limit === 'number' && props.used > props.limit);
const share = computed(() => (typeof props.limit === 'number' && props.limit > 0 ? props.used / props.limit : 0));
const percent = computed(() => Math.min(100, Math.round(share.value * 100)));
const barClass = computed(() => (over.value ? 'bg-danger' : share.value >= 0.8 ? 'bg-amber-600' : 'bg-primary'));
const valueText = computed(() => {
  if (typeof props.limit === 'number') return t('bill.usage.of', { n: props.used, max: props.limit });
  return props.limit === null ? t('bill.usage.unlimited', { n: props.used }) : String(props.used);
});
</script>

<template>
  <div class="space-y-2">
    <div class="flex h-7 items-center justify-between gap-4 text-sm">
      <span>{{ label }}</span>
      <span :class="['font-mono text-xs', over ? 'text-danger' : 'text-text-secondary']">{{ valueText }}</span>
    </div>
    <div
      v-if="hasLimit"
      role="progressbar"
      :aria-label="label"
      aria-valuemin="0"
      :aria-valuemax="limit ?? undefined"
      :aria-valuenow="Math.min(used, limit ?? used)"
      :aria-valuetext="valueText"
      class="h-1.5 overflow-hidden rounded-full bg-border"
    >
      <div :class="['h-full rounded-full transition-[width] duration-300', barClass]" :style="{ width: `${percent}%` }" />
    </div>
  </div>
</template>
