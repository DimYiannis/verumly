<script setup lang="ts">
const codes = ['NL', 'DE', 'FR', 'IT', 'ES', 'PT', 'BE', 'AT', 'PL', 'SE', 'DK', 'FI', 'IE', 'GR', 'CZ', 'HU', 'RO', 'HR', 'SI', 'SK', 'LU', 'MT', 'CY', 'EE', 'LV', 'LT', 'BG', 'NO', 'CH', 'GB', 'IS'];
</script>

<template>
  <div class="space-y-4 p-6 text-sm">
    <div class="flex flex-wrap gap-1.5">
      <span v-for="c in codes" :key="c" class="rounded-md border px-2 py-1 font-mono text-xs" :class="c === 'DE' ? 'border-primary bg-primary text-white' : 'border-border bg-card text-muted-foreground'">{{ c }}</span>
    </div>
    <div class="space-y-2 rounded-xl border border-border bg-card p-4">
      <p class="font-medium">What Germany asks of a till</p>
      <p class="flex justify-between text-muted-foreground"><span>TSE serial number *</span><span class="text-[#9A3B2E]">missing</span></p>
      <p class="flex justify-between text-muted-foreground"><span>Till ID (Kassen-ID) *</span><span>KASSE-1</span></p>
      <p class="flex justify-between text-muted-foreground"><span>Registered with the Finanzamt *</span><span>yes</span></p>
    </div>
  </div>
</template>
