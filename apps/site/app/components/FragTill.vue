<template>
  <div class="space-y-3 p-6 text-sm">
    <div class="rounded-xl border border-border bg-card p-4">
      <div class="flex items-center justify-between">
        <p class="font-medium">Kassa 1 · Terras</p>
        <span class="rounded-md border border-[#B9D8BF] bg-[#E3F0E4] px-2 py-0.5 text-xs text-success">Online</span>
      </div>
      <div class="mt-3 space-y-1.5 font-mono text-xs">
        <p class="flex justify-between"><span>2 × Koffie</span><span>€6,80</span></p>
        <p class="flex justify-between"><span>1 × Bier</span><span>€3,89</span></p>
        <p class="flex justify-between border-t border-dashed border-border pt-1.5 font-semibold"><span>Total</span><span>€10,69</span></p>
      </div>
      <div aria-hidden="true" class="mt-3 grid h-10 place-items-center rounded-lg bg-primary text-sm font-medium text-white">Issue receipt</div>
    </div>
    <div class="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
      <p class="rounded-lg border border-border bg-card p-2.5">Signed on the till with its own key</p>
      <p class="rounded-lg border border-border bg-card p-2.5">Queued if the network drops, sent in order</p>
      <p class="rounded-lg border border-border bg-card p-2.5">Loyalty cards and names stripped first</p>
    </div>
  </div>
</template>
