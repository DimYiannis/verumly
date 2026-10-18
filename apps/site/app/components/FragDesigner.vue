<script setup lang="ts">
const { t } = useSiteLocale();
</script>

<template>
  <div class="grid gap-4 p-6 sm:grid-cols-[1fr_auto] sm:items-start">
    <div class="space-y-2 rounded-xl border border-border bg-card p-3 text-sm">
      <p class="text-xs tracking-wider text-muted-foreground">{{ t('frag.designer.layers') }}</p>
      <p class="flex items-center justify-between rounded-lg px-2 py-1.5">{{ t('frag.designer.logo') }} <span class="text-muted-foreground">{{ t('frag.designer.visible') }}</span></p>
      <p class="flex items-center justify-between rounded-lg px-2 py-1.5">{{ t('frag.designer.merchantName') }} <span class="text-muted-foreground">{{ t('frag.designer.visible') }}</span></p>
      <p class="flex items-center justify-between rounded-lg bg-[#E6E7F8] px-2 py-1.5 text-[#1C1F6E]">{{ t('frag.designer.items') }} <span>{{ t('frag.designer.required') }}</span></p>
      <p class="flex items-center justify-between rounded-lg px-2 py-1.5">{{ t('frag.designer.totals') }} <span class="text-muted-foreground">{{ t('frag.designer.required') }}</span></p>
      <p class="flex items-center justify-between rounded-lg px-2 py-1.5">{{ t('frag.designer.thanks') }} <span class="text-muted-foreground">{{ t('frag.designer.visible') }}</span></p>
    </div>
    <div class="mx-auto w-52 rounded-2xl border border-border bg-[#FFF8E7] p-4 font-serif text-[#112233] shadow-[0_12px_30px_-12px_rgba(20,21,43,0.3)]">
      <p class="text-center text-lg font-bold text-[#AA3300]">Café Het Plein</p>
      <p class="text-center text-[9px]">KvK 12345678 · 17 Oct 2026</p>
      <div class="my-2 border-t border-dashed border-[#999]" />
      <p class="flex justify-between text-xs"><span>2 × Koffie</span><span>€6,80</span></p>
      <p class="flex justify-between text-xs"><span>1 × Bier</span><span>€3,89</span></p>
      <div class="my-2 border-t border-dashed border-[#999]" />
      <p class="flex justify-between text-base font-bold"><span>{{ t('frag.designer.total') }}</span><span>€10,69</span></p>
      <p class="mt-3 text-center text-[11px]">Dankjewel, tot snel!</p>
    </div>
  </div>
</template>
