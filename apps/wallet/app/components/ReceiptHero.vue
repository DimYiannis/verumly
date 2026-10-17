<script setup lang="ts">
/**
 * The top of the receipt page ("people first"): when the receipt has a split, who still owes what, with a one tap
 * settle and what each person had; without a split, the total and the two ways to bring people in.
 * The split parts are online only; offline (cached receipt) the plain hero shows without actions.
 */
import { Check, SquareSplitHorizontal, UserPlus } from '@lucide/vue';
import { buttonVariants } from '~/components/ui/button';
import type { MessageKey } from '~/i18n';
import type { ReceiptDetail, SplitDetail } from '~/utils/api-schemas';
import { formatDateTime, formatEuro, formatQty } from '~/utils/format';
import { errorKey, userName } from '~/utils/social';
import { describeShare, openAmount, splitHeadline, type ShareRow } from '~/utils/receipt-people';

const props = defineProps<{ detail: ReceiptDetail; offline: boolean }>();
const wallet = useWallet();
const { t, locale } = useLocale();

const crf = computed(() => props.detail.receipt);
const isVoid = computed(() => crf.value.state === 'void');
const total = computed(() => crf.value.totals.gross + crf.value.totals.tip + crf.value.totals.rounding);

const split = shallowRef<SplitDetail | null>(null);
const shareOpen = ref(false);
const busy = ref<string | null>(null);
const error = ref<MessageKey | null>(null);

async function loadSplit() {
  if (props.offline) return;
  try {
    const found = (await wallet.api.listSplits()).splits.find((s) => s.receiptId === crf.value.receiptId);
    split.value = found ? await wallet.api.getSplit(found.id) : null;
  } catch {
    split.value = null; // the people part is a bonus: the receipt itself never waits for it
  }
}
onMounted(loadSplit);
watch(
  () => props.offline,
  (off) => {
    if (!off) void loadSplit();
  },
);

function name(s: SplitDetail['shares'][number]): string {
  if (s.isMe) return t('split.you');
  return s.who ? userName(s.who) : (s.guestName ?? '?');
}

const rows = computed<ShareRow[]>(() => (split.value?.shares ?? []).map((s) => ({ id: s.id, name: name(s), amountMinor: s.amountMinor, settled: s.settled, isMe: s.isMe, lineNos: s.lineNos })));
const open = computed(() => openAmount(rows.value));
const headline = computed(() => (split.value ? splitHeadline(rows.value, split.value.creatorIsMe) : null));
const creatorName = computed(() => (split.value ? userName(split.value.creator) : ''));

/** Only the creator marks other people's shares; a participant marks their own. The API has the final say. */
const settleable = computed(() => {
  const sp = split.value;
  if (!sp) return [];
  return sp.shares.filter((s) => !s.settled && (sp.creatorIsMe ? !s.isMe : s.isMe));
});

async function settle(s: SplitDetail['shares'][number]) {
  if (!split.value) return;
  busy.value = s.id;
  error.value = null;
  try {
    split.value = await wallet.api.settleShare(split.value.id, s.id, true);
  } catch (e) {
    error.value = errorKey(e);
  } finally {
    busy.value = null;
  }
}

function had(s: SplitDetail['shares'][number]): string {
  const lines = crf.value.lines;
  const parts = s.lineNos.flatMap((n) => {
    const l = lines.find((x) => x.lineNo === n);
    return l ? [`${l.description} ×${formatQty(l.qty, locale.value)}`] : [];
  });
  return describeShare(parts, t('rcpt.detail.equalShare'));
}
const modeNote = computed(() => (split.value ? t(`rcpt.detail.mode.${split.value.mode}` as MessageKey) : ''));
const modeRows = computed(() => split.value?.mode === 'items');
</script>

<template>
  <div class="space-y-4" data-testid="receipt-hero">
    <!-- with a split -->
    <template v-if="split && headline">
      <section class="flex flex-col items-center gap-2 rounded-[14px] border border-brand-900 bg-brand-900 px-4 py-6 text-center text-white" data-testid="split-hero">
        <span class="text-xs font-medium tracking-wide text-[#B3B6EE] uppercase">{{ open > 0 ? t('rcpt.detail.stillOpen') : t('rcpt.detail.allSettled') }}</span>
        <span class="font-mono text-[44px] leading-[48px] font-semibold tracking-tight tabular-nums" data-testid="split-hero-amount">{{ formatEuro(open > 0 ? open : split.totalMinor, locale) }}</span>
        <span class="text-sm text-[#E6E7F8]">{{ open > 0 ? (split.creatorIsMe ? t('rcpt.detail.owesYou', { names: headline.names.join(', ') }) : t('rcpt.detail.youOweCreator', { name: creatorName })) : t('rcpt.detail.nothingOwed') }}</span>
      </section>

      <div class="flex gap-3 overflow-x-auto pb-1" data-testid="split-people">
        <div
          v-for="s in split.shares"
          :key="s.id"
          class="flex min-w-[8.5rem] flex-1 flex-col items-center gap-3 rounded-[14px] border bg-card px-2 py-4"
          :class="!s.settled && (split.creatorIsMe ? !s.isMe : s.isMe) ? 'border-primary shadow-[0_0_0_3px_var(--selected)]' : 'border-border'"
          data-testid="split-person"
        >
          <PersonAvatar :user="s.who" :name="name(s)" :me="s.isMe" :guest="!s.who && !s.isMe" size="lg" />
          <div class="flex flex-col items-center">
            <span class="max-w-full truncate text-[15px] font-semibold">{{ name(s) }}</span>
            <span class="font-mono text-sm tabular-nums" :class="s.settled ? 'text-text-secondary' : ''">{{ formatEuro(s.amountMinor, locale) }}</span>
          </div>
          <Badge v-if="s.settled" variant="success"><Check aria-hidden="true" />{{ s.isMe && split.creatorIsMe ? t('rcpt.detail.paidAll') : t('rcpt.detail.settled') }}</Badge>
          <Badge v-else variant="warning">{{ s.isMe ? t('rcpt.detail.youOwe') : split.creatorIsMe ? t('rcpt.detail.owesYouBadge') : t('rcpt.detail.owes') }}</Badge>
        </div>
      </div>

      <p v-if="error" role="alert" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ t(error) }}</p>
      <Button v-for="s in settleable" :key="s.id" type="button" size="lg" class="w-full" data-testid="receipt-settle" :disabled="busy === s.id" @click="settle(s)">
        {{ s.isMe ? t('split.detail.settle') : t('rcpt.detail.markSettled', { name: name(s) }) }}
      </Button>

      <section class="space-y-2" aria-labelledby="had-h">
        <div class="flex items-center justify-between">
          <h2 id="had-h" class="text-xs font-medium tracking-wide text-text-secondary uppercase">{{ t('rcpt.detail.whatEach') }}</h2>
          <NuxtLink :to="`/splits/${split.id}`" class="text-[13px] font-medium" data-testid="split-edit">{{ t('rcpt.detail.editSplit') }}</NuxtLink>
        </div>
        <div class="overflow-hidden rounded-[14px] border border-border bg-card">
          <div v-for="s in split.shares" :key="s.id" class="flex items-center gap-3 border-b border-border px-4 py-3">
            <PersonAvatar :user="s.who" :name="name(s)" :me="s.isMe" :guest="!s.who && !s.isMe" size="sm" />
            <span class="min-w-0 flex-1 text-sm">{{ modeRows ? had(s) : name(s) }}</span>
            <span class="font-mono text-sm tabular-nums">{{ formatEuro(s.amountMinor, locale) }}</span>
          </div>
          <p class="px-4 py-3 text-[13px] text-text-secondary">{{ modeNote }}</p>
        </div>
      </section>
    </template>

    <!-- without a split -->
    <template v-else>
      <section class="rounded-[14px] border border-border bg-card px-4 py-5" data-testid="plain-hero">
        <div class="flex items-center gap-3">
          <MerchantLogo :name="crf.merchant.name" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-[15px] font-semibold">{{ crf.merchant.name }}</p>
            <p class="text-xs text-text-secondary">{{ formatDateTime(crf.createdAt, locale) }}</p>
          </div>
          <Badge v-if="isVoid" variant="danger">{{ t('wallet.badgeVoid') }}</Badge>
        </div>
        <p class="mt-4 font-mono text-[40px] leading-[44px] font-semibold tracking-tight tabular-nums" :class="isVoid ? 'text-text-secondary line-through' : ''" data-testid="hero-total">{{ formatEuro(total, locale) }}</p>
        <p class="mt-1 text-[13px] text-text-secondary">{{ t('rcpt.detail.vatLine', { vat: formatEuro(crf.totals.vat, locale) }) }}</p>
      </section>
      <div v-if="!offline && !isVoid" class="space-y-2">
        <NuxtLink :to="`/receipts/${crf.receiptId}/split`" data-testid="receipt-split" :class="buttonVariants({ size: 'lg' })" class="w-full no-underline hover:text-primary-foreground">
          <SquareSplitHorizontal aria-hidden="true" />
          {{ t('rcpt.detail.splitThis') }}
        </NuxtLink>
        <Button type="button" variant="secondary" size="lg" class="w-full" data-testid="receipt-share" @click="shareOpen = true">
          <UserPlus aria-hidden="true" />
          {{ t('social.receipt.share') }}
        </Button>
      </div>
    </template>

    <ShareWithFriendSheet v-if="!offline" v-model:open="shareOpen" :receipt-id="crf.receiptId" />
  </div>
</template>
