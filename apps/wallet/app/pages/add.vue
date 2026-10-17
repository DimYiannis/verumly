<script setup lang="ts">
import { Camera, FileUp } from '@lucide/vue';
import type { MessageKey } from '~/i18n';
import { ApiError } from '~/utils/api';
import { preparePhoto, type PrepareInfo, type PrepareProblem, type PrepareResult } from '~/utils/prepare-photo';
import { uploadFile, validateUploadFile, type UploadStartError } from '~/utils/uploads';

definePageMeta({ middleware: 'auth' });
const { t } = useLocale();
useHead({ title: () => t('add.pageTitle') });

const wallet = useWallet();
const busy = ref(false);
const error = ref<MessageKey | null>(null);
const uploading = ref(false);
const preparing = ref(false);
const prepError = ref<PrepareProblem | null>(null);
const preview = ref<{ url: string; info: PrepareInfo } | null>(null);

const START_ERROR = {
  unsupported_type: 'add.err.unsupported_type',
  too_large: 'add.err.too_large',
  empty: 'add.err.empty',
} as const satisfies Record<UploadStartError, MessageKey>;

const PREP_ERROR = {
  no_receipt: 'add.prep.problem.no_receipt',
  too_small: 'add.prep.problem.too_small',
  too_blurry: 'add.prep.problem.too_blurry',
  too_dark: 'add.prep.problem.too_dark',
  cut_off: 'add.prep.problem.cut_off',
  unreadable: 'add.prep.problem.unreadable',
} as const satisfies Record<PrepareProblem, MessageKey>;

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function clearPreview() {
  if (preview.value) URL.revokeObjectURL(preview.value.url);
  preview.value = null;
}
onBeforeUnmount(clearPreview);

async function onFile(event: Event) {
  const input = event.target;
  const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
  if (!file) return;
  error.value = null;
  prepError.value = null;
  clearPreview();
  const problem = validateUploadFile(file);
  if (problem) {
    error.value = START_ERROR[problem];
    return;
  }
  busy.value = true;
  try {
    // find the receipt, crop and shrink on the phone before any request; a photo that cannot be read stops here
    preparing.value = true;
    const prepared = await preparePhoto(file).catch((): PrepareResult => ({ ok: false, problems: ['unreadable'] }));
    preparing.value = false;
    if (!prepared.ok) {
      prepError.value = prepared.problems[0] ?? 'unreadable';
      return;
    }
    preview.value = { url: URL.createObjectURL(prepared.file), info: prepared.info };
    uploading.value = true;
    const uploadId = await uploadFile(wallet.api, prepared.file);
    await navigateTo(`/uploads/${uploadId}`);
  } catch (e) {
    if (e instanceof ApiError && e.isNetwork) error.value = 'add.err.offline';
    else if (e instanceof ApiError && e.status === 401) await wallet.endSession();
    else if (e instanceof ApiError && e.status === 429) error.value = 'add.err.limit';
    else if (e instanceof ApiError && e.code === 'unsupported_type') error.value = 'add.err.unsupported_type';
    else error.value = 'add.err.failed';
  } finally {
    busy.value = false;
    preparing.value = false;
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
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        class="sr-only"
        data-testid="file-input"
        :disabled="busy"
        @change="onFile"
      />
      <!-- `capture` forces the camera on phones, so choosing a saved photo needs a picker without it -->
      <Button as-child variant="secondary" size="lg" class="w-full cursor-pointer" :class="busy ? 'pointer-events-none opacity-50' : ''">
        <label for="receipt-file">
          <FileUp aria-hidden="true" />
          {{ t('add.file') }}
        </label>
      </Button>
      <input id="receipt-file" type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" data-testid="file-input-library" :disabled="busy" @change="onFile" />
    </div>

    <p class="text-sm text-text-secondary" data-testid="upload-formats">{{ t('add.formats') }}</p>

    <p v-if="preparing" role="status" aria-live="polite" data-testid="prep-status" class="text-sm text-text-secondary">{{ t('add.prep.preparing') }}</p>
    <p v-if="prepError" role="alert" data-testid="prep-error" :data-problem="prepError" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ t(PREP_ERROR[prepError]) }}</p>
    <figure v-if="preview" class="flex items-center gap-3 rounded-lg border border-border bg-card p-3" data-testid="prep-preview" :data-width="preview.info.width" :data-height="preview.info.height" :data-bytes="preview.info.bytes" :data-cropped="preview.info.cropped">
      <img :src="preview.url" :alt="t('add.prep.previewAlt')" class="max-h-32 w-auto max-w-24 rounded border border-border object-contain" />
      <figcaption class="text-sm text-text-secondary" data-testid="prep-info">{{ t('add.prep.info', { width: preview.info.width, height: preview.info.height, size: formatSize(preview.info.bytes) }) }}</figcaption>
    </figure>

    <p role="status" aria-live="polite" data-testid="upload-step" class="text-sm text-text-secondary">{{ uploading ? t('add.uploading') : '' }}</p>
    <p v-if="error" role="alert" data-testid="upload-error" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ t(error) }}</p>
  </div>
</template>
