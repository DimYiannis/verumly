<script setup lang="ts">
import { Check, ChevronLeft, Copy } from '@lucide/vue';
import type { MessageKey } from '~/i18n';
import type { SplitDetail } from '~/utils/api-schemas';
import { ApiError } from '~/utils/api';
import { formatDateTime, formatEuro } from '~/utils/format';
import { copyText, errorKey, inviteLink, isOffline, userName } from '~/utils/social';

definePageMeta({ middleware: 'auth' });

const route = useRoute();
const wallet = useWallet();
const { t, locale } = useLocale();
const receiptHost = useRuntimeConfig().public.receiptHost;
const id = String(route.params.id);
useHead({ title: () => t('split.detail.title') });

const status = ref<'loading' | 'ready' | 'offline' | 'notfound' | 'error'>('loading');
const split = shallowRef<SplitDetail | null>(null);
const error = ref<MessageKey | null>(null);
const showReceipt = ref(false);
const confirmDelete = ref(false);
const busyShare = ref<string | null>(null);
const copiedId = ref<string | null>(null);

async function load() {
  status.value = 'loading';
  try {
    split.value = await wallet.api.getSplit(id);
    status.value = 'ready';
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) status.value = 'notfound';
    else status.value = isOffline(e) ? 'offline' : 'error';
  }
}
onMounted(load);

const owed = computed(() => (split.value?.shares ?? []).filter((s) => !s.settled).reduce((a, s) => a + s.amountMinor, 0));
const detailForView = computed(() => (split.value ? { receipt: split.value.receipt, final: true, versions: [], template: split.value.template } : null));

function shareName(s: SplitDetail['shares'][number]): string {
  if (s.isMe) return t('split.you');
  if (s.who) return userName(s.who);
  return s.guestName ?? '?';
}

/** Only the creator can mark a guest slot; the creator and the person themselves can mark a user's share. The API has the final say. */
function canToggle(s: SplitDetail['shares'][number]): boolean {
  if (!split.value) return false;
  // the creator paid the bill: their own share has nothing to settle; they settle everyone else's, a guest settles their own
  if (s.isMe && split.value.creatorIsMe) return false;
  return split.value.creatorIsMe || s.isMe;
}

async function toggle(s: SplitDetail['shares'][number]) {
  if (!split.value) return;
  busyShare.value = s.id;
  error.value = null;
  try {
    split.value = await wallet.api.settleShare(split.value.id, s.id, !s.settled);
  } catch (e) {
    error.value = errorKey(e);
  } finally {
    busyShare.value = null;
  }
}

/** Guest slots: the server keeps only a hash of the invite, so a link is created on demand (the earlier one stops working). */
async function copyInvite(shareId: string, code: string | null) {
  error.value = null;
  try {
    const link = code ?? (split.value ? (await wallet.api.createGuestInvite(split.value.id, shareId)).code : null);
    if (link && (await copyText(inviteLink(receiptHost, link)))) {
      copiedId.value = shareId;
      setTimeout(() => (copiedId.value = null), 2500);
    }
  } catch (e) {
    error.value = errorKey(e);
  }
}

async function remove() {
  error.value = null;
  try {
    await wallet.api.deleteSplit(id);
    await navigateTo('/friends');
  } catch (e) {
    error.value = errorKey(e);
  }
}
</script>

<template>
  <div class="space-y-4">
    <NuxtLink to="/friends" class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary no-underline hover:text-brand-900">
      <ChevronLeft class="size-4" aria-hidden="true" />
      {{ t('social.title') }}
    </NuxtLink>
    <p v-if="status === 'loading'" role="status" class="flex items-center gap-2 text-sm text-text-secondary">
      <Spinner role="presentation" aria-hidden="true" />
      {{ t('common.loading') }}
    </p>
    <p v-else-if="status === 'notfound'" role="alert" data-testid="not-found" class="rounded-xl border border-border bg-card p-4">{{ t('split.detail.notFound') }}</p>
    <div v-else-if="status !== 'ready' || !split" role="alert" data-testid="social-offline" class="space-y-3 rounded-xl border border-border bg-card p-4">
      <p>{{ t(status === 'offline' ? 'social.offline' : 'social.err.generic') }}</p>
      <Button type="button" variant="secondary" size="lg" @click="load">{{ t('common.retry') }}</Button>
    </div>
    <template v-else>
      <section class="space-y-1 rounded-xl border border-border bg-card p-4">
        <h1 class="text-h2 font-semibold">{{ split.receipt.merchant.name }}</h1>
        <p class="text-sm text-text-secondary">
          {{ t('split.detail.by', { name: split.creatorIsMe ? t('split.you') : userName(split.creator), date: formatDateTime(split.createdAt, locale) }) }}
        </p>
        <div class="flex items-baseline justify-between pt-2">
          <span class="text-sm text-text-secondary">{{ t('split.detail.total') }}</span>
          <span class="font-mono text-lg font-medium tabular-nums">{{ formatEuro(split.totalMinor, locale) }}</span>
        </div>
        <div class="flex items-baseline justify-between">
          <span class="text-sm text-text-secondary">{{ t('split.detail.open') }}</span>
          <span class="font-mono tabular-nums" data-testid="split-open-amount">{{ formatEuro(owed, locale) }}</span>
        </div>
      </section>

      <p v-if="error" role="alert" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ t(error) }}</p>

      <section class="space-y-2">
        <h2 class="text-h2 font-semibold">{{ t('split.detail.shares') }}</h2>
        <ul class="divide-y divide-border rounded-xl border border-border bg-card">
          <li v-for="s in split.shares" :key="s.id" class="space-y-2 p-3" data-testid="split-share">
            <div class="flex items-center gap-3">
              <UserAvatar :user="s.who" :name="shareName(s)" size="sm" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ shareName(s) }}</p>
                <p v-if="s.guestName" class="text-xs text-text-secondary">{{ t('split.guestTag') }}</p>
              </div>
              <div class="text-right">
                <p class="font-mono text-sm tabular-nums" :class="s.settled ? 'text-text-secondary line-through' : ''">{{ formatEuro(s.amountMinor, locale) }}</p>
                <Badge :variant="s.settled ? 'success' : 'warning'">{{ s.settled ? t('split.detail.settled') : t('split.detail.unsettled') }}</Badge>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button
                v-if="canToggle(s)"
                type="button"
                :variant="s.settled ? 'secondary' : 'default'"
                size="lg"
                data-testid="split-share-settle"
                :disabled="busyShare === s.id"
                @click="toggle(s)"
              >
                {{ s.settled ? t('split.detail.undo') : t('split.detail.settle') }}
              </Button>
              <Button v-if="split.creatorIsMe && s.who === null && !s.settled" type="button" variant="secondary" size="lg" data-testid="split-guest-invite" @click="copyInvite(s.id, s.inviteCode)">
                <component :is="copiedId === s.id ? Check : Copy" aria-hidden="true" />
                {{ copiedId === s.id ? t('social.copied') : t('split.detail.copyInvite') }}
              </Button>
            </div>
            <p v-if="split.creatorIsMe && s.who === null && !s.settled" class="text-xs text-text-secondary">{{ t('split.detail.inviteHint', { name: shareName(s) }) }}</p>
          </li>
        </ul>
      </section>

      <section class="space-y-2">
        <Button type="button" variant="secondary" size="lg" class="w-full" data-testid="split-receipt-toggle" :aria-expanded="showReceipt" @click="showReceipt = !showReceipt">
          {{ showReceipt ? t('split.detail.hideReceipt') : t('split.detail.showReceipt') }}
        </Button>
        <ReceiptView v-if="showReceipt && detailForView" :detail="detailForView" />
      </section>

      <section v-if="split.creatorIsMe" class="space-y-2">
        <Button v-if="!confirmDelete" type="button" variant="ghost" size="lg" class="w-full" data-testid="split-delete" @click="confirmDelete = true">{{ t('split.detail.delete') }}</Button>
        <div v-else class="space-y-2 rounded-xl border border-danger-border bg-danger-soft p-4" role="alert">
          <p class="text-sm text-danger">{{ t('split.detail.deleteConfirm') }}</p>
          <div class="flex gap-2">
            <Button type="button" variant="destructive" size="lg" data-testid="split-delete-confirm" @click="remove">{{ t('split.detail.deleteYes') }}</Button>
            <Button type="button" variant="secondary" size="lg" @click="confirmDelete = false">{{ t('social.cancel') }}</Button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
