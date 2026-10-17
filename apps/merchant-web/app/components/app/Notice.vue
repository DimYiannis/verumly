<script setup lang="ts">
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from '@lucide/vue';

// A slim inline banner: one sentence, an icon, an optional action on the right. The caller sets `role` (status or alert).
const props = withDefaults(defineProps<{ tone?: 'success' | 'warning' | 'danger' | 'info' }>(), { tone: 'info' });

const TONES = {
  success: { icon: CircleCheckIcon, box: 'border-success-border bg-success-soft text-success' },
  warning: { icon: TriangleAlertIcon, box: 'border-warning-border bg-warning-soft text-warning' },
  danger: { icon: CircleAlertIcon, box: 'border-danger-border bg-danger-soft text-danger' },
  info: { icon: InfoIcon, box: 'border-border bg-card text-foreground' },
} as const;
const tone = computed(() => TONES[props.tone]);
</script>

<template>
  <div :class="['flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm', tone.box]">
    <component :is="tone.icon" class="size-4 shrink-0" aria-hidden="true" />
    <div class="min-w-0 flex-1"><slot /></div>
    <slot name="action" />
  </div>
</template>
