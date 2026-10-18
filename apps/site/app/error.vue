<script setup lang="ts">
const props = defineProps<{ error: { statusCode?: number } }>();
const notFound = computed(() => props.error?.statusCode === 404);
const { locale, t, localePath } = useSiteLocale();

useSeoMeta({ title: () => (notFound.value ? t('error.notFoundTitle') : t('error.otherTitle')) });
useHead({ htmlAttrs: { lang: () => locale.value } });

const goHome = () => clearError({ redirect: localePath('/') });
</script>

<template>
  <div class="bg-[#FDFCFA] p-3 md:p-4">
    <header class="mx-auto flex max-w-4xl items-center justify-between px-3 py-6 md:py-8">
      <a :href="localePath('/')" :aria-label="t('nav.home')" class="no-underline" @click.prevent="goHome"><SiteLogo /></a>
    </header>
    <main class="mx-auto flex min-h-[60svh] max-w-4xl flex-col items-start justify-center px-3 pb-24">
      <p class="font-medium text-primary">{{ notFound ? t('error.notFoundKicker') : t('error.otherKicker') }}</p>
      <h1 class="mt-3 text-4xl font-medium tracking-tight text-balance md:text-6xl">{{ notFound ? t('error.notFoundHeading') : t('error.otherHeading') }}</h1>
      <p class="mt-6 max-w-xl text-lg leading-relaxed font-light text-muted-foreground">{{ notFound ? t('error.notFoundText') : t('error.otherText') }}</p>
      <a :href="localePath('/')" class="mt-10 inline-block rounded-xl bg-primary px-7 py-3.5 font-medium text-white no-underline hover:bg-[#1C1F6E] hover:text-white" @click.prevent="goHome">{{ t('error.back') }}</a>
    </main>
  </div>
</template>
