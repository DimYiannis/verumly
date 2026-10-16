<script setup lang="ts">
import { ApiError } from '~/utils/api';
import { uploadFile, validateUploadFile, type UploadStartError } from '~/utils/uploads';

definePageMeta({ middleware: 'auth' });
useHead({ title: 'Bon toevoegen' });

const wallet = useWallet();
const busy = ref(false);
const error = ref<string | null>(null);
const step = ref('');

const START_ERROR: Record<UploadStartError, string> = {
  unsupported_type: 'Kies een foto (JPEG, PNG, WebP, HEIC) of een PDF.',
  too_large: 'Dit bestand is groter dan 10 MB.',
  empty: 'Dit bestand is leeg.',
};

async function onFile(event: Event) {
  const input = event.target;
  const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
  if (!file) return;
  error.value = null;
  const problem = validateUploadFile(file);
  if (problem) {
    error.value = START_ERROR[problem];
    return;
  }
  busy.value = true;
  step.value = 'Uploaden…';
  try {
    const uploadId = await uploadFile(wallet.api, file);
    await navigateTo(`/uploads/${uploadId}`);
  } catch (e) {
    if (e instanceof ApiError && e.isNetwork) error.value = 'Geen verbinding. Probeer het opnieuw als je online bent.';
    else if (e instanceof ApiError && e.status === 401) await wallet.endSession();
    else error.value = 'Uploaden is niet gelukt. Probeer het opnieuw.';
  } finally {
    busy.value = false;
    step.value = '';
    if (input instanceof HTMLInputElement) input.value = '';
  }
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-bold">Oude bon toevoegen</h1>
    <p>Maak een foto van een papieren kassabon of kies een PDF. We lezen de bon automatisch uit; jij controleert het resultaat.</p>

    <div class="card space-y-3">
      <label for="receipt-photo" class="btn btn-primary w-full cursor-pointer" :class="busy ? 'pointer-events-none opacity-50' : ''">Maak een foto</label>
      <input
        id="receipt-photo"
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        class="sr-only"
        data-testid="file-input"
        :disabled="busy"
        @change="onFile"
      />
      <!-- `capture` forces the camera on phones, so a PDF needs a picker without it -->
      <label for="receipt-file" class="btn btn-secondary w-full cursor-pointer" :class="busy ? 'pointer-events-none opacity-50' : ''">Kies een bestand (foto of PDF)</label>
      <input id="receipt-file" type="file" accept="image/*,application/pdf" class="sr-only" data-testid="file-input-library" :disabled="busy" @change="onFile" />
    </div>

    <p role="status" aria-live="polite" data-testid="upload-step">{{ step }}</p>
    <p v-if="error" role="alert" data-testid="upload-error" class="rounded-xl bg-red-50 p-3 text-red-900">{{ error }}</p>
  </div>
</template>
