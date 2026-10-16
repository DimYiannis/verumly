<script setup lang="ts">
import { ChevronLeft, Download } from '@lucide/vue';
import { ApiError } from '~/utils/api';
import type { ReceiptDetail } from '~/utils/api-schemas';

definePageMeta({ middleware: 'auth' });

const route = useRoute();
const wallet = useWallet();
const id = String(route.params.id);

const detail = shallowRef<ReceiptDetail | null>(null);
const status = ref<'loading' | 'ready' | 'notfound' | 'unavailable' | 'error'>('loading');
const fromCache = ref(false);
const pdfBusy = ref(false);
const pdfError = ref<string | null>(null);
const justSaved = route.query.saved === '1';

useHead({ title: 'Bon' });

async function load() {
  try {
    const fresh = await wallet.api.getReceipt(id);
    detail.value = fresh;
    fromCache.value = false;
    status.value = 'ready';
    await wallet.cache.putDetail(fresh);
  } catch (e) {
    const cached = await wallet.cache.getDetail(id);
    if (cached) {
      detail.value = cached;
      fromCache.value = true;
      status.value = 'ready';
    } else if (e instanceof ApiError && e.status === 404) status.value = 'notfound';
    else status.value = e instanceof ApiError && e.isNetwork ? 'unavailable' : 'error';
  }
}

async function downloadPdf() {
  pdfBusy.value = true;
  pdfError.value = null;
  try {
    const blob = await wallet.api.receiptPdf(id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bon-${id}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (e) {
    pdfError.value = e instanceof ApiError && e.isNetwork ? 'PDF downloaden kan alleen online.' : 'De PDF kon niet worden gemaakt.';
  } finally {
    pdfBusy.value = false;
  }
}

// a new version may have arrived while the app was in the background
function onVisible() {
  if (document.visibilityState === 'visible') void load();
}
onMounted(() => {
  void load();
  document.addEventListener('visibilitychange', onVisible);
});
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible));
</script>

<template>
  <div class="space-y-4">
    <NuxtLink to="/" class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary no-underline hover:text-brand-900">
      <ChevronLeft class="size-4" aria-hidden="true" />
      Alle bonnen
    </NuxtLink>
    <p v-if="status === 'loading'" role="status" class="flex items-center gap-2 text-sm text-text-secondary">
      <Spinner role="presentation" aria-hidden="true" />
      Bon laden…
    </p>
    <p v-else-if="status === 'notfound'" role="alert" data-testid="not-found" class="rounded-xl border border-border bg-card p-4">Deze bon staat niet in jouw portemonnee.</p>
    <p v-else-if="status === 'unavailable'" role="alert" data-testid="unavailable" class="rounded-xl border border-border bg-card p-4">Je bent offline en deze bon is nog niet op dit toestel bewaard.</p>
    <p v-else-if="status === 'error'" role="alert" class="rounded-xl border border-danger-border bg-danger-soft p-4 text-danger">Er ging iets mis bij het laden.</p>
    <template v-else-if="detail">
      <p v-if="justSaved" role="status" data-testid="saved-notice" class="rounded-xl border border-success-border bg-success-soft p-3 font-medium text-success">Bon opgeslagen in je portemonnee.</p>
      <p v-if="fromCache" role="status" data-testid="cached-notice" class="rounded-xl border border-warning-border bg-warning-soft p-3 text-sm text-warning">Offline: dit is de laatst opgeslagen versie.</p>
      <ReceiptView :detail="detail" />
      <div class="space-y-2">
        <Button type="button" variant="secondary" size="lg" class="w-full" data-testid="download-pdf" :disabled="pdfBusy" @click="downloadPdf">
          <Download aria-hidden="true" />
          {{ pdfBusy ? 'PDF maken…' : 'Download PDF' }}
        </Button>
        <p v-if="pdfError" role="alert" data-testid="pdf-error" class="text-sm text-danger">{{ pdfError }}</p>
      </div>
    </template>
  </div>
</template>
