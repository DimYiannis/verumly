<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { LanguagesIcon } from '@lucide/vue';
import { cn } from '@/lib/utils';

// Compact "EN | NL" segmented toggle (shadcn-style). Stacks vertically in a collapsed sidebar via the class prop.
const props = defineProps<{ class?: HTMLAttributes['class'] }>();
const { locale, setLocale, t } = useLocale();
const OPTIONS = [
  { value: 'en', short: 'EN', label: 'locale.en' },
  { value: 'nl', short: 'NL', label: 'locale.nl' },
] as const;
</script>

<template>
  <div role="group" :aria-label="t('locale.label')" data-testid="locale-switch" :class="cn('inline-flex items-center gap-1.5 text-muted-foreground', props.class)">
    <LanguagesIcon class="size-4 shrink-0 group-data-[collapsible=icon]:hidden" aria-hidden="true" />
    <div class="inline-flex items-center rounded-md bg-muted p-0.5 group-data-[collapsible=icon]:flex-col">
      <button
        v-for="o in OPTIONS"
        :key="o.value"
        type="button"
        :aria-pressed="locale === o.value"
        :title="t(o.label)"
        :data-testid="`locale-${o.value}`"
        :class="cn('rounded-[5px] px-2 py-0.5 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring', locale === o.value ? 'bg-card text-foreground shadow-xs' : 'hover:text-foreground')"
        @click="setLocale(o.value)"
      >
        {{ o.short }}
      </button>
    </div>
  </div>
</template>
