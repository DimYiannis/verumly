<script setup lang="ts">
import { userName } from '~/utils/social';

const props = withDefaults(defineProps<{ user: { displayName: string | null; handle: string | null; avatar: string | null } | null; name?: string; size?: 'sm' | 'md' }>(), { size: 'md', name: undefined });
const label = computed(() => props.name ?? (props.user ? userName(props.user) : '?'));
const initial = computed(() => label.value.replace(/^@/, '').charAt(0).toUpperCase());
</script>

<template>
  <span
    aria-hidden="true"
    class="inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-muted font-medium text-text-secondary"
    :class="size === 'sm' ? 'size-8 text-base' : 'size-10 text-xl'"
  >{{ user?.avatar ?? initial }}</span>
</template>
