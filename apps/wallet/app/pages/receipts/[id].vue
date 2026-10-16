<script setup lang="ts">
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
    <NuxtLink to="/" class="inline-block py-2 font-medium text-brand-700 underline">← Alle bonnen</NuxtLink>
    <p v-if="status === 'loading'" role="status">Bon laden…</p>
    <p v-else-if="status === 'notfound'" role="alert" data-testid="not-found" class="card">Deze bon staat niet in jouw portemonnee.</p>
    <p v-else-if="status === 'unavailable'" role="alert" data-testid="unavailable" class="card">Je bent offline en deze bon is nog niet op dit toestel bewaard.</p>
    <p v-else-if="status === 'error'" role="alert" class="card">Er ging iets mis bij het laden.</p>
    <template v-else-if="detail">
      <p v-if="justSaved" role="status" data-testid="saved-notice" class="rounded-xl bg-brand-100 p-3 font-semibold text-brand-900">Bon opgeslagen in je portemonnee.</p>
      <p v-if="fromCache" role="status" data-testid="cached-notice" class="rounded-xl bg-amber-100 p-3 text-amber-950">Offline: dit is de laatst opgeslagen versie.</p>
      <ReceiptView :detail="detail" />
      <div class="space-y-2">
        <button type="button" class="btn btn-secondary w-full" data-testid="download-pdf" :disabled="pdfBusy" @click="downloadPdf">
          {{ pdfBusy ? 'PDF maken…' : 'Download PDF' }}
        </button>
        <p v-if="pdfError" role="alert" data-testid="pdf-error" class="text-red-800">{{ pdfError }}</p>
      </div>
    </template>
  </div>
</template>
