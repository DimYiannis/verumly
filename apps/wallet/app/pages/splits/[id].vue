<script setup lang="ts">
import { ChevronLeft, Link2 } from '@lucide/vue';
import { buttonVariants } from '~/components/ui/button';
import { formatRelative } from '~/utils/relative-time';
import type { MessageKey } from '~/i18n';
import type { SplitDetail } from '~/utils/api-schemas';
import { ApiError } from '~/utils/api';
import { formatDateTime, formatMoney } from '~/utils/format';
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

const paidPercent = computed(() => (split.value && split.value.totalMinor > 0 ? Math.round(((split.value.totalMinor - owed.value) / split.value.totalMinor) * 100) : 0));

function shareNote(s: SplitDetail['shares'][number]): string {
  if (s.isMe && split.value?.creatorIsMe) return t('rcpt.sd.paidBill');
  if (s.settled) return s.settledAt ? t('rcpt.sd.settledWhen', { when: formatRelative(s.settledAt, locale.value) }) : '';
  if (s.who === null) return t('rcpt.sd.guestWaiting');
  return '';
}

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

/**
 * Guest slots: the server keeps only a hash of the invite, so the plain code exists only when it is created. One
 * link per guest share: it is kept in sessionStorage and reused while the tab lives; only when it is gone (new
 * session) does the next press create a new one (the earlier one then stops working).
 */
const guestLinks = ref<Record<string, string>>({});
const inviteFeedback = ref<Record<string, 'copied' | 'failed'>>({});
const inviteKey = (shareId: string) => `lr-invite-${shareId}`;
watch(split, (value) => {
  for (const s of value?.shares ?? []) {
    const stored = sessionStorage.getItem(inviteKey(s.id));
    if (stored && !guestLinks.value[s.id]) guestLinks.value = { ...guestLinks.value, [s.id]: stored };
  }
});
async function copyInvite(shareId: string, code: string | null) {
  error.value = null;
  try {
    let link = guestLinks.value[shareId];
    if (!link) {
      const made = code ?? (split.value ? (await wallet.api.createGuestInvite(split.value.id, shareId)).code : null);
      if (!made) return;
      link = inviteLink(receiptHost, made);
      sessionStorage.setItem(inviteKey(shareId), link);
      guestLinks.value = { ...guestLinks.value, [shareId]: link };
    }
    inviteFeedback.value = { ...inviteFeedback.value, [shareId]: (await copyText(link)) ? 'copied' : 'failed' };
    setTimeout(() => {
      const { [shareId]: _gone, ...rest } = inviteFeedback.value;
      inviteFeedback.value = rest;
    }, 4000);
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
    <div class="flex items-center justify-between">
      <NuxtLink to="/friends" class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary no-underline hover:text-brand-900">
        <ChevronLeft class="size-5" aria-hidden="true" />
        {{ t('social.title') }}
      </NuxtLink>
      <span class="text-[13px] text-text-secondary">{{ t('split.detail.title') }}</span>
      <span class="min-w-11" aria-hidden="true" />
    </div>
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
      <section class="flex flex-col items-center gap-1 text-center">
        <h1 class="text-h2 font-semibold">{{ split.receipt.merchant.name }}</h1>
        <p class="text-[13px] text-text-secondary">
          {{ t('split.detail.by', { name: split.creatorIsMe ? t('split.you') : userName(split.creator), date: formatDateTime(split.createdAt, locale) }) }}
        </p>
        <p class="sr-only">{{ t('split.detail.total') }} {{ formatMoney(split.totalMinor, locale, split.currency) }}</p>
      </section>

      <section class="space-y-3 rounded-[14px] border border-border bg-card p-4" :aria-label="t('split.detail.open')">
        <div class="flex items-center justify-between gap-3">
          <p class="text-xs font-medium tracking-wide text-text-secondary uppercase">
            <span class="font-mono tabular-nums" data-testid="split-open-amount">{{ formatMoney(owed, locale, split.currency) }}</span>
            {{ t('rcpt.sd.openOfTotal', { total: formatMoney(split.totalMinor, locale, split.currency) }) }}
          </p>
          <span class="font-mono text-[13px] tabular-nums">{{ paidPercent }}%</span>
        </div>
        <div class="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" :aria-valuenow="paidPercent" aria-valuemin="0" aria-valuemax="100">
          <i class="block h-full rounded-full bg-primary" :style="{ width: `${paidPercent}%` }" />
        </div>
      </section>

      <p v-if="error" role="alert" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ t(error) }}</p>

      <section class="space-y-2" :aria-label="t('split.detail.shares')">
        <ul class="overflow-hidden rounded-[14px] border border-border bg-card">
          <li v-for="s in split.shares" :key="s.id" class="space-y-2 border-b border-border px-4 py-3 last:border-b-0" data-testid="split-share">
            <div class="flex items-center gap-3">
              <PersonAvatar :user="s.who" :name="shareName(s)" :me="s.isMe" :guest="!s.who && !s.isMe" />
              <div class="min-w-0 flex-1">
                <p class="flex items-center gap-1.5 truncate text-[15px] font-medium">
                  {{ shareName(s) }}
                  <Badge v-if="s.guestName" variant="neutral">{{ t('split.guestTag') }}</Badge>
                </p>
                <p class="text-xs text-text-secondary">{{ shareNote(s) }}</p>
              </div>
              <div class="flex flex-col items-end gap-1">
                <p class="font-mono text-[15px] tabular-nums" :class="s.settled ? 'text-text-secondary line-through' : ''">{{ formatMoney(s.amountMinor, locale, split.currency) }}</p>
                <Badge :variant="s.settled ? 'success' : 'warning'">{{ s.settled ? t('split.detail.settled') : t('split.detail.unsettled') }}</Badge>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button
                v-if="canToggle(s)"
                type="button"
                :variant="s.settled ? 'secondary' : 'default'"
                size="sm"
                data-testid="split-share-settle"
                :disabled="busyShare === s.id"
                @click="toggle(s)"
              >
                {{ s.settled ? t('split.detail.undo') : t('split.detail.settle') }}
              </Button>
              <Button v-if="split.creatorIsMe && s.who === null && !s.settled" type="button" variant="secondary" size="sm" data-testid="split-guest-invite" @click="copyInvite(s.id, s.inviteCode)">
                <Link2 aria-hidden="true" />
                {{ inviteFeedback[s.id] === 'copied' ? t('social.copied') : t('split.detail.copyInvite') }}
              </Button>
            </div>
            <p v-if="inviteFeedback[s.id] === 'failed'" role="alert" class="text-sm text-danger" data-testid="split-invite-copy-failed">{{ t('split.detail.copyFailed') }}</p>
            <p v-else-if="inviteFeedback[s.id] === 'copied'" role="status" class="text-sm text-success">{{ t('split.detail.copied') }}</p>
            <InviteShare v-if="guestLinks[s.id]" :link="guestLinks[s.id]!" class="pt-2" />
            <p v-if="split.creatorIsMe && s.who === null && !s.settled" class="text-xs text-text-secondary">{{ t('split.detail.inviteHint', { name: shareName(s) }) }}</p>
          </li>
        </ul>
      </section>

      <section class="space-y-2">
        <div class="grid grid-cols-2 gap-2">
          <NuxtLink :to="`/receipts/${split.receiptId}`" :class="buttonVariants({ variant: 'secondary', size: 'lg' })" class="no-underline hover:text-foreground" data-testid="split-open-receipt">{{ t('rcpt.sd.openReceipt') }}</NuxtLink>
          <Button type="button" variant="secondary" size="lg" data-testid="split-receipt-toggle" :aria-expanded="showReceipt" @click="showReceipt = !showReceipt">
            {{ showReceipt ? t('split.detail.hideReceipt') : t('split.detail.showReceipt') }}
          </Button>
        </div>
        <ReceiptView v-if="showReceipt && detailForView" :detail="detailForView" />
      </section>

      <section v-if="split.creatorIsMe" class="space-y-2 text-center">
        <Button v-if="!confirmDelete" type="button" variant="ghost" size="lg" class="w-full" data-testid="split-delete" @click="confirmDelete = true">{{ t('split.detail.delete') }}</Button>
        <div v-else class="space-y-2 rounded-xl border border-danger-border bg-danger-soft p-4 text-left" role="alert">
          <p class="text-sm text-danger">{{ t('split.detail.deleteConfirm') }}</p>
          <div class="flex gap-2">
            <Button type="button" variant="destructive" size="lg" data-testid="split-delete-confirm" @click="remove">{{ t('split.detail.deleteYes') }}</Button>
            <Button type="button" variant="secondary" size="lg" @click="confirmDelete = false">{{ t('social.cancel') }}</Button>
          </div>
        </div>
        <p class="text-xs text-text-secondary">{{ t('rcpt.sd.deleteNote') }}</p>
      </section>
    </template>
  </div>
</template>
