<script setup lang="ts">
import FragCountries from '~/components/FragCountries.vue';
import FragDashboard from '~/components/FragDashboard.vue';
import FragDesigner from '~/components/FragDesigner.vue';
import FragScan from '~/components/FragScan.vue';
import FragSplit from '~/components/FragSplit.vue';
import FragTill from '~/components/FragTill.vue';

// The landing page, rendered at `/` (English) and `/nl` (Dutch); the texts come from app/i18n.
const { t, localePath } = useSiteLocale();
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

const ogImage = `${config.siteUrl}/og.png`;
useSeoMeta({
  title: () => t('home.seo.title'),
  description: () => t('home.seo.description'),
  ogTitle: () => t('home.seo.ogTitle'),
  ogDescription: () => t('home.seo.ogDescription'),
  ogType: 'website',
  ogImage,
  twitterImage: ogImage,
  twitterCard: 'summary_large_image',
});
useLocaleHead();

// Phone menu: toggled by the header button, closed by a link click or Escape.
const menuOpen = ref(false);
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') menuOpen.value = false;
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

const navLinks = computed(() => [
  { label: t('nav.why'), href: '#why' },
  { label: t('nav.how'), href: '#how-it-works' },
  { label: t('nav.features'), href: '#features' },
  { label: t('nav.privacy'), href: '#privacy' },
]);

const problems = computed(() => [
  { title: t('home.why.p1.title'), body: t('home.why.p1.body') },
  { title: t('home.why.p2.title'), body: t('home.why.p2.body') },
  { title: t('home.why.p3.title'), body: t('home.why.p3.body') },
]);

const steps = computed(() => [
  { label: t('home.how.s1.label'), title: t('home.how.s1.title'), body: t('home.how.s1.body'), fragment: FragTill },
  { label: t('home.how.s2.label'), title: t('home.how.s2.title'), body: t('home.how.s2.body'), fragment: FragScan },
  { label: t('home.how.s3.label'), title: t('home.how.s3.title'), body: t('home.how.s3.body'), fragment: FragSplit },
  { label: t('home.how.s4.label'), title: t('home.how.s4.title'), body: t('home.how.s4.body'), fragment: FragDashboard },
]);

const facts = computed(() => [
  { value: t('home.facts.f1.value'), label: t('home.facts.f1.label'), body: t('home.facts.f1.body') },
  { value: t('home.facts.f2.value'), label: t('home.facts.f2.label'), body: t('home.facts.f2.body') },
  { value: t('home.facts.f3.value'), label: t('home.facts.f3.label'), body: t('home.facts.f3.body') },
]);

const features = computed(() => [
  { title: t('home.features.split.title'), body: t('home.features.split.body') },
  { title: t('home.features.friends.title'), body: t('home.features.friends.body') },
  { title: t('home.features.design.title'), body: t('home.features.design.body') },
  { title: t('home.features.pdf.title'), body: t('home.features.pdf.body') },
  { title: t('home.features.reports.title'), body: t('home.features.reports.body') },
  { title: t('home.features.legal.title'), body: t('home.features.legal.body') },
  { title: t('home.features.offline.title'), body: t('home.features.offline.body') },
  { title: t('home.features.photo.title'), body: t('home.features.photo.body') },
  { title: t('home.features.plans.title'), body: t('home.features.plans.body') },
  { title: t('home.features.private.title'), body: t('home.features.private.body') },
]);

const peopleItems = computed(() => [t('home.for.people.i1'), t('home.for.people.i2'), t('home.for.people.i3'), t('home.for.people.i4')]);
const shopItems = computed(() => [t('home.for.shops.i1'), t('home.for.shops.i2'), t('home.for.shops.i3'), t('home.for.shops.i4')]);

const privacyCards = computed(() => [
  { title: t('home.privacy.c1.title'), body: t('home.privacy.c1.body') },
  { title: t('home.privacy.c2.title'), body: t('home.privacy.c2.body') },
  { title: t('home.privacy.c3.title'), body: t('home.privacy.c3.body') },
  { title: t('home.privacy.c4.title'), body: t('home.privacy.c4.body') },
]);

const faqs = computed(() => [
  { q: t('faq.q1.q'), a: t('faq.q1.a') },
  { q: t('faq.q2.q'), a: t('faq.q2.a') },
  { q: t('faq.q3.q'), a: t('faq.q3.a') },
  { q: t('faq.q4.q'), a: t('faq.q4.a') },
  { q: t('faq.q5.q'), a: t('faq.q5.a') },
  { q: t('faq.q6.q'), a: t('faq.q6.a') },
]);

const status = computed(() => ({
  working: [t('status.working.i1'), t('status.working.i2'), t('status.working.i3'), t('status.working.i4'), t('status.working.i5')],
  next: [t('status.next.i1'), t('status.next.i2'), t('status.next.i3'), t('status.next.i4')],
}));
</script>

<template>
  <div class="bg-[#FDFCFA] p-3 text-foreground md:p-4">
    <!-- Hero -->
    <section class="flex min-h-[calc(100svh-1.5rem)] flex-col overflow-hidden rounded-2xl bg-primary px-6 pb-12 text-white md:min-h-[calc(100svh-2rem)] md:rounded-[1.75rem] md:px-12 md:pb-16">
      <div class="mx-auto flex w-full max-w-6xl flex-1 flex-col">
        <header class="flex items-center justify-between py-6 md:py-10">
          <NuxtLink :to="localePath('/')" :aria-label="t('nav.home')" class="no-underline hover:text-white"><SiteLogo light /></NuxtLink>
          <nav class="flex items-center gap-5 md:gap-9" :aria-label="t('nav.main')">
            <a v-for="l in navLinks" :key="l.href" :href="l.href" class="hidden text-lg font-light text-white no-underline transition-opacity hover:text-white hover:opacity-75 lg:block">{{ l.label }}</a>
            <div class="hidden lg:block"><LangSwitch light /></div>
            <a href="#try" :aria-label="t('nav.demo')" class="whitespace-nowrap rounded-xl bg-white px-3 py-2 text-sm font-medium text-primary no-underline hover:bg-[#E6E7F8] hover:text-primary sm:px-5 sm:py-2.5 sm:text-base md:px-6 md:py-3 md:text-lg"><span class="sm:hidden">{{ t('nav.tryShort') }}</span><span class="hidden sm:inline">{{ t('nav.demo') }}</span></a>
            <button type="button" class="grid size-11 place-items-center rounded-xl border border-white/45 text-white hover:bg-white/10 lg:hidden" :aria-label="t('nav.menu')" aria-controls="site-menu" :aria-expanded="menuOpen" data-testid="site-menu-button" @click="menuOpen = !menuOpen">
              <svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path v-if="menuOpen" d="M6 6l12 12M18 6L6 18" />
                <path v-else d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
          </nav>
        </header>
        <div v-show="menuOpen" id="site-menu" class="-mt-2 mb-4 rounded-2xl bg-white/10 p-2 lg:hidden" data-testid="site-menu">
          <a v-for="l in navLinks" :key="l.href" :href="l.href" class="block rounded-xl px-4 py-3 text-lg font-light text-white no-underline hover:bg-white/10 hover:text-white" @click="menuOpen = false">{{ l.label }}</a>
          <div class="px-2 py-2"><LangSwitch light /></div>
        </div>

        <div class="flex flex-1 flex-col gap-14 pt-6 md:pt-10 lg:grid lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-center">
          <div class="max-w-[36rem]">
            <p class="mb-5 inline-flex rounded-full border border-white/30 px-4 py-1.5 text-sm text-[#E6E7F8]">{{ t('home.hero.badge') }}</p>
            <h1 class="text-[clamp(3.2rem,5.6vw,5rem)] leading-[0.98] font-medium tracking-[-0.035em] text-balance">{{ t('home.hero.title') }}</h1>
            <p class="mt-8 max-w-md text-lg leading-relaxed font-light text-pretty text-[#E6E7F8] md:text-xl">{{ t('home.hero.text') }}</p>
            <div class="mt-10 flex flex-wrap gap-3">
              <a href="#how-it-works" class="rounded-xl bg-white px-8 py-4 font-medium text-primary no-underline hover:bg-[#E6E7F8] hover:text-primary md:text-lg">{{ t('home.hero.how') }}</a>
              <a href="#for" class="rounded-xl border border-white/45 px-8 py-4 font-medium text-white no-underline hover:bg-white/10 hover:text-white md:text-lg">{{ t('home.hero.for') }}</a>
            </div>
          </div>
          <div class="relative mx-auto w-full max-w-[340px] pb-6">
            <SitePhone :label="t('home.hero.phoneLabel')"><FragWalletHome /></SitePhone>
            <div class="absolute top-[30%] -left-4 hidden w-52 rounded-2xl border border-border bg-card p-3 text-foreground shadow-[0_18px_40px_-14px_rgba(20,21,43,0.5)] sm:block lg:-left-28" aria-hidden="true">
              <p class="text-[11px] text-muted-foreground">{{ t('home.hero.cardNow') }}</p>
              <p class="text-sm"><b>{{ t('home.hero.cardName') }}</b> {{ t('home.hero.cardPaidBack') }} <b class="font-mono">€5,34</b></p>
            </div>
            <div class="absolute -right-2 bottom-24 hidden w-44 rounded-2xl border border-border bg-card p-3 text-foreground shadow-[0_18px_40px_-14px_rgba(20,21,43,0.5)] sm:block lg:-right-10" aria-hidden="true">
              <p class="text-[11px] text-muted-foreground">{{ t('home.hero.cardNew') }}</p>
              <p class="text-sm font-medium">{{ t('home.hero.cardShop') }}</p>
              <p class="font-mono text-sm">{{ t('home.hero.cardPaid') }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Why -->
    <section id="why" class="mt-3 scroll-mt-6 rounded-2xl bg-[#14152B] px-6 py-20 text-[#F8F7F4] md:mt-4 md:rounded-3xl md:px-10 md:py-28">
      <div class="mx-auto grid max-w-6xl gap-14 lg:grid-cols-[2fr_3fr] lg:gap-20">
        <div class="lg:sticky lg:top-16 lg:self-start">
          <p class="font-medium text-[#8A8EE0]">{{ t('home.why.kicker') }}</p>
          <h2 class="mt-3 text-4xl font-medium tracking-tight md:text-5xl">{{ t('home.why.title') }}</h2>
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
          <p class="font-medium text-primary">{{ t('home.how.kicker') }}</p>
          <h2 class="mt-3 text-4xl font-medium tracking-tight md:text-5xl">{{ t('home.how.title') }}</h2>
          <p class="mt-6 max-w-md text-lg leading-relaxed font-light text-muted-foreground">{{ t('home.how.intro') }}</p>
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
      <p class="font-medium text-primary">{{ t('home.facts.kicker') }}</p>
      <h2 class="mt-3 max-w-2xl text-4xl font-medium tracking-tight md:text-5xl">{{ t('home.facts.title') }}</h2>
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
      <p class="font-medium text-primary">{{ t('home.features.kicker') }}</p>
      <h2 class="mt-3 max-w-3xl text-4xl font-medium tracking-tight md:text-5xl">{{ t('home.features.title') }}</h2>
      <div class="mt-14 grid gap-6 lg:grid-cols-2">
        <div class="overflow-hidden rounded-3xl border border-border bg-card">
          <div class="bg-muted"><FragDesigner /></div>
          <div class="p-6 md:p-8"><h3 class="text-2xl font-medium tracking-tight">{{ t('home.features.designer.title') }}</h3><p class="mt-2 text-lg leading-relaxed font-light text-muted-foreground">{{ t('home.features.designer.body') }}</p></div>
        </div>
        <div class="overflow-hidden rounded-3xl border border-border bg-card">
          <div class="bg-muted"><FragCountries /></div>
          <div class="p-6 md:p-8"><h3 class="text-2xl font-medium tracking-tight">{{ t('home.features.countries.title') }}</h3><p class="mt-2 text-lg leading-relaxed font-light text-muted-foreground">{{ t('home.features.countries.body') }}</p></div>
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
          <p class="font-medium text-[#1C1F6E]">{{ t('home.for.people.kicker') }}</p>
          <h3 class="mt-3 text-3xl font-medium tracking-tight text-[#14152B]">{{ t('home.for.people.title') }}</h3>
          <ul class="mt-6 space-y-3 text-lg font-light text-[#42445F]">
            <li v-for="item in peopleItems" :key="item">{{ item }}</li>
          </ul>
          <a :href="walletUrl" class="mt-8 inline-block rounded-xl bg-primary px-7 py-3.5 font-medium text-white no-underline hover:bg-[#1C1F6E] hover:text-white">{{ t('home.for.openWallet') }}</a>
        </div>
        <div class="rounded-3xl bg-[#14152B] p-8 text-[#F8F7F4] md:p-10">
          <p class="font-medium text-[#8A8EE0]">{{ t('home.for.shops.kicker') }}</p>
          <h3 class="mt-3 text-3xl font-medium tracking-tight">{{ t('home.for.shops.title') }}</h3>
          <ul class="mt-6 space-y-3 text-lg font-light text-white/75">
            <li v-for="item in shopItems" :key="item">{{ item }}</li>
          </ul>
          <a :href="dashboardUrl" class="mt-8 inline-block rounded-xl bg-white px-7 py-3.5 font-medium text-primary no-underline hover:bg-[#E6E7F8] hover:text-primary">{{ t('home.for.openDashboard') }}</a>
        </div>
      </div>
    </section>

    <!-- Privacy -->
    <section id="privacy" class="scroll-mt-6 rounded-2xl bg-[#1C1F6E] px-6 py-20 text-white md:rounded-3xl md:px-10 md:py-28">
      <div class="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[2fr_3fr] lg:gap-20">
        <div>
          <p class="font-medium text-[#B3B6EE]">{{ t('home.privacy.kicker') }}</p>
          <h2 class="mt-3 text-4xl font-medium tracking-tight md:text-5xl">{{ t('home.privacy.title') }}</h2>
          <p class="mt-6 max-w-md text-lg leading-relaxed font-light text-[#E6E7F8]">{{ t('home.privacy.text') }}</p>
          <NuxtLink :to="localePath('/privacy')" class="mt-8 inline-block rounded-xl border border-white/45 px-6 py-3 font-medium text-white no-underline hover:bg-white/10 hover:text-white">{{ t('home.privacy.link') }}</NuxtLink>
        </div>
        <ul class="grid gap-4 sm:grid-cols-2">
          <li v-for="c in privacyCards" :key="c.title" class="rounded-2xl border border-white/20 bg-white/5 p-6"><h3 class="text-xl font-medium">{{ c.title }}</h3><p class="mt-2 font-light text-[#E6E7F8]">{{ c.body }}</p></li>
        </ul>
      </div>
    </section>

    <!-- Status -->
    <section id="status" class="mx-auto max-w-6xl scroll-mt-6 px-6 py-24 md:py-32">
      <p class="font-medium text-primary">{{ t('status.kicker') }}</p>
      <h2 class="mt-3 max-w-3xl text-4xl font-medium tracking-tight md:text-5xl">{{ t('status.title') }}</h2>
      <div class="mt-14 grid gap-6 md:grid-cols-2">
        <div class="rounded-2xl border border-border bg-card p-8">
          <h3 class="text-xl font-medium">{{ t('status.working.title') }}</h3>
          <ul class="mt-4 space-y-2.5 font-light text-muted-foreground"><li v-for="w in status.working" :key="w" class="flex gap-3"><span class="mt-2 size-2 shrink-0 rounded-full bg-success" />{{ w }}</li></ul>
        </div>
        <div class="rounded-2xl border border-border bg-card p-8">
          <h3 class="text-xl font-medium">{{ t('status.next.title') }}</h3>
          <ul class="mt-4 space-y-2.5 font-light text-muted-foreground"><li v-for="n in status.next" :key="n" class="flex gap-3"><span class="mt-2 size-2 shrink-0 rounded-full bg-[#8A8EE0]" />{{ n }}</li></ul>
        </div>
      </div>
      <p class="mt-6 max-w-3xl text-sm text-muted-foreground">{{ t('status.disclaimer') }}</p>
    </section>

    <!-- FAQ -->
    <section id="faq" class="mx-auto max-w-4xl scroll-mt-6 px-6 pb-24 md:pb-32">
      <p class="font-medium text-primary">{{ t('faq.kicker') }}</p>
      <h2 class="mt-3 text-4xl font-medium tracking-tight md:text-5xl">{{ t('faq.title') }}</h2>
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
        <h2 class="text-4xl font-medium tracking-tight text-balance md:text-6xl">{{ t('home.try.title') }}</h2>
        <p class="mx-auto mt-6 max-w-xl text-lg font-light text-[#E6E7F8] md:text-xl">{{ t('home.try.text') }}</p>
        <div class="mt-10 flex flex-wrap justify-center gap-3">
          <a :href="walletUrl" class="rounded-xl bg-white px-8 py-4 font-medium text-primary no-underline hover:bg-[#E6E7F8] hover:text-primary md:text-lg">{{ t('home.for.openWallet') }}</a>
          <a :href="dashboardUrl" class="rounded-xl border border-white/45 px-8 py-4 font-medium text-white no-underline hover:bg-white/10 hover:text-white md:text-lg">{{ t('home.for.openDashboard') }}</a>
        </div>
        <p v-if="!demoLive" class="mt-6 text-sm text-[#B3B6EE]">{{ t('home.try.soon') }}<template v-if="repoUrl">{{ t('home.try.repoBefore') }}<a :href="repoUrl" rel="noopener noreferrer" class="text-white underline">{{ t('home.try.repoLink') }}</a>{{ t('home.try.repoAfter') }}</template></p>
      </div>
    </section>

    <footer class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-10 text-sm text-muted-foreground">
      <SiteLogo />
      <p>{{ t('footer.tagline') }}</p>
      <nav class="flex gap-5" :aria-label="t('footer.nav')"><NuxtLink :to="localePath('/privacy')">{{ t('footer.privacy') }}</NuxtLink><a v-if="config.repoUrl" :href="config.repoUrl" rel="noopener noreferrer">{{ t('footer.source') }}</a></nav>
    </footer>
  </div>
</template>
