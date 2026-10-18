<script setup lang="ts">
const props = defineProps<{ status: string }>();
const { tx } = useLocale();

const SUCCESS = ['paid', 'fiscalised', 'active', 'done', 'ready', 'completed', 'succeeded', 'enrolled'];
const WARNING = ['presented', 'queued', 'processing', 'pending'];
// every issued receipt is paid: only the exception (cancelled) is worth a badge
const HIDDEN = ['paid'];
const DANGER = ['void', 'failed', 'error'];
const variant = computed(() => (SUCCESS.includes(props.status) ? 'success' : WARNING.includes(props.status) ? 'warning' : DANGER.includes(props.status) ? 'danger' : 'neutral'));
</script>

<template>
  <Badge v-if="!HIDDEN.includes(status)" :variant="variant">{{ tx('status', status) }}</Badge>
</template>
