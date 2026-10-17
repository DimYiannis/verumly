<template>
  <div class="flex h-[560px] flex-col gap-3 bg-background p-4 text-[13px] text-foreground">
    <div class="rounded-2xl bg-[#1C1F6E] p-5 text-center text-white">
      <p class="text-[10px] tracking-wider text-[#B3B6EE]">STILL OPEN</p>
      <p class="mt-1 font-mono text-[34px] leading-none font-medium">€5,34</p>
      <p class="mt-1 text-[11px] text-[#E6E7F8]">Anna owes you for 2 coffee and half the beer</p>
    </div>
    <div class="grid grid-cols-2 gap-2.5">
      <div class="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card p-3">
        <span class="grid size-11 place-items-center rounded-full border border-[#B3B6EE] bg-[#E6E7F8] font-semibold text-[#1C1F6E]">SM</span>
        <p class="font-medium">You</p>
        <p class="font-mono text-[11px]">€5,35</p>
        <span class="rounded-md border border-[#B9D8BF] bg-[#E3F0E4] px-2 py-0.5 text-[10px] text-success">Paid it all</span>
      </div>
      <div class="flex flex-col items-center gap-1.5 rounded-xl border border-primary bg-card p-3 ring-2 ring-[#E6E7F8]">
        <span class="grid size-11 place-items-center rounded-full border border-[#B9D8BF] bg-[#DDECE3] font-semibold text-[#23552F]">AN</span>
        <p class="font-medium">Anna</p>
        <p class="font-mono text-[11px]">€5,34</p>
        <span class="rounded-md border border-[#E6D29C] bg-[#F7EED6] px-2 py-0.5 text-[10px] text-[#7A5A10]">Owes you</span>
      </div>
    </div>
    <div class="grid h-11 place-items-center rounded-xl bg-primary font-medium text-white">Mark Anna as settled</div>
    <div class="overflow-hidden rounded-xl border border-border bg-card font-mono text-[11px]">
      <div class="flex justify-between border-b border-border p-2.5"><span>2 × Koffie</span><span>€6,80</span></div>
      <div class="flex justify-between border-b border-border p-2.5"><span>1 × Bier</span><span>€3,89</span></div>
      <div class="flex justify-between bg-muted p-2.5 font-semibold"><span>Total</span><span>€10,69</span></div>
    </div>
  </div>
</template>
