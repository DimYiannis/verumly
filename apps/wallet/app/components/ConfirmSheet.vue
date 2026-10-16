<script setup lang="ts">
import { formatDateTime, formatEuro } from '~/utils/format';

defineProps<{ merchant: string; total: number; time: string; busy: boolean; error: string | null }>();
const emit = defineEmits<{ save: []; reject: [] }>();
const saveButton = useTemplateRef<HTMLButtonElement>('saveButton');
onMounted(() => saveButton.value?.focus());
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-end bg-slate-900/50" data-testid="confirm-sheet-backdrop">
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheet-title"
      data-testid="confirm-sheet"
      class="mx-auto w-full max-w-xl rounded-t-3xl bg-white p-6 shadow-2xl"
      style="padding-bottom: calc(1.5rem + env(safe-area-inset-bottom))"
    >
      <h2 id="sheet-title" class="text-2xl font-bold">Save this receipt?</h2>
      <dl class="my-4 space-y-1">
        <div class="flex justify-between">
          <dt class="text-slate-700">Shop</dt>
          <dd class="font-semibold" data-testid="sheet-merchant">{{ merchant }}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-slate-700">Total</dt>
          <dd class="font-semibold tabular-nums" data-testid="sheet-total">{{ formatEuro(total) }}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-slate-700">Time</dt>
          <dd class="font-semibold" data-testid="sheet-time">{{ formatDateTime(time) }}</dd>
        </div>
      </dl>
      <p v-if="error" role="alert" data-testid="sheet-error" class="mb-3 rounded-lg bg-red-50 p-3 text-red-900">{{ error }}</p>
      <div class="flex flex-col gap-3">
        <button ref="saveButton" type="button" class="btn btn-primary" data-testid="save-button" :disabled="busy" @click="emit('save')">
          {{ busy ? 'Working…' : 'Save to wallet' }}
        </button>
        <button type="button" class="btn btn-secondary" data-testid="not-mine-button" :disabled="busy" @click="emit('reject')">Not mine</button>
      </div>
    </section>
  </div>
</template>
