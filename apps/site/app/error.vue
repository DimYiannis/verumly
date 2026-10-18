<script setup lang="ts">
const props = defineProps<{ error: { statusCode?: number } }>();
const notFound = computed(() => props.error?.statusCode === 404);

useSeoMeta({ title: () => (notFound.value ? 'Page not found: bonnen' : 'Something went wrong: bonnen') });

const goHome = () => clearError({ redirect: '/' });
</script>

<template>
  <div class="bg-[#FDFCFA] p-3 md:p-4">
    <header class="mx-auto flex max-w-4xl items-center justify-between px-3 py-6 md:py-8">
      <a href="/" aria-label="bonnen home" class="no-underline" @click.prevent="goHome"><SiteLogo /></a>
    </header>
    <main class="mx-auto flex min-h-[60svh] max-w-4xl flex-col items-start justify-center px-3 pb-24">
      <p class="font-medium text-primary">{{ notFound ? '404' : 'Error' }}</p>
      <h1 class="mt-3 text-4xl font-medium tracking-tight text-balance md:text-6xl">{{ notFound ? 'This page is not here.' : 'Something went wrong.' }}</h1>
      <p class="mt-6 max-w-xl text-lg leading-relaxed font-light text-muted-foreground">{{ notFound ? 'The link may be old or mistyped. The receipts are still safe: start again from the home page.' : 'Please try again from the home page.' }}</p>
      <a href="/" class="mt-10 inline-block rounded-xl bg-primary px-7 py-3.5 font-medium text-white no-underline hover:bg-[#1C1F6E] hover:text-white" @click.prevent="goHome">Back to the start</a>
    </main>
  </div>
</template>
