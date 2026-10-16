<script setup lang="ts">
import { ApiError } from '~/utils/api';
import type { Consents } from '~/utils/api-schemas';

const model = defineModel<Consents>({ required: true });
const wallet = useWallet();
const error = ref<string | null>(null);
const saved = ref('');

const ROWS: { key: keyof Consents; label: string; hint: string }[] = [
  { key: 'analytics', label: 'Inzichten', hint: 'Bereken uitgaven per maand, categorie en winkel uit je bonnen.' },
  { key: 'marketing', label: 'Aanbiedingen', hint: 'Winkels mogen je aanbiedingen laten zien. Standaard uit.' },
  { key: 'push', label: 'Meldingen', hint: 'Toestemming om meldingen te sturen als een bon wordt bijgewerkt.' },
];

async function toggle(key: keyof Consents, value: boolean) {
  error.value = null;
  saved.value = '';
  const previous = model.value[key];
  model.value = { ...model.value, [key]: value };
  try {
    model.value = (await wallet.api.putConsents({ [key]: value })).consents;
    saved.value = 'Opgeslagen.';
  } catch (e) {
    model.value = { ...model.value, [key]: previous };
    error.value = e instanceof ApiError && e.isNetwork ? 'Geen verbinding; de wijziging is niet opgeslagen.' : 'Opslaan is niet gelukt.';
  }
}
</script>

<template>
  <fieldset class="space-y-4 rounded-xl border border-border bg-card p-4" data-testid="consents">
    <legend class="px-1 text-h3 font-semibold">Toestemmingen</legend>
    <div v-for="row in ROWS" :key="row.key" class="flex items-start justify-between gap-4">
      <Label :for="`consent-${row.key}`" class="block min-h-11 flex-1 cursor-pointer py-1 text-base font-normal text-foreground">
        <span class="block font-medium">{{ row.label }}</span>
        <span class="mt-0.5 block text-sm text-text-secondary">{{ row.hint }}</span>
      </Label>
      <Switch
        :id="`consent-${row.key}`"
        class="mt-2"
        :model-value="model[row.key]"
        :data-testid="`consent-${row.key}`"
        @update:model-value="(v: boolean) => toggle(row.key, v)"
      />
    </div>
    <p role="status" data-testid="consent-status" class="text-sm text-text-secondary">{{ saved }}</p>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
  </fieldset>
</template>
