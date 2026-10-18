<script setup lang="ts">
const { t } = useSiteLocale();
</script>

<template>
  <div class="space-y-4 p-6 text-sm">
    <div class="flex items-center gap-3">
      <span class="grid size-12 place-items-center rounded-full border-2 border-primary bg-[#E6E7F8] font-semibold text-[#1C1F6E]">SM</span>
      <span class="grid size-12 place-items-center rounded-full border-2 border-primary bg-[#DDECE3] font-semibold text-[#23552F]">AN</span>
      <span class="grid size-12 place-items-center rounded-full border border-border bg-[#F7EED6] font-semibold text-[#6A4E0E]">BR</span>
      <span class="grid size-12 place-items-center rounded-full border border-dashed border-[#B3B6EE] text-primary">+</span>
    </div>
    <div aria-hidden="true" class="flex gap-1 rounded-xl border border-border bg-card p-1 text-center text-[13px] font-medium">
      <span class="flex-1 rounded-lg bg-primary py-2 text-white">{{ t('frag.split.equal') }}</span>
      <span class="flex-1 py-2 text-muted-foreground">{{ t('frag.split.byItem') }}</span>
      <span class="flex-1 py-2 text-muted-foreground">{{ t('frag.split.custom') }}</span>
    </div>
    <div class="space-y-2 rounded-xl border border-border bg-card p-4">
      <div class="flex justify-between"><span>{{ t('frag.split.you') }}</span><span class="font-mono font-medium">€5,35</span></div>
      <div class="flex justify-between"><span>Anna</span><span class="font-mono font-medium">€5,34</span></div>
      <div class="flex justify-between border-t border-border pt-2 text-muted-foreground"><span>{{ t('frag.split.total') }}</span><span class="font-mono">€10,69</span></div>
    </div>
  </div>
</template>
