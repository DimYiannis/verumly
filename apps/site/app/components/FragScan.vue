<script setup lang="ts">
const { t } = useSiteLocale();
</script>

<template>
  <div class="grid gap-6 p-6 sm:grid-cols-2 sm:items-center">
    <div class="flex flex-col items-center gap-3">
      <div class="rounded-2xl border border-border bg-white p-3 shadow-sm">
        <div class="relative size-36 rounded bg-[repeating-conic-gradient(#14152B_0_25%,#fff_0_50%)] bg-[length:18px_18px]">
          <i class="absolute top-0 left-0 size-11 border-[6px] border-[#14152B] bg-white" />
          <i class="absolute top-0 right-0 size-11 border-[6px] border-[#14152B] bg-white" />
          <i class="absolute bottom-0 left-0 size-11 border-[6px] border-[#14152B] bg-white" />
        </div>
      </div>
      <p class="text-sm text-muted-foreground">{{ t('frag.scan.onTill') }}</p>
    </div>
    <div class="space-y-3 text-sm">
      <div class="rounded-xl border border-border bg-card p-3">
        <p class="text-xs text-muted-foreground">Café Het Plein</p>
        <p class="font-mono text-lg font-medium">€10,69</p>
        <span class="rounded-md border border-[#B9D8BF] bg-[#E3F0E4] px-2 py-0.5 text-xs text-success">{{ t('frag.scan.paidCard') }}</span>
      </div>
      <p class="text-muted-foreground">{{ t('frag.scan.point') }}</p>
    </div>
  </div>
</template>
