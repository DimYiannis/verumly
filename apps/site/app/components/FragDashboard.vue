<script setup lang="ts">
const { t } = useSiteLocale();
</script>

<template>
  <div class="space-y-3 bg-background p-4 text-[12px] text-foreground sm:p-5">
    <div class="flex items-center justify-between">
      <p class="text-base font-semibold tracking-tight">{{ t('frag.dashboard.today') }}</p>
      <span class="rounded-md border border-[#E6D29C] bg-[#F7EED6] px-2 py-0.5 text-[10px] text-[#7A5A10]">{{ t('frag.dashboard.needLook') }}</span>
    </div>
    <div class="rounded-xl border border-border bg-card p-3">
      <p class="mb-1 text-[10px] tracking-wider text-muted-foreground">{{ t('frag.dashboard.salesByHour') }}</p>
      <svg viewBox="0 0 400 90" class="h-24 w-full" role="img" :aria-label="t('frag.dashboard.chartLabel')">
        <polyline fill="none" stroke="#B3B6EE" stroke-width="2" stroke-dasharray="5 5" points="0,78 50,72 100,62 150,44 200,26 250,32 300,44 350,38 400,26" />
        <polyline fill="none" stroke="#3338B8" stroke-width="3" stroke-linejoin="round" points="0,80 50,74 100,58 150,38 200,18 250,22 300,30" />
        <circle cx="300" cy="30" r="4.5" fill="#3338B8" />
      </svg>
    </div>
    <div class="grid grid-cols-3 gap-2.5">
      <div class="space-y-1.5 rounded-xl border border-border bg-card p-3">
        <p class="text-[10px] tracking-wider text-muted-foreground">{{ t('frag.dashboard.terminals') }}</p>
        <p class="flex justify-between"><span>Kassa 1</span><span class="text-success">{{ t('frag.dashboard.online') }}</span></p>
        <p class="flex justify-between"><span>Kassa 2</span><span class="text-success">{{ t('frag.dashboard.online') }}</span></p>
        <p class="flex justify-between"><span>Kassa 3</span><span class="text-[#7A5A10]">{{ t('frag.dashboard.offline') }}</span></p>
      </div>
      <div class="space-y-1.5 rounded-xl border border-border bg-card p-3">
        <p class="text-[10px] tracking-wider text-muted-foreground">{{ t('frag.dashboard.needsLook') }}</p>
        <p>{{ t('frag.dashboard.cancelled') }}</p>
        <p class="text-muted-foreground">{{ t('frag.dashboard.offlineTerminals') }}</p>
      </div>
      <div class="space-y-1.5 rounded-xl border border-border bg-card p-3">
        <p class="text-[10px] tracking-wider text-muted-foreground">{{ t('frag.dashboard.topItems') }}</p>
        <p class="flex justify-between"><span>Koffie</span><span class="font-mono">48</span></p>
        <p class="flex justify-between"><span>Appeltaart</span><span class="font-mono">31</span></p>
        <p class="flex justify-between"><span>Bier</span><span class="font-mono">27</span></p>
      </div>
    </div>
  </div>
</template>
