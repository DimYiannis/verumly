<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

// A native select styled like ui/input (36px, hairline border). Use v-model.
const props = defineProps<{ class?: HTMLAttributes['class'] }>();
const model = defineModel<string>();
</script>

<template>
  <select v-model="model" :class="cn('h-9 w-full min-w-0 rounded-md border border-input bg-card px-[10px] text-sm outline-none transition-colors duration-150 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50', props.class)">
    <slot />
  </select>
</template>
