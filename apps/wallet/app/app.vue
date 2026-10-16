<script setup lang="ts">
const { locale } = useLocale();
useHead({ htmlAttrs: { lang: () => locale.value } });
</script>

<template>
  <NuxtPwaManifest />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
