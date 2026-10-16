<script setup lang="ts">
import { LanguagesIcon } from '@lucide/vue';
import { LOCALES, type Locale } from '~/i18n';

const { locale, setLocale, t } = useLocale();

function nameOf(l: Locale) {
  return l === 'nl' ? t('locale.nl') : t('locale.en');
}
</script>

<template>
  <div role="group" data-testid="locale-switch" :aria-label="t('locale.label')" class="inline-flex items-center gap-1.5 text-muted-foreground">
    <LanguagesIcon class="size-4" aria-hidden="true" />
    <div class="inline-flex overflow-hidden rounded-md border border-border bg-card">
      <button
        v-for="l in LOCALES"
        :key="l"
        type="button"
        :lang="l"
        :aria-label="nameOf(l)"
        :aria-pressed="locale === l"
        :data-testid="`locale-${l}`"
        class="min-h-8 min-w-9 px-2 text-xs font-semibold uppercase transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        :class="locale === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
        @click="setLocale(l)"
      >
        {{ l }}
      </button>
    </div>
  </div>
</template>
