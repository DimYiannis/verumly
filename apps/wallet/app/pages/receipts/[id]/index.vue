<script setup lang="ts">
import { ChevronLeft, Download, SquareSplitHorizontal, UserPlus } from '@lucide/vue';
import { buttonVariants } from '~/components/ui/button';
import type { MessageKey } from '~/i18n';
import { ApiError } from '~/utils/api';
import type { ReceiptDetail } from '~/utils/api-schemas';

definePageMeta({ middleware: 'auth' });

const route = useRoute();
const wallet = useWallet();
const { t } = useLocale();
const id = String(route.params.id);

const detail = shallowRef<ReceiptDetail | null>(null);
const status = ref<'loading' | 'ready' | 'notfound' | 'unavailable' | 'error'>('loading');
const fromCache = ref(false);
const pdfBusy = ref(false);
const pdfError = ref<MessageKey | null>(null);
const shareOpen = ref(false);
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
      <ReceiptView :detail="detail" />
      <div v-if="!fromCache && detail.receipt.state !== 'void'" class="grid grid-cols-2 gap-2">
        <NuxtLink :to="`/receipts/${id}/split`" data-testid="receipt-split" :class="buttonVariants({ size: 'lg' })" class="no-underline hover:text-primary-foreground">
          <SquareSplitHorizontal aria-hidden="true" />
          {{ t('social.receipt.split') }}
        </NuxtLink>
        <Button type="button" variant="secondary" size="lg" data-testid="receipt-share" @click="shareOpen = true">
          <UserPlus aria-hidden="true" />
          {{ t('social.receipt.share') }}
        </Button>
      </div>
      <ShareWithFriendSheet v-model:open="shareOpen" :receipt-id="detail.receipt.receiptId" />
      <div class="space-y-2">
        <Button type="button" variant="secondary" size="lg" class="w-full" data-testid="download-pdf" :disabled="pdfBusy" @click="downloadPdf">
          <Download aria-hidden="true" />
          {{ pdfBusy ? t('receiptPage.pdfBusy') : t('receiptPage.pdf') }}
        </Button>
        <p v-if="pdfError" role="alert" data-testid="pdf-error" class="text-sm text-danger">{{ t(pdfError) }}</p>
      </div>
    </template>
  </div>
</template>
