<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <div class="flex flex-wrap items-end justify-between gap-4 px-2 pt-2">
    <div class="min-w-0">
      <h1 class="text-2xl font-medium tracking-tight">{{ title }}</h1>
      <p v-if="description" class="mt-1 max-w-2xl text-sm text-muted-foreground">{{ description }}</p>
    </div>
    <div class="flex items-center gap-2"><slot /></div>
  </div>
</template>
