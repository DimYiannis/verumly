<script setup lang="ts">
useSeoMeta({
  title: 'How privacy works: bonnen',
  description: 'How a receipt travels from the till to your wallet without the shop learning who you are.',
});

const steps = [
  { n: '01', title: 'The till creates the receipt and a secret', body: 'The secret is generated on the till. Only its SHA-256 hash is ever stored on a server. The receipt itself has no field for a buyer: no name, no email, no loyalty number.' },
  { n: '02', title: 'The till signs it', body: 'Before anything leaves the till, loyalty card numbers, masked card numbers and customer names are stripped. The receipt is then signed with the till\'s own Ed25519 key, and every later version (for example a cancellation) is signed too.' },
  { n: '03', title: 'The link keeps the secret out of servers', body: 'The QR code holds a link with the receipt id and the secret after a # sign. Browsers never send that part to a server, and the wallet removes it from the address bar after reading it.' },
  { n: '04', title: 'Saving makes the only link', body: 'When you save a receipt, the wallet sends the secret in a request body. The server checks it against the stored hash and records one row: this person has this receipt. That row lives in a table the shop systems cannot read.' },
];

const roles = [
  { name: 'merchant_api', does: 'Receives signed receipts from tills', cannot: 'Read anything about buyers' },
  { name: 'dashboard', does: 'Shows the shop its own sales, reports and archive', cannot: 'Read anything about buyers' },
  { name: 'buyer_api', does: 'Serves the wallet: receipts, friends, splits', cannot: 'Change a shop\'s receipts or settings' },
  { name: 'worker', does: 'Background jobs: reading photos, exports, cleanup', cannot: 'Be reached from the internet' },
];
</script>

<template>
  <div class="bg-[#FDFCFA] p-3 md:p-4">
    <header class="mx-auto flex max-w-4xl items-center justify-between px-3 py-6 md:py-8">
      <NuxtLink to="/" aria-label="bonnen home" class="no-underline"><SiteLogo /></NuxtLink>
      <NuxtLink to="/" class="text-primary">Back to the start</NuxtLink>
    </header>

    <main class="mx-auto max-w-4xl px-3 pb-24">
      <p class="font-medium text-primary">Privacy</p>
      <h1 class="mt-3 text-4xl font-medium tracking-tight text-balance md:text-6xl">How a receipt travels without telling the shop who you are.</h1>
      <p class="mt-6 max-w-2xl text-lg leading-relaxed font-light text-muted-foreground">The short version: receipts belong to the shop, the link between you and a receipt belongs to you, and the two are kept apart by how the system is built, not only by what we say.</p>

      <ol class="mt-14 space-y-5">
        <li v-for="s in steps" :key="s.n" class="grid grid-cols-[auto_1fr] gap-x-6 rounded-2xl border border-border bg-card p-6 md:p-8">
          <span class="text-4xl leading-none font-medium text-primary tabular-nums">{{ s.n }}</span>
          <div><h2 class="text-xl font-medium tracking-tight md:text-2xl">{{ s.title }}</h2><p class="mt-2 leading-relaxed font-light text-muted-foreground">{{ s.body }}</p></div>
        </li>
      </ol>

      <h2 class="mt-16 text-3xl font-medium tracking-tight">Four database roles that cannot see each other</h2>
      <p class="mt-3 max-w-2xl font-light text-muted-foreground">Every part of the system connects to the database as its own role, with row-level security by shop. The shop-side roles have no access at all to the buyer schema: a test tries to read, write and truncate every buyer table as each of them and expects a permission error.</p>
      <div class="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
        <div class="overflow-x-auto">
        <table class="w-full min-w-[34rem] text-left text-sm">
          <thead class="bg-muted text-xs tracking-wider text-muted-foreground"><tr><th class="px-5 py-3">ROLE</th><th class="px-5 py-3">DOES</th><th class="px-5 py-3">CANNOT</th></tr></thead>
          <tbody>
            <tr v-for="r in roles" :key="r.name" class="border-t border-border"><td class="px-5 py-3 font-mono">{{ r.name }}</td><td class="px-5 py-3">{{ r.does }}</td><td class="px-5 py-3 text-muted-foreground">{{ r.cannot }}</td></tr>
          </tbody>
        </table>
        </div>
      </div>

      <h2 class="mt-16 text-3xl font-medium tracking-tight">Friends, sharing and splits</h2>
      <p class="mt-3 max-w-2xl font-light text-muted-foreground">Friends, shared receipts and splits live on the buyer side only. Sharing or splitting shows a friend the items and total of that receipt, nothing else, and the app says so before you confirm. Friends never see your email address, and there is no public feed.</p>

      <h2 class="mt-16 text-3xl font-medium tracking-tight">Your data</h2>
      <p class="mt-3 max-w-2xl font-light text-muted-foreground">You can download everything we hold about you as a file, and delete your account at any time. Deleted accounts are removed for good after 30 days.</p>

      <div class="mt-16 rounded-2xl border border-[#E6D29C] bg-[#F7EED6] p-6 text-[#7A5A10]">
        <h2 class="text-lg font-medium">What this page does not claim</h2>
        <p class="mt-2 font-light">This is an MVP built at a hackathon. It has not had an external security audit or a legal review, and the country-by-country receipt rules are compiled research, not legal advice.</p>
      </div>
    </main>
  </div>
</template>
