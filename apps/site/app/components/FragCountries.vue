<script setup lang="ts">
const { t } = useSiteLocale();
const codes = ['NL', 'DE', 'FR', 'IT', 'ES', 'PT', 'BE', 'AT', 'PL', 'SE', 'DK', 'FI', 'IE', 'GR', 'CZ', 'HU', 'RO', 'HR', 'SI', 'SK', 'LU', 'MT', 'CY', 'EE', 'LV', 'LT', 'BG', 'NO', 'CH', 'GB', 'IS'];
</script>

<template>
  <div class="space-y-4 p-6 text-sm">
    <div class="flex flex-wrap gap-1.5" aria-hidden="true">
      <span v-for="c in codes" :key="c" class="rounded-md border px-2 py-1 font-mono text-xs" :class="c === 'DE' ? 'border-primary bg-primary text-white' : 'border-border bg-card text-muted-foreground'">{{ c }}</span>
    </div>
    <div class="space-y-2 rounded-xl border border-border bg-card p-4">
      <p class="font-medium">{{ t('frag.countries.germanyAsks') }}</p>
      <p class="flex justify-between text-muted-foreground"><span>{{ t('frag.countries.tse') }}</span><span class="text-[#9A3B2E]">{{ t('frag.countries.missing') }}</span></p>
      <p class="flex justify-between text-muted-foreground"><span>{{ t('frag.countries.tillId') }}</span><span>KASSE-1</span></p>
      <p class="flex justify-between text-muted-foreground"><span>{{ t('frag.countries.finanzamt') }}</span><span>{{ t('frag.countries.yes') }}</span></p>
    </div>
  </div>
</template>
