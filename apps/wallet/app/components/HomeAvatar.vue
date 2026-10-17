<script setup lang="ts">
import { avatarColour, initials } from '~/utils/home';

/** Initials circle (or the person's emoji avatar when set). */
const props = withDefaults(defineProps<{ name: string; emoji?: string | null; size?: 'sm' | 'md' | 'lg' }>(), { emoji: null, size: 'md' });
const text = computed(() => initials(props.name));
const SIZE = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg' } as const;
</script>

<template>
  <span
    aria-hidden="true"
    class="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-card"
    :class="[SIZE[size], emoji ? 'bg-muted' : '']"
    :style="emoji ? undefined : { backgroundColor: avatarColour(name) }"
  >{{ emoji ?? text }}</span>
</template>
