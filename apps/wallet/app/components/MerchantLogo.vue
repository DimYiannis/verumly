<script setup lang="ts">
import { initials, logoColour } from '~/utils/home';

/** Coloured rounded square with the merchant's initials; colour derives from the name. */
const props = withDefaults(defineProps<{ name: string; size?: 'md' | 'sm' }>(), { size: 'md' });
</script>

<template>
  <span
    aria-hidden="true"
    class="inline-flex shrink-0 items-center justify-center rounded-lg font-semibold text-white"
    :class="size === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm'"
    :style="{ backgroundColor: logoColour(props.name) }"
  >{{ initials(props.name) }}</span>
</template>
