<script setup lang="ts">
// EN / NL links to the same page in the other language. `light` is for the dark hero header.
defineProps<{ light?: boolean }>();

const { locale, t } = useSiteLocale();
const alternates = useAlternatePaths();

const options = computed(() => [
  { code: 'en' as const, label: 'EN', name: 'English', href: alternates.value.en },
  { code: 'nl' as const, label: 'NL', name: 'Nederlands', href: alternates.value.nl },
]);
</script>

<template>
  <div class="inline-flex items-center gap-1 text-sm" role="group" :aria-label="t('nav.language')" data-testid="lang-switch">
    <NuxtLink
      v-for="o in options"
      :key="o.code"
      :to="o.href"
      :hreflang="o.code"
      :lang="o.code"
      :title="o.name"
      :aria-current="locale === o.code ? 'true' : undefined"
      class="rounded-lg px-2.5 py-1.5 font-medium no-underline"
      :class="
        locale === o.code
          ? light ? 'bg-white/20 text-white hover:text-white' : 'bg-muted text-foreground hover:text-foreground'
          : light ? 'text-white/75 hover:bg-white/10 hover:text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      "
    >{{ o.label }}</NuxtLink>
  </div>
</template>
