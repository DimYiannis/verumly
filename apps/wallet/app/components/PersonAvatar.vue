<script setup lang="ts">
import { initialsOf, personTone } from '~/utils/avatar';
import { userName } from '~/utils/social';

const props = withDefaults(
  defineProps<{
    user?: { displayName: string | null; handle: string | null; avatar: string | null } | null;
    name?: string;
    size?: 'sm' | 'md' | 'lg';
    /** the signed-in person: always the neutral accent tone */
    me?: boolean;
    muted?: boolean;
    guest?: boolean;
  }>(),
  { user: null, name: undefined, size: 'md', me: false, muted: false, guest: false },
);
const label = computed(() => props.name ?? (props.user ? userName(props.user) : '?'));
const tone = computed(() => (props.me ? { bg: '#E6E7F8', border: '#B3B6EE', fg: '#1C1F6E' } : personTone(label.value)));
const style = computed(() => {
  if (props.guest) return { background: 'var(--card)', border: '1px dashed #B3B6EE', color: '#3338B8' };
  if (props.muted) return { background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--text-secondary)' };
  return { background: tone.value.bg, border: `1px solid ${tone.value.border}`, color: tone.value.fg };
});
const cls = computed(() => ({ sm: 'size-7 text-[11px]', md: 'size-9 text-sm', lg: 'size-14 text-xl' })[props.size]);
</script>

<template>
  <span aria-hidden="true" class="inline-flex shrink-0 items-center justify-center rounded-full font-semibold" :class="cls" :style="style">
    <template v-if="user?.avatar"><span :class="size === 'lg' ? 'text-2xl' : 'text-base'">{{ user.avatar }}</span></template>
    <template v-else>{{ guest ? '?' : initialsOf(label) }}</template>
  </span>
</template>
