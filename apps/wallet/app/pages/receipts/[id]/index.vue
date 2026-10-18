<script setup lang="ts">
import { ChevronDown, ChevronLeft, Download, ReceiptText } from '@lucide/vue';
import type { MessageKey } from '~/i18n';
import { ApiError } from '~/utils/api';
import type { ReceiptDetail } from '~/utils/api-schemas';
import { RECEIPT_REFRESH_MS, isNewerVersion, shouldPollReceipt } from '~/utils/receipt-refresh';

definePageMeta({ middleware: 'auth' });

const route = useRoute();
const router = useRouter();
const wallet = useWallet();
const { t } = useLocale();
const id = String(route.params.id);

const detail = shallowRef<ReceiptDetail | null>(null);
const status = ref<'loading' | 'ready' | 'notfound' | 'unavailable' | 'error'>('loading');
const fromCache = ref(false);
const pdfBusy = ref(false);
const pdfError = ref<MessageKey | null>(null);
const paperOpen = ref(true);
const justSaved = route.query.saved === '1';

useHead({ title: () => t('viewer.pageTitle') });

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
    pdfError.value = e instanceof ApiError && e.isNetwork ? 'receiptPage.err.offline' : 'receiptPage.err.failed';
  } finally {
    pdfBusy.value = false;
  }
}

let refreshing = false;
/** Quietly picks up a newer version (a void) while the page is open; a failed request keeps what is on screen. */
async function refresh() {
  if (status.value !== 'ready') return load();
  if (refreshing) return;
  refreshing = true;
  try {
    const fresh = await wallet.api.getReceipt(id);
    fromCache.value = false;
    if (isNewerVersion(detail.value, fresh)) {
      detail.value = fresh;
      await wallet.cache.putDetail(fresh);
    }
  } catch {
    /* offline or a hiccup: the next tick, or the online event, tries again */
  } finally {
    refreshing = false;
  }
}

const canPoll = () => shouldPollReceipt({ visible: document.visibilityState === 'visible', online: wallet.online.value });
// a new version may have arrived while the app was in the background, or the network just came back
function onWake() {
  if (canPoll()) void refresh();
}
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void load();
  // the "Receipt saved" banner shows once: a reload must not bring it back
  if (justSaved) void router.replace({ path: route.path, query: { ...route.query, saved: undefined }, hash: route.hash });
  timer = setInterval(onWake, RECEIPT_REFRESH_MS);
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('online', onWake);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  document.removeEventListener('visibilitychange', onWake);
  window.removeEventListener('online', onWake);
});
</script>

<template>
  <div class="space-y-4">
    <NuxtLink to="/receipts" class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary no-underline hover:text-brand-900">
      <ChevronLeft class="size-4" aria-hidden="true" />
      {{ t('common.allReceipts') }}
    </NuxtLink>
    <p v-if="status === 'loading'" role="status" class="flex items-center gap-2 text-sm text-text-secondary">
      <Spinner role="presentation" aria-hidden="true" />
      {{ t('receiptPage.loading') }}
    </p>
    <p v-else-if="status === 'notfound'" role="alert" data-testid="not-found" class="rounded-xl border border-border bg-card p-4">{{ t('receiptPage.notFound') }}</p>
    <p v-else-if="status === 'unavailable'" role="alert" data-testid="unavailable" class="rounded-xl border border-border bg-card p-4">{{ t('receiptPage.unavailable') }}</p>
    <p v-else-if="status === 'error'" role="alert" class="rounded-xl border border-danger-border bg-danger-soft p-4 text-danger">{{ t('receiptPage.error') }}</p>
    <template v-else-if="detail">
      <p v-if="justSaved" role="status" data-testid="saved-notice" class="rounded-xl border border-success-border bg-success-soft p-3 font-medium text-success">{{ t('receiptPage.saved') }}</p>
      <p v-if="fromCache" role="status" data-testid="cached-notice" class="rounded-xl border border-warning-border bg-warning-soft p-3 text-sm text-warning">{{ t('receiptPage.cached') }}</p>

      <ReceiptHero :detail="detail" :offline="fromCache" />

      <!-- the paper receipt stays on the page, open by default -->
      <section class="space-y-3" data-testid="paper-section">
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-[14px] border border-border bg-card p-3.5 text-left"
          :aria-expanded="paperOpen"
          aria-controls="paper-receipt"
          data-testid="paper-toggle"
          @click="paperOpen = !paperOpen"
        >
          <span class="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-border bg-muted text-text-secondary"><ReceiptText class="size-5" aria-hidden="true" /></span>
          <span class="min-w-0 flex-1">
            <span class="block text-[15px] font-medium">{{ t('rcpt.detail.paper') }}</span>
            <span class="block text-xs text-text-secondary">{{ t('rcpt.detail.paperHint') }}</span>
          </span>
          <ChevronDown class="size-5 shrink-0 text-text-secondary transition-transform" :class="paperOpen ? 'rotate-180' : ''" aria-hidden="true" />
        </button>
        <div v-show="paperOpen" id="paper-receipt" class="space-y-4">
          <ReceiptView :detail="detail" />
          <div class="space-y-2">
            <Button type="button" variant="secondary" size="lg" class="w-full" data-testid="download-pdf" :disabled="pdfBusy" @click="downloadPdf">
              <Download aria-hidden="true" />
              {{ pdfBusy ? t('receiptPage.pdfBusy') : t('receiptPage.pdf') }}
            </Button>
            <p v-if="pdfError" role="alert" data-testid="pdf-error" class="text-sm text-danger">{{ t(pdfError) }}</p>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
