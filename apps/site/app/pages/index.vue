<script setup lang="ts">
import FragCountries from '~/components/FragCountries.vue';
import FragDashboard from '~/components/FragDashboard.vue';
import FragDesigner from '~/components/FragDesigner.vue';
import FragScan from '~/components/FragScan.vue';
import FragSplit from '~/components/FragSplit.vue';
import FragTill from '~/components/FragTill.vue';

const config = useRuntimeConfig().public;
// Demo links: the env var wins; in `nuxt dev` an unset one falls back to the local apps. A URL that is still unresolved
// (production build without env vars) makes its button link to #try instead, and the note there says the demo is coming.
// `demoLive` is true only when both the wallet and dashboard URLs are resolved.
const resolvedWalletUrl = config.walletUrl || (import.meta.dev ? 'http://localhost:3001' : '');
const resolvedDashboardUrl = config.dashboardUrl || (import.meta.dev ? 'http://localhost:3000/dashboard' : '');
const demoLive = Boolean(resolvedWalletUrl && resolvedDashboardUrl);
const walletUrl = resolvedWalletUrl || '#try';
const dashboardUrl = resolvedDashboardUrl || '#try';
const repoUrl = config.repoUrl;

useSeoMeta({
  title: 'bonnen: every receipt, saved the moment you pay',
  description: 'Scan the code at the till and the receipt lands in your wallet: kept, split with friends, ready for your books. Private by design: the shop never learns who you are.',
  ogTitle: 'bonnen: every receipt, saved the moment you pay',
  ogDescription: 'Digital receipts that stay private. Keep them, split them with friends, hand them to your accountant.',
  ogType: 'website',
  ogImage: `${config.siteUrl}/og.png`,
  twitterImage: `${config.siteUrl}/og.png`,
  twitterCard: 'summary_large_image',
});

// Phone menu: toggled by the header button, closed by a link click or Escape.
const menuOpen = ref(false);
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') menuOpen.value = false;
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

const navLinks = [
  { label: 'Why', href: '#why' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Features', href: '#features' },
  { label: 'Privacy', href: '#privacy' },
];

const problems = [
  { title: 'Paper fades, apps multiply', body: 'Receipts end up in drawers, photos and inboxes, and every shop wants its own loyalty app that asks who you are. You keep neither the receipt nor your privacy.' },
  { title: 'Splitting a bill is homework', body: 'One person does the maths, someone forgets, and a week later you are still chasing five euros. The receipt has the numbers, but nothing uses them.' },
  { title: 'Shops drown in paperwork', body: 'VAT per rate, a different rulebook in every country, tills that must prove nothing changed. The data exists the moment you pay, and it should arrive clean.' },
];

const steps = [
  { label: 'Pay', title: 'The till issues a signed receipt', body: 'When the sale is paid, the till signs the receipt with its own key and sends it. If the network drops, sales queue on the till and arrive in order, exactly once.', fragment: FragTill },
  { label: 'Scan', title: 'One code, no account needed', body: 'The till shows a QR code (or an NFC tag). Your phone camera opens the receipt in the browser: nothing to install, nothing to sign up for. Save it when you want to keep it.', fragment: FragScan },
  { label: 'Keep and share', title: 'Your wallet, your friends', body: 'Saved receipts live in your wallet: this month at a glance, a clean list, a PDF whenever you need one. Split a bill in two taps, share a receipt, settle up by hand.', fragment: FragSplit },
  { label: 'Close the books', title: 'The shop sees sales, never people', body: 'The dashboard shows what is happening today, builds any report you ask for, and exports the VAT numbers for your accountant. Setup asks only what your country requires.', fragment: FragDashboard },
];

const facts = [
  { value: '0', label: 'buyer identifiers on the shop side', body: 'The link between a person and a receipt lives in one table the shop systems cannot read.' },
  { value: '31', label: 'countries mapped', body: 'Receipt rules for the EU, the UK, Switzerland, Norway and Iceland, compiled into the business setup.' },
  { value: '2', label: 'taps to split a bill', body: 'Pick the people, pick equal, by item or custom. The amounts add up to the cent.' },
];

const features = [
  { title: 'Split with friends', body: 'Equal, by item or custom amounts. Tip and rounding spread fairly. People without the app get a link.' },
  { title: 'Friends and sharing', body: 'Add friends by name, QR, link or NFC. Share a receipt, react with an emoji, see who paid you back.' },
  { title: 'Your receipt, your design', body: 'A drag-and-drop designer for logo, colours, fonts and layout. The legally required blocks stay locked.' },
  { title: 'The PDF matches', body: 'What you design is what the wallet shows and what the PDF prints, for the customer and for your archive.' },
  { title: 'Reports you build', body: 'Group by day, hour, item, location or payment method, pick the numbers, compare with last period, save the view.' },
  { title: 'Legal setup by country', body: 'Pick your country and the setup asks for exactly what the law requires there, with sources and a clear disclaimer.' },
  { title: 'Works offline', body: 'Tills keep selling without a connection and the wallet shows saved receipts without one too.' },
  { title: 'Photo receipts', body: 'Take a photo of a paper receipt or upload a photo or PDF. It is read automatically into items, categories and VAT, and you check the result.' },
  { title: 'Plans for shops', body: 'Starter and Business plans, with a free Business trial to begin. Payments are demo only for now: no money moves.' },
  { title: 'Private by default', body: 'No loyalty tracking, no public feed, no buyer analytics for shops. Delete your account any time.' },
];

const faqs = [
  { q: 'Do customers need to install an app?', a: 'No. The wallet is a web app: the QR code opens the receipt in the browser, and saving it takes an email. On iPhone, adding it to the Home Screen enables push notifications.' },
  { q: 'Does it handle payments?', a: 'No, and that is on purpose. A receipt is issued after payment, so it is treated as paid. Splitting a bill tracks who owes whom; people settle up themselves.' },
  { q: 'Is it legal in my country?', a: 'Receipt rules differ a lot. We have mapped them for 31 countries and the setup asks for the right details, but the research is not reviewed by a tax adviser and is not legal advice. Issuing receipts is live for the Netherlands; other countries are the next step.' },
  { q: 'What do shops get to know about me?', a: 'Sales, items and VAT, never who you are. Receipts are stored under the shop only, and the only link to a person sits in a table the shop systems cannot read.' },
  { q: 'What if the shop is offline?', a: 'The till stores signed sales and sends them in order when the connection is back. Your receipt link shows an "arriving" state until then.' },
  { q: 'Is this finished?', a: 'It is a working MVP built at a hackathon: the till, wallet, dashboard, splitting, designer and reports run end to end. See “Where we are” above for what is still ahead.' },
];

const status = {
  working: ['Receipts from the till to the wallet, with offline queue', 'Friends, sharing, splitting and balances', 'Dashboard: overview, archive, reports builder, exports, setup', 'Receipt designer with locked legal blocks, PDF that matches', 'English and Dutch'],
  next: ['Receipts for countries other than the Netherlands (VAT rates, currencies, fiscal fields)', 'Fiscal devices where the law requires them (TSE, RT, and others)', 'Push notifications for friends and groups', 'Review of the legal research by a tax adviser'],
};
</script>

<template>
  <div class="bg-[#FDFCFA] p-3 text-foreground md:p-4">
    <!-- Hero -->
    <section class="flex min-h-[calc(100svh-1.5rem)] flex-col overflow-hidden rounded-2xl bg-primary px-6 pb-12 text-white md:min-h-[calc(100svh-2rem)] md:rounded-[1.75rem] md:px-12 md:pb-16">
      <div class="mx-auto flex w-full max-w-6xl flex-1 flex-col">
        <header class="flex items-center justify-between py-6 md:py-10">
          <NuxtLink to="/" aria-label="bonnen home" class="no-underline hover:text-white"><SiteLogo light /></NuxtLink>
          <nav class="flex items-center gap-5 md:gap-9" aria-label="Main">
            <a v-for="l in navLinks" :key="l.href" :href="l.href" class="hidden text-lg font-light text-white no-underline transition-opacity hover:text-white hover:opacity-75 lg:block">{{ l.label }}</a>
            <a href="#try" class="rounded-xl bg-white px-5 py-2.5 font-medium text-primary no-underline hover:bg-[#E6E7F8] hover:text-primary md:px-6 md:py-3 md:text-lg">Try the demo</a>
            <button type="button" class="grid size-11 place-items-center rounded-xl border border-white/45 text-white hover:bg-white/10 lg:hidden" aria-label="Menu" aria-controls="site-menu" :aria-expanded="menuOpen" data-testid="site-menu-button" @click="menuOpen = !menuOpen">
              <svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path v-if="menuOpen" d="M6 6l12 12M18 6L6 18" />
                <path v-else d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
          </nav>
        </header>
        <div v-show="menuOpen" id="site-menu" class="-mt-2 mb-4 rounded-2xl bg-white/10 p-2 lg:hidden" data-testid="site-menu">
          <a v-for="l in navLinks" :key="l.href" :href="l.href" class="block rounded-xl px-4 py-3 text-lg font-light text-white no-underline hover:bg-white/10 hover:text-white" @click="menuOpen = false">{{ l.label }}</a>
        </div>

        <div class="flex flex-1 flex-col gap-14 pt-6 md:pt-10 lg:grid lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-center">
          <div class="max-w-[36rem]">
            <p class="mb-5 inline-flex rounded-full border border-white/30 px-4 py-1.5 text-sm text-[#E6E7F8]">Digital receipts, private by design</p>
            <h1 class="text-[clamp(3.2rem,5.6vw,5rem)] leading-[0.98] font-medium tracking-[-0.035em] text-balance">Every receipt, saved the moment you pay.</h1>
            <p class="mt-8 max-w-md text-lg leading-relaxed font-light text-pretty text-[#E6E7F8] md:text-xl">Scan the code at the till. The receipt lands in your wallet: kept, split with friends, ready for your books. The shop never learns who you are.</p>
            <div class="mt-10 flex flex-wrap gap-3">
              <a href="#how-it-works" class="rounded-xl bg-white px-8 py-4 font-medium text-primary no-underline hover:bg-[#E6E7F8] hover:text-primary md:text-lg">See how it works</a>
              <a href="#for" class="rounded-xl border border-white/45 px-8 py-4 font-medium text-white no-underline hover:bg-white/10 hover:text-white md:text-lg">For shops and for you</a>
            </div>
          </div>
          <div class="relative mx-auto w-full max-w-[340px] pb-6">
            <SitePhone label="The wallet home: this month so far, balances and recent receipts"><FragWalletHome /></SitePhone>
            <div class="absolute top-[30%] -left-4 hidden w-52 rounded-2xl border border-border bg-card p-3 text-foreground shadow-[0_18px_40px_-14px_rgba(20,21,43,0.5)] sm:block lg:-left-28" aria-hidden="true">
              <p class="text-[11px] text-muted-foreground">Just now</p>
              <p class="text-sm"><b>Anna</b> paid you back <b class="font-mono">€5,34</b></p>
            </div>
            <div class="absolute -right-2 bottom-24 hidden w-44 rounded-2xl border border-border bg-card p-3 text-foreground shadow-[0_18px_40px_-14px_rgba(20,21,43,0.5)] sm:block lg:-right-10" aria-hidden="true">
              <p class="text-[11px] text-muted-foreground">New receipt</p>
              <p class="text-sm font-medium">Café Het Plein</p>
              <p class="font-mono text-sm">€10,69 · paid</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Why -->
    <section id="why" class="mt-3 scroll-mt-6 rounded-2xl bg-[#14152B] px-6 py-20 text-[#F8F7F4] md:mt-4 md:rounded-3xl md:px-10 md:py-28">
      <div class="mx-auto grid max-w-6xl gap-14 lg:grid-cols-[2fr_3fr] lg:gap-20">
        <div class="lg:sticky lg:top-16 lg:self-start">
          <p class="font-medium text-[#8A8EE0]">The problem</p>
          <h2 class="mt-3 text-4xl font-medium tracking-tight md:text-5xl">A receipt should be the easiest thing in the world to keep. It is not.</h2>
        </div>
        <ol>
          <li v-for="(p, i) in problems" :key="p.title" class="grid grid-cols-[auto_1fr] gap-x-6 border-t border-white/15 py-10 first:border-t-0 first:pt-0 last:pb-0 md:gap-x-10">
            <span class="text-5xl leading-none font-medium tracking-tight text-[#8A8EE0] tabular-nums md:text-6xl">{{ String(i + 1).padStart(2, '0') }}</span>
            <div>
              <h3 class="text-2xl font-medium tracking-tight md:text-3xl">{{ p.title }}</h3>
              <p class="mt-3 max-w-lg text-lg leading-relaxed font-light text-white/70">{{ p.body }}</p>
            </div>
          </li>
        </ol>
      </div>
    </section>

    <!-- How it works -->
    <section id="how-it-works" class="mx-auto max-w-6xl scroll-mt-6 px-6 py-24 md:py-32">
      <div class="grid gap-12 lg:grid-cols-[2fr_3fr] lg:gap-20">
        <div class="lg:sticky lg:top-16 lg:self-start">
          <p class="font-medium text-primary">How it works</p>
          <h2 class="mt-3 text-4xl font-medium tracking-tight md:text-5xl">From the till to your wallet in the time it takes to pay.</h2>
          <p class="mt-6 max-w-md text-lg leading-relaxed font-light text-muted-foreground">Four steps, no sign-up on the way in, and nothing that tells the shop who you are.</p>
          <!-- plain outline of the steps on the right: not interactive, so no padding, hover or button look -->
          <ol class="mt-10 hidden space-y-2 border-l-2 border-border pl-5 lg:block" aria-hidden="true">
            <li v-for="(s, i) in steps" :key="s.label" class="flex items-baseline gap-4 text-muted-foreground"><span class="text-sm tabular-nums">{{ String(i + 1).padStart(2, '0') }}</span><span class="text-lg text-muted-foreground">{{ s.label }}</span></li>
          </ol>
        </div>
        <div class="min-w-0">
          <template v-for="(s, i) in steps" :key="s.label">
            <article class="flex flex-col rounded-3xl border border-border bg-card p-6 md:p-8 lg:sticky" :class="i ? 'mt-10 lg:mt-24' : ''" :style="{ top: `${4 + i * 0.75}rem` }">
              <p class="text-sm text-muted-foreground">{{ String(i + 1).padStart(2, '0') }} · {{ s.label }}</p>
              <h3 class="mt-3 text-2xl font-medium tracking-tight md:text-3xl">{{ s.title }}</h3>
              <div class="mt-6 overflow-hidden rounded-2xl bg-muted"><component :is="s.fragment" /></div>
              <p class="mt-6 max-w-lg text-lg leading-relaxed font-light text-muted-foreground">{{ s.body }}</p>
            </article>
          </template>
        </div>
      </div>
    </section>

    <!-- Facts -->
    <section id="facts" class="mx-auto max-w-6xl scroll-mt-6 px-6 pb-24 md:pb-32">
      <p class="font-medium text-primary">By the numbers</p>
      <h2 class="mt-3 max-w-2xl text-4xl font-medium tracking-tight md:text-5xl">Small numbers, on purpose.</h2>
      <div class="mt-14 grid gap-6 md:grid-cols-3">
        <div v-for="f in facts" :key="f.label" class="flex flex-col rounded-2xl border border-border bg-card p-8">
          <span class="text-6xl leading-none font-medium tracking-tight text-primary tabular-nums md:text-7xl">{{ f.value }}</span>
          <h3 class="mt-4 text-xl font-medium">{{ f.label }}</h3>
          <p class="mt-3 leading-relaxed font-light text-muted-foreground">{{ f.body }}</p>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section id="features" class="mx-auto max-w-6xl scroll-mt-6 px-6 pb-24 md:pb-32">
      <p class="font-medium text-primary">Features</p>
      <h2 class="mt-3 max-w-3xl text-4xl font-medium tracking-tight md:text-5xl">Everything a receipt can do, once it is data and not paper.</h2>
      <div class="mt-14 grid gap-6 lg:grid-cols-2">
        <div class="overflow-hidden rounded-3xl border border-border bg-card">
          <div class="bg-muted"><FragDesigner /></div>
          <div class="p-6 md:p-8"><h3 class="text-2xl font-medium tracking-tight">Your receipt, your design</h3><p class="mt-2 text-lg leading-relaxed font-light text-muted-foreground">Logo, colours, fonts and layout, with a live preview. The legally required blocks stay locked, and the wallet and the PDF both follow your design.</p></div>
        </div>
        <div class="overflow-hidden rounded-3xl border border-border bg-card">
          <div class="bg-muted"><FragCountries /></div>
          <div class="p-6 md:p-8"><h3 class="text-2xl font-medium tracking-tight">Legal setup by country</h3><p class="mt-2 text-lg leading-relaxed font-light text-muted-foreground">Choose the country and the setup shows what its law asks of a till, with sources, confidence and a plain disclaimer. Compiled research, not legal advice.</p></div>
        </div>
      </div>
      <div class="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <div v-for="f in features" :key="f.title" class="rounded-2xl border border-border bg-card p-6">
          <h3 class="text-lg font-medium tracking-tight">{{ f.title }}</h3>
          <p class="mt-2 leading-relaxed font-light text-muted-foreground">{{ f.body }}</p>
        </div>
      </div>
    </section>

    <!-- For people and for shops -->
    <section id="for" class="mx-auto max-w-6xl scroll-mt-6 px-6 pb-24 md:pb-32">
      <div class="grid gap-6 md:grid-cols-2">
        <div class="rounded-3xl bg-[#E6E7F8] p-8 md:p-10">
          <p class="font-medium text-[#1C1F6E]">For people</p>
          <h3 class="mt-3 text-3xl font-medium tracking-tight text-[#14152B]">Keep what you buy. Split what you share.</h3>
          <ul class="mt-6 space-y-3 text-lg font-light text-[#42445F]">
            <li>Every receipt in one place, searchable, with PDFs on demand</li>
            <li>This month at a glance, with an optional budget</li>
            <li>Bills split with friends, balances tracked, no payments in the middle</li>
            <li>No loyalty card, no tracking, delete everything whenever you like</li>
          </ul>
          <a :href="walletUrl" class="mt-8 inline-block rounded-xl bg-primary px-7 py-3.5 font-medium text-white no-underline hover:bg-[#1C1F6E] hover:text-white">Open the wallet</a>
        </div>
        <div class="rounded-3xl bg-[#14152B] p-8 text-[#F8F7F4] md:p-10">
          <p class="font-medium text-[#8A8EE0]">For shops</p>
          <h3 class="mt-3 text-3xl font-medium tracking-tight">Cleaner books, nicer receipts, no paper.</h3>
          <ul class="mt-6 space-y-3 text-lg font-light text-white/75">
            <li>A live overview of today, tills online or offline, what needs a look</li>
            <li>Reports you build yourself and a VAT export for your accountant</li>
            <li>Receipts in your own design, in the wallet and as PDF</li>
            <li>Setup that follows the rules of your country</li>
          </ul>
          <a :href="dashboardUrl" class="mt-8 inline-block rounded-xl bg-white px-7 py-3.5 font-medium text-primary no-underline hover:bg-[#E6E7F8] hover:text-primary">Open the dashboard</a>
        </div>
      </div>
    </section>

    <!-- Privacy -->
    <section id="privacy" class="scroll-mt-6 rounded-2xl bg-[#1C1F6E] px-6 py-20 text-white md:rounded-3xl md:px-10 md:py-28">
      <div class="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[2fr_3fr] lg:gap-20">
        <div>
          <p class="font-medium text-[#B3B6EE]">Privacy</p>
          <h2 class="mt-3 text-4xl font-medium tracking-tight md:text-5xl">The shop never learns who you are.</h2>
          <p class="mt-6 max-w-md text-lg leading-relaxed font-light text-[#E6E7F8]">Not a promise in a policy: the way it is built makes it hard to break.</p>
          <NuxtLink to="/privacy" class="mt-8 inline-block rounded-xl border border-white/45 px-6 py-3 font-medium text-white no-underline hover:bg-white/10 hover:text-white">Read how it works</NuxtLink>
        </div>
        <ul class="grid gap-4 sm:grid-cols-2">
          <li class="rounded-2xl border border-white/20 bg-white/5 p-6"><h3 class="text-xl font-medium">Separate by design</h3><p class="mt-2 font-light text-[#E6E7F8]">Shop systems and buyer systems use different database roles. The shop side cannot read who saved a receipt, even if its own code is wrong.</p></li>
          <li class="rounded-2xl border border-white/20 bg-white/5 p-6"><h3 class="text-xl font-medium">A secret in the link</h3><p class="mt-2 font-light text-[#E6E7F8]">The receipt secret travels in the part of the link that never reaches a server, and only its hash is stored.</p></li>
          <li class="rounded-2xl border border-white/20 bg-white/5 p-6"><h3 class="text-xl font-medium">Stripped at the till</h3><p class="mt-2 font-light text-[#E6E7F8]">Loyalty card numbers, masked card numbers and names are removed before a receipt is signed.</p></li>
          <li class="rounded-2xl border border-white/20 bg-white/5 p-6"><h3 class="text-xl font-medium">Yours to take away</h3><p class="mt-2 font-light text-[#E6E7F8]">Download your data, or delete your account: it is removed for good after 30 days.</p></li>
        </ul>
      </div>
    </section>

    <!-- Status -->
    <section id="status" class="mx-auto max-w-6xl scroll-mt-6 px-6 py-24 md:py-32">
      <p class="font-medium text-primary">Where we are</p>
      <h2 class="mt-3 max-w-3xl text-4xl font-medium tracking-tight md:text-5xl">A working MVP, honest about what is next.</h2>
      <div class="mt-14 grid gap-6 md:grid-cols-2">
        <div class="rounded-2xl border border-border bg-card p-8">
          <h3 class="text-xl font-medium">Working today</h3>
          <ul class="mt-4 space-y-2.5 font-light text-muted-foreground"><li v-for="w in status.working" :key="w" class="flex gap-3"><span class="mt-2 size-2 shrink-0 rounded-full bg-success" />{{ w }}</li></ul>
        </div>
        <div class="rounded-2xl border border-border bg-card p-8">
          <h3 class="text-xl font-medium">Next</h3>
          <ul class="mt-4 space-y-2.5 font-light text-muted-foreground"><li v-for="n in status.next" :key="n" class="flex gap-3"><span class="mt-2 size-2 shrink-0 rounded-full bg-[#8A8EE0]" />{{ n }}</li></ul>
        </div>
      </div>
      <p class="mt-6 max-w-3xl text-sm text-muted-foreground">The legal summaries for each country were compiled from public sources in October 2026 and have not been reviewed by a tax adviser. They are not legal advice.</p>
    </section>

    <!-- FAQ -->
    <section id="faq" class="mx-auto max-w-4xl scroll-mt-6 px-6 pb-24 md:pb-32">
      <p class="font-medium text-primary">Questions</p>
      <h2 class="mt-3 text-4xl font-medium tracking-tight md:text-5xl">Good to know.</h2>
      <div class="mt-10 divide-y divide-border rounded-2xl border border-border bg-card">
        <details v-for="f in faqs" :key="f.q" class="group px-6 py-5">
          <summary class="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-medium">{{ f.q }}<span class="text-primary transition-transform group-open:rotate-45" aria-hidden="true">+</span></summary>
          <p class="mt-3 max-w-2xl leading-relaxed font-light text-muted-foreground">{{ f.a }}</p>
        </details>
      </div>
    </section>

    <!-- Try it -->
    <section id="try" class="scroll-mt-6 rounded-2xl bg-primary px-6 py-20 text-center text-white md:rounded-3xl md:py-28">
      <div class="mx-auto max-w-3xl">
        <h2 class="text-4xl font-medium tracking-tight text-balance md:text-6xl">Try it with a demo shop.</h2>
        <p class="mx-auto mt-6 max-w-xl text-lg font-light text-[#E6E7F8] md:text-xl">Issue a receipt on the till simulator, scan it with your phone, split it with a demo friend, then look at the books from the shop side.</p>
        <div class="mt-10 flex flex-wrap justify-center gap-3">
          <a :href="walletUrl" class="rounded-xl bg-white px-8 py-4 font-medium text-primary no-underline hover:bg-[#E6E7F8] hover:text-primary md:text-lg">Open the wallet</a>
          <a :href="dashboardUrl" class="rounded-xl border border-white/45 px-8 py-4 font-medium text-white no-underline hover:bg-white/10 hover:text-white md:text-lg">Open the dashboard</a>
        </div>
        <p v-if="!demoLive" class="mt-6 text-sm text-[#B3B6EE]">The demo goes online soon.<template v-if="repoUrl"> To run it yourself, see the <a :href="repoUrl" rel="noopener noreferrer" class="text-white underline">README in the repository</a>.</template></p>
      </div>
    </section>

    <footer class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-10 text-sm text-muted-foreground">
      <SiteLogo />
      <p>Built for a hackathon. Receipts, kept private.</p>
      <nav class="flex gap-5" aria-label="Footer"><NuxtLink to="/privacy">Privacy</NuxtLink><a v-if="config.repoUrl" :href="config.repoUrl" rel="noopener noreferrer">Source</a></nav>
    </footer>
  </div>
</template>
