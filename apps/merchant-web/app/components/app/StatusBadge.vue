<script setup lang="ts">
const props = defineProps<{ status: string }>();

const SUCCESS = ['paid', 'active', 'done', 'ready', 'completed', 'succeeded', 'enrolled'];
const WARNING = ['presented', 'queued', 'processing', 'pending'];
const DANGER = ['void', 'failed', 'error'];
const variant = computed(() => (SUCCESS.includes(props.status) ? 'success' : WARNING.includes(props.status) ? 'warning' : DANGER.includes(props.status) ? 'danger' : 'neutral'));
</script>

<template>
  <Badge :variant="variant">{{ status }}</Badge>
</template>
