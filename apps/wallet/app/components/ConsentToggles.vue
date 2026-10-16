<script setup lang="ts">
import { ApiError } from '~/utils/api';
import type { Consents } from '~/utils/api-schemas';

const model = defineModel<Consents>({ required: true });
const wallet = useWallet();
const error = ref<string | null>(null);
const saved = ref('');

const ROWS: { key: keyof Consents; label: string; hint: string }[] = [
  { key: 'analytics', label: 'Insights', hint: 'Calculate spending per month, category and shop from your receipts.' },
  { key: 'marketing', label: 'Offers', hint: 'Shops may show you offers. Off by default.' },
  { key: 'push', label: 'Notifications', hint: 'Permission to send notifications when a receipt is updated.' },
];

function onChange(key: keyof Consents, event: Event) {
  if (event.target instanceof HTMLInputElement) void toggle(key, event.target.checked);
}

async function toggle(key: keyof Consents, value: boolean) {
  error.value = null;
  saved.value = '';
  const previous = model.value[key];
  model.value = { ...model.value, [key]: value };
  try {
    model.value = (await wallet.api.putConsents({ [key]: value })).consents;
    saved.value = 'Saved.';
  } catch (e) {
    model.value = { ...model.value, [key]: previous };
    error.value = e instanceof ApiError && e.isNetwork ? 'No connection; the change was not saved.' : 'Saving failed.';
  }
}
</script>

<template>
  <fieldset class="card space-y-3" data-testid="consents">
    <legend class="px-1 font-semibold">Permissions</legend>
    <div v-for="row in ROWS" :key="row.key" class="flex items-start gap-3">
      <input
        :id="`consent-${row.key}`"
        type="checkbox"
        role="switch"
        class="mt-1 size-6 shrink-0 accent-brand-700"
        :checked="model[row.key]"
        :data-testid="`consent-${row.key}`"
        @change="onChange(row.key, $event)"
      />
      <label :for="`consent-${row.key}`">
        <span class="block font-medium">{{ row.label }}</span>
        <span class="block text-sm text-slate-800">{{ row.hint }}</span>
      </label>
    </div>
    <p role="status" data-testid="consent-status" class="text-sm text-slate-800">{{ saved }}</p>
    <p v-if="error" role="alert" class="text-red-800">{{ error }}</p>
  </fieldset>
</template>
