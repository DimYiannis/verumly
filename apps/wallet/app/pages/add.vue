<script setup lang="ts">
import { Camera, FileUp } from '@lucide/vue';
import type { MessageKey } from '~/i18n';
import { ApiError } from '~/utils/api';
import { uploadFile, validateUploadFile, type UploadStartError } from '~/utils/uploads';

definePageMeta({ middleware: 'auth' });
const { t } = useLocale();
useHead({ title: () => t('add.pageTitle') });

const wallet = useWallet();
const busy = ref(false);
const error = ref<MessageKey | null>(null);
const uploading = ref(false);

const START_ERROR = {
  unsupported_type: 'add.err.unsupported_type',
  too_large: 'add.err.too_large',
  empty: 'add.err.empty',
} as const satisfies Record<UploadStartError, MessageKey>;

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
  uploading.value = true;
  try {
    const uploadId = await uploadFile(wallet.api, file);
    await navigateTo(`/uploads/${uploadId}`);
  } catch (e) {
    if (e instanceof ApiError && e.isNetwork) error.value = 'add.err.offline';
    else if (e instanceof ApiError && e.status === 401) await wallet.endSession();
    else error.value = 'add.err.failed';
  } finally {
    busy.value = false;
    uploading.value = false;
    if (input instanceof HTMLInputElement) input.value = '';
  }
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-h2 font-semibold">{{ t('add.title') }}</h1>
    <p class="text-text-secondary">{{ t('add.body') }}</p>

    <div class="space-y-3 rounded-xl border border-border bg-card p-4">
      <Button as-child size="lg" class="w-full cursor-pointer" :class="busy ? 'pointer-events-none opacity-50' : ''">
        <label for="receipt-photo">
          <Camera aria-hidden="true" />
          {{ t('add.camera') }}
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
          {{ t('add.file') }}
        </label>
      </Button>
      <input id="receipt-file" type="file" accept="image/*,application/pdf" class="sr-only" data-testid="file-input-library" :disabled="busy" @change="onFile" />
    </div>

    <p role="status" aria-live="polite" data-testid="upload-step" class="text-sm text-text-secondary">{{ uploading ? t('add.uploading') : '' }}</p>
    <p v-if="error" role="alert" data-testid="upload-error" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ t(error) }}</p>
  </div>
</template>
