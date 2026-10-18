<script setup lang="ts">
import { Camera, ChevronRight, FileUp, Link2, ScanLine, X } from '@lucide/vue';
import type { MessageKey } from '~/i18n';
import { ApiError } from '~/utils/api';
import { preparePhoto, type PrepareInfo, type PrepareProblem, type PrepareResult } from '~/utils/prepare-photo';
import { parseReceiptLink } from '~/utils/receipt-link';
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
const linkText = ref('');
const linkError = ref(false);

async function openLink() {
  const parsed = parseReceiptLink(linkText.value.trim());
  linkError.value = parsed === null;
  if (!parsed) return;
  await navigateTo({ path: `/r/${parsed.receiptId}`, hash: `#${parsed.secret}` });
}

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

/** The messages sit below the chooser, often below the fold on a phone: bring the one that just appeared into view. */
async function revealProblem() {
  await nextTick();
  document.querySelector('[data-testid="prep-error"], [data-testid="upload-error"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

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
    await revealProblem();
    return;
  }
  busy.value = true;
  try {
    // a PDF is uploaded as it is (the worker reads its text, or its first page when it is a scan)
    if (file.type === 'application/pdf') {
      uploading.value = true;
      await navigateTo(`/uploads/${await uploadFile(wallet.api, file)}`);
      return;
    }
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
    if (error.value || prepError.value) await revealProblem();
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-h2 font-semibold">{{ t('home.add.title') }}</h1>
      <NuxtLink to="/" :aria-label="t('home.add.close')" class="flex size-11 items-center justify-center rounded-full text-foreground no-underline hover:bg-muted hover:text-foreground">
        <X class="size-5" aria-hidden="true" />
      </NuxtLink>
    </div>

    <section class="space-y-4 rounded-xl bg-brand-900 p-5 text-white" data-testid="add-scan">
      <div class="flex items-center gap-3">
        <span class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/15"><ScanLine class="size-6" aria-hidden="true" /></span>
        <div>
          <h2 class="text-h3 font-semibold">{{ t('home.add.scan.title') }}</h2>
          <p class="text-small text-[#B3B6EE]">{{ t('home.add.scan.body') }}</p>
        </div>
      </div>
      <div class="relative flex h-[120px] items-center justify-center rounded-xl border border-dashed border-white/40 bg-white/10" aria-hidden="true">
        <div class="size-20 rounded-lg border-2 border-white" />
      </div>
      <p class="text-small text-[#B3B6EE]">{{ t('home.add.scan.hint') }}</p>
      <InviteScan />
    </section>

    <ul class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      <li>
        <label for="receipt-photo" class="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3" :class="busy ? 'pointer-events-none opacity-50' : 'hover:bg-muted'">
          <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-selected text-primary"><Camera class="size-5" aria-hidden="true" /></span>
          <span class="min-w-0 flex-1">
            <span class="block font-medium">{{ t('home.add.photo.title') }}</span>
            <span class="block text-xs text-muted-foreground">{{ t('home.add.photo.body') }}</span>
          </span>
          <ChevronRight class="size-4 text-muted-foreground" aria-hidden="true" />
        </label>
        <input id="receipt-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" class="sr-only" data-testid="file-input" :disabled="busy" @change="onFile" />
      </li>
      <li>
        <!-- `capture` forces the camera on phones, so choosing a saved photo needs a picker without it -->
        <label for="receipt-file" class="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3" :class="busy ? 'pointer-events-none opacity-50' : 'hover:bg-muted'">
          <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-selected text-primary"><FileUp class="size-5" aria-hidden="true" /></span>
          <span class="min-w-0 flex-1">
            <span class="block font-medium">{{ t('home.add.file.title') }}</span>
            <span class="block text-xs text-muted-foreground">{{ t('home.add.file.body') }}</span>
          </span>
          <ChevronRight class="size-4 text-muted-foreground" aria-hidden="true" />
        </label>
        <input id="receipt-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" class="sr-only" data-testid="file-input-library" :disabled="busy" @change="onFile" />
      </li>
      <li class="space-y-2 px-4 py-3">
        <div class="flex items-center gap-3">
          <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-selected text-primary"><Link2 class="size-5" aria-hidden="true" /></span>
          <div class="min-w-0 flex-1">
            <Label for="receipt-link" class="block text-base font-medium">{{ t('home.add.link.title') }}</Label>
            <span class="block text-xs text-muted-foreground">{{ t('home.add.link.body') }}</span>
          </div>
        </div>
        <form class="flex gap-2" novalidate @submit.prevent="openLink">
          <Input id="receipt-link" v-model="linkText" class="h-11 min-w-0 flex-1" inputmode="url" autocomplete="off" :aria-label="t('home.add.link.field')" placeholder="https://" data-testid="receipt-link-input" />
          <Button type="submit" size="lg" data-testid="receipt-link-open">{{ t('home.add.link.open') }}</Button>
        </form>
        <p v-if="linkError" role="alert" class="text-sm text-danger" data-testid="receipt-link-error">{{ t('home.add.link.invalid') }}</p>
      </li>
    </ul>

    <p class="text-sm text-text-secondary" data-testid="upload-formats">{{ t('add.formats') }}</p>

    <p v-if="preparing" role="status" aria-live="polite" data-testid="prep-status" class="text-sm text-text-secondary">{{ t('add.prep.preparing') }}</p>
    <p v-if="prepError" role="alert" data-testid="prep-error" :data-problem="prepError" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ t(PREP_ERROR[prepError]) }}</p>
    <figure v-if="preview" class="flex items-center gap-3 rounded-lg border border-border bg-card p-3" data-testid="prep-preview" :data-width="preview.info.width" :data-height="preview.info.height" :data-bytes="preview.info.bytes" :data-cropped="preview.info.cropped">
      <img :src="preview.url" :alt="t('add.prep.previewAlt')" class="max-h-32 w-auto max-w-24 rounded border border-border object-contain" />
      <figcaption class="text-sm text-text-secondary" data-testid="prep-info">{{ t('add.prep.info', { width: preview.info.width, height: preview.info.height, size: formatSize(preview.info.bytes) }) }}</figcaption>
    </figure>

    <p role="status" aria-live="polite" data-testid="upload-step" class="text-sm text-text-secondary">{{ uploading ? t('add.uploading') : '' }}</p>
    <p v-if="error" role="alert" data-testid="upload-error" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ t(error) }}</p>

    <ArrivingSection />
  </div>
</template>
