<script setup lang="ts">
import { Camera, FileUp } from '@lucide/vue';
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
    <h1 class="text-h2 font-semibold">Oude bon toevoegen</h1>
    <p class="text-text-secondary">Maak een foto van een papieren kassabon of kies een PDF. We lezen de bon automatisch uit; jij controleert het resultaat.</p>

    <div class="space-y-3 rounded-xl border border-border bg-card p-4">
      <Button as-child size="lg" class="w-full cursor-pointer" :class="busy ? 'pointer-events-none opacity-50' : ''">
        <label for="receipt-photo">
          <Camera aria-hidden="true" />
          Maak een foto
        </label>
      </Button>
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
      <Button as-child variant="secondary" size="lg" class="w-full cursor-pointer" :class="busy ? 'pointer-events-none opacity-50' : ''">
        <label for="receipt-file">
          <FileUp aria-hidden="true" />
          Kies een bestand (foto of PDF)
        </label>
      </Button>
      <input id="receipt-file" type="file" accept="image/*,application/pdf" class="sr-only" data-testid="file-input-library" :disabled="busy" @change="onFile" />
    </div>

    <p role="status" aria-live="polite" data-testid="upload-step" class="text-sm text-text-secondary">{{ step }}</p>
    <p v-if="error" role="alert" data-testid="upload-error" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ error }}</p>
  </div>
</template>
