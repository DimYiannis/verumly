<script setup lang="ts">
// A settings-style section: a small heading on the left (above on a phone), its content on the right, a hairline on top.
defineProps<{ title: string }>();
const headingId = useId();
</script>

<template>
  <section :aria-labelledby="headingId" class="grid gap-x-12 gap-y-4 border-t py-8 md:grid-cols-[12rem_minmax(0,1fr)]">
    <h2 :id="headingId" class="text-sm font-medium leading-7">{{ title }}</h2>
    <div class="min-w-0"><slot /></div>
  </section>
</template>
