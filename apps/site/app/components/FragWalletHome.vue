<script setup lang="ts">
const { t } = useSiteLocale();
</script>

<template>
  <div class="flex h-[560px] flex-col gap-3 bg-background p-4 text-[13px] text-foreground">
    <div class="flex items-center justify-between">
      <span class="text-lg font-semibold tracking-[-0.035em]">Verumly</span>
      <span class="grid size-7 place-items-center rounded-full border border-[#B3B6EE] bg-[#E6E7F8] text-[10px] font-semibold text-[#1C1F6E]">SM</span>
    </div>
    <div class="leading-tight">
      <p class="text-[11px] text-muted-foreground">{{ t('frag.walletHome.date') }}</p>
      <p class="text-xl font-semibold tracking-tight">{{ t('frag.walletHome.greeting') }}</p>
    </div>
    <div class="rounded-2xl bg-[#1C1F6E] p-4 text-white">
      <p class="text-[10px] tracking-wider text-[#B3B6EE]">{{ t('frag.walletHome.monthSoFar') }}</p>
      <p class="mt-1 font-mono text-[30px] leading-none font-medium">€428,60</p>
      <svg viewBox="0 0 200 40" class="mt-2 h-10 w-full" aria-hidden="true">
        <polyline fill="none" stroke="#B3B6EE" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="0,32 16,28 32,31 48,20 64,24 80,14 96,19 112,9 128,16 144,7 160,13 176,5 200,9" />
      </svg>
      <div class="mt-2 h-1.5 rounded-full bg-white/20"><div class="h-full w-[71%] rounded-full bg-white" /></div>
      <p class="mt-1 text-[10px] text-[#E6E7F8]">{{ t('frag.walletHome.budget') }}</p>
    </div>
    <div class="grid grid-cols-2 gap-2.5">
      <div class="rounded-xl border border-border bg-card p-3">
        <p class="text-[9px] tracking-wider text-muted-foreground">{{ t('frag.walletHome.friendsOwe') }}</p>
        <p class="mt-1 font-mono text-base font-medium text-success">€13,40</p>
      </div>
      <div class="rounded-xl border border-border bg-card p-3">
        <p class="text-[9px] tracking-wider text-muted-foreground">{{ t('frag.walletHome.youOwe') }}</p>
        <p class="mt-1 font-mono text-base font-medium">€6,20</p>
      </div>
    </div>
    <div class="overflow-hidden rounded-xl border border-border bg-card">
      <div class="flex items-center gap-2.5 border-b border-border p-2.5">
        <span class="grid size-8 place-items-center rounded-lg bg-primary text-[11px] font-bold text-white">CP</span>
        <div class="min-w-0 flex-1 leading-tight"><p class="truncate font-medium">Café Het Plein</p><p class="text-[10px] text-muted-foreground">{{ t('frag.walletHome.cpMeta') }}</p></div>
        <span class="font-mono">€10,69</span>
      </div>
      <div class="flex items-center gap-2.5 p-2.5">
        <span class="grid size-8 place-items-center rounded-lg bg-[#2F6B3E] text-[11px] font-bold text-white">BZ</span>
        <div class="min-w-0 flex-1 leading-tight"><p class="truncate font-medium">Bakkerij Zonnig</p><p class="text-[10px] text-muted-foreground">{{ t('frag.walletHome.bzMeta') }}</p></div>
        <span class="font-mono">€7,80</span>
      </div>
    </div>
  </div>
</template>
