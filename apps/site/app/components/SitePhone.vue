<script setup lang="ts">
/** A phone-shaped frame for the mini screens. Decorative: the real app is the thing it shows. */
defineProps<{ label?: string }>();
</script>

<template>
  <div class="mx-auto w-full max-w-[300px] rounded-[2.4rem] border-[7px] border-[#14152B] bg-[#14152B] shadow-[0_30px_60px_-20px_rgba(20,21,43,0.45)]" role="img" :aria-label="label ?? 'Screen of the wallet app'">
    <div class="overflow-hidden rounded-[1.9rem] bg-background" aria-hidden="true">
      <slot />
    </div>
  </div>
</template>
