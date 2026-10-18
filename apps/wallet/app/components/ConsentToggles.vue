<script setup lang="ts">
import { ApiError } from '~/utils/api';
import type { MessageKey } from '~/i18n';
import type { Consents } from '~/utils/api-schemas';

const model = defineModel<Consents>({ required: true });
const wallet = useWallet();
const { t } = useLocale();
const error = ref<MessageKey | null>(null);
const saved = ref(false);

const ROWS: { key: keyof Consents; label: MessageKey; hint: MessageKey }[] = [
  { key: 'analytics', label: 'consent.analytics', hint: 'consent.analyticsHint' },
  { key: 'marketing', label: 'consent.marketing', hint: 'consent.marketingHint' },
  { key: 'push', label: 'consent.push', hint: 'consent.pushHint' },
];

async function toggle(key: keyof Consents, value: boolean) {
  error.value = null;
  saved.value = false;
  const previous = model.value[key];
  model.value = { ...model.value, [key]: value };
  try {
    model.value = (await wallet.api.putConsents({ [key]: value })).consents;
    saved.value = true;
  } catch (e) {
    model.value = { ...model.value, [key]: previous };
    error.value = e instanceof ApiError && e.isNetwork ? 'consent.err.offline' : 'consent.err.failed';
  }
}
</script>

<template>
  <!-- the legend sits above the box: inside a bordered fieldset it would be drawn on the border -->
  <fieldset class="min-w-0 space-y-2 border-0 p-0" data-testid="consents">
    <legend class="mb-2 p-0 text-h3 font-semibold">{{ t('consent.title') }}</legend>
    <div class="space-y-4 rounded-xl border border-border bg-card p-4">
      <div v-for="row in ROWS" :key="row.key" class="flex items-start justify-between gap-4">
        <Label :for="`consent-${row.key}`" class="block min-h-11 flex-1 cursor-pointer py-1 text-base font-normal text-foreground">
          <span class="block font-medium">{{ t(row.label) }}</span>
          <span class="mt-0.5 block text-sm text-text-secondary">{{ t(row.hint) }}</span>
        </Label>
        <Switch
          :id="`consent-${row.key}`"
          class="mt-2"
          :model-value="model[row.key]"
          :data-testid="`consent-${row.key}`"
          @update:model-value="(v: boolean) => toggle(row.key, v)"
        />
      </div>
      <p role="status" data-testid="consent-status" class="text-sm text-text-secondary">{{ saved ? t('consent.saved') : '' }}</p>
      <p v-if="error" role="alert" class="text-sm text-danger">{{ t(error) }}</p>
    </div>
  </fieldset>
</template>
