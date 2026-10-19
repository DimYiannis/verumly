<script setup lang="ts">
defineProps<{ light?: boolean }>();
</script>

<template>
  <span class="inline-flex items-center gap-2.5" :class="light ? 'text-white' : 'text-foreground'">
    <svg viewBox="0 0 32 32" class="size-8" aria-hidden="true">
      <rect width="32" height="32" rx="8" :fill="light ? '#ffffff' : '#3338B8'" />
      <path d="M10 7h12v19l-3-2-3 2-3-2-3 2z" fill="none" :stroke="light ? '#3338B8' : '#ffffff'" stroke-width="1.8" stroke-linejoin="round" />
      <path d="M13 12.5h6M13 16.5h6" :stroke="light ? '#3338B8' : '#ffffff'" stroke-width="1.8" stroke-linecap="round" />
    </svg>
    <span class="text-2xl font-semibold tracking-[-0.035em]">Syngrapha</span>
  </span>
</template>
