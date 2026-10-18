<script setup lang="ts">
// The privacy page, rendered at `/privacy` (English) and `/nl/privacy` (Dutch); the texts come from app/i18n.
const { t, localePath } = useSiteLocale();

useSeoMeta({
  title: () => t('privacy.seo.title'),
  description: () => t('privacy.seo.description'),
});
useLocaleHead();

const steps = computed(() => [
  { n: '01', title: t('privacy.s1.title'), body: t('privacy.s1.body') },
  { n: '02', title: t('privacy.s2.title'), body: t('privacy.s2.body') },
  { n: '03', title: t('privacy.s3.title'), body: t('privacy.s3.body') },
  { n: '04', title: t('privacy.s4.title'), body: t('privacy.s4.body') },
]);

const roles = computed(() => [
  { name: 'merchant_api', does: t('privacy.roles.merchantApi.does'), cannot: t('privacy.roles.merchantApi.cannot') },
  { name: 'dashboard', does: t('privacy.roles.dashboard.does'), cannot: t('privacy.roles.dashboard.cannot') },
  { name: 'buyer_api', does: t('privacy.roles.buyerApi.does'), cannot: t('privacy.roles.buyerApi.cannot') },
  { name: 'worker', does: t('privacy.roles.worker.does'), cannot: t('privacy.roles.worker.cannot') },
]);
</script>

<template>
  <div class="bg-[#FDFCFA] p-3 md:p-4">
    <header class="mx-auto flex max-w-4xl items-center justify-between gap-4 px-3 py-6 md:py-8">
      <NuxtLink :to="localePath('/')" :aria-label="t('nav.home')" class="no-underline"><SiteLogo /></NuxtLink>
      <div class="flex items-center gap-4">
        <NuxtLink :to="localePath('/')" class="text-primary">{{ t('privacy.back') }}</NuxtLink>
        <LangSwitch />
      </div>
    </header>

    <main class="mx-auto max-w-4xl px-3 pb-24">
      <p class="font-medium text-primary">{{ t('privacy.kicker') }}</p>
      <h1 class="mt-3 text-4xl font-medium tracking-tight text-balance md:text-6xl">{{ t('privacy.title') }}</h1>
      <p class="mt-6 max-w-2xl text-lg leading-relaxed font-light text-muted-foreground">{{ t('privacy.intro') }}</p>

      <ol class="mt-14 space-y-5">
        <li v-for="s in steps" :key="s.n" class="grid grid-cols-[auto_1fr] gap-x-6 rounded-2xl border border-border bg-card p-6 md:p-8">
          <span class="text-4xl leading-none font-medium text-primary tabular-nums">{{ s.n }}</span>
          <div><h2 class="text-xl font-medium tracking-tight md:text-2xl">{{ s.title }}</h2><p class="mt-2 leading-relaxed font-light text-muted-foreground">{{ s.body }}</p></div>
        </li>
      </ol>

      <h2 class="mt-16 text-3xl font-medium tracking-tight">{{ t('privacy.roles.title') }}</h2>
      <p class="mt-3 max-w-2xl font-light text-muted-foreground">{{ t('privacy.roles.text') }}</p>
      <div class="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
        <div class="overflow-x-auto">
        <table class="w-full min-w-[34rem] text-left text-sm">
          <thead class="bg-muted text-xs tracking-wider text-muted-foreground"><tr><th class="px-5 py-3">{{ t('privacy.roles.colRole') }}</th><th class="px-5 py-3">{{ t('privacy.roles.colDoes') }}</th><th class="px-5 py-3">{{ t('privacy.roles.colCannot') }}</th></tr></thead>
          <tbody>
            <tr v-for="r in roles" :key="r.name" class="border-t border-border"><td class="px-5 py-3 font-mono">{{ r.name }}</td><td class="px-5 py-3">{{ r.does }}</td><td class="px-5 py-3 text-muted-foreground">{{ r.cannot }}</td></tr>
          </tbody>
        </table>
        </div>
      </div>

      <h2 class="mt-16 text-3xl font-medium tracking-tight">{{ t('privacy.friends.title') }}</h2>
      <p class="mt-3 max-w-2xl font-light text-muted-foreground">{{ t('privacy.friends.text') }}</p>

      <h2 class="mt-16 text-3xl font-medium tracking-tight">{{ t('privacy.data.title') }}</h2>
      <p class="mt-3 max-w-2xl font-light text-muted-foreground">{{ t('privacy.data.text') }}</p>

      <div class="mt-16 rounded-2xl border border-[#E6D29C] bg-[#F7EED6] p-6 text-[#7A5A10]">
        <h2 class="text-lg font-medium">{{ t('privacy.claim.title') }}</h2>
        <p class="mt-2 font-light">{{ t('privacy.claim.text') }}</p>
      </div>
    </main>
  </div>
</template>
