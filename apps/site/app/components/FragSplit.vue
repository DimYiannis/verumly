<template>
  <div class="space-y-4 p-6 text-sm">
    <div class="flex items-center gap-3">
      <span class="grid size-12 place-items-center rounded-full border-2 border-primary bg-[#E6E7F8] font-semibold text-[#1C1F6E]">SM</span>
      <span class="grid size-12 place-items-center rounded-full border-2 border-primary bg-[#DDECE3] font-semibold text-[#23552F]">AN</span>
      <span class="grid size-12 place-items-center rounded-full border border-border bg-[#F7EED6] font-semibold text-[#6A4E0E]">BR</span>
      <span class="grid size-12 place-items-center rounded-full border border-dashed border-[#B3B6EE] text-primary">+</span>
    </div>
    <div class="flex gap-1 rounded-xl border border-border bg-card p-1 text-center text-[13px] font-medium">
      <span class="flex-1 rounded-lg bg-primary py-2 text-white">Equal</span>
      <span class="flex-1 py-2 text-muted-foreground">By item</span>
      <span class="flex-1 py-2 text-muted-foreground">Custom</span>
    </div>
    <div class="space-y-2 rounded-xl border border-border bg-card p-4">
      <div class="flex justify-between"><span>You</span><span class="font-mono font-medium">€5,35</span></div>
      <div class="flex justify-between"><span>Anna</span><span class="font-mono font-medium">€5,34</span></div>
      <div class="flex justify-between border-t border-border pt-2 text-muted-foreground"><span>Total</span><span class="font-mono">€10,69</span></div>
    </div>
  </div>
</template>
