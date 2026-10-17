<script setup lang="ts">
import { Check, ChevronLeft, Plus, X } from '@lucide/vue';
import type { MessageKey } from '~/i18n';
import type { Profile } from '~/utils/api-schemas';
import { MAX_SPLIT_PARTICIPANTS, type PublicUser, type ReceiptDetail } from '~/utils/api-schemas';
import { formatEuro } from '~/utils/format';
import { errorKey, isOffline, userName } from '~/utils/social';
import { parseEuroInput, previewShares, type SplitMode } from '~/utils/split';
import { ApiError } from '~/utils/api';

definePageMeta({ middleware: 'auth' });

const route = useRoute();
const wallet = useWallet();
const { t, locale } = useLocale();
const id = String(route.params.id);
useHead({ title: () => t('split.title') });

interface Person {
  key: string;
  userId: string | null;
  guestName: string | null;
  label: string;
}

const status = ref<'loading' | 'ready' | 'offline' | 'error'>('loading');
const detail = shallowRef<ReceiptDetail | null>(null);
const friends = ref<PublicUser[]>([]);
const myProfile = ref<Profile | null>(null);
const selected = ref<Person[]>([]);
const guestName = ref('');
const includeMe = ref(true);
const mode = ref<SplitMode>('equal');
const assignments = ref<Record<number, string[]>>({});
const customText = ref<Record<string, string>>({});
const busy = ref(false);
const error = ref<MessageKey | null>(null);

async function load() {
  status.value = 'loading';
  try {
    const [d, f, p] = await Promise.all([wallet.api.getReceipt(id), wallet.api.getFriends(), wallet.api.getProfile().catch(() => null)]);
    myProfile.value = p;
    detail.value = d;
    friends.value = f.friends;
    status.value = 'ready';
  } catch (e) {
    status.value = isOffline(e) ? 'offline' : 'error';
    if (e instanceof ApiError && e.status === 404) status.value = 'error';
  }
}
onMounted(load);

const payable = computed(() => {
  const totals = detail.value?.receipt.totals;
  return totals ? totals.gross + totals.tip + totals.rounding : 0;
});

/** who keys in order: me first (when included), then p0, p1 by selection order */
const people = computed(() => [
  ...(includeMe.value ? [{ who: 'me', label: t('split.you') }] : []),
  ...selected.value.map((p, i) => ({ who: `p${i}`, label: p.label })),
]);

const customCents = computed(() => Object.fromEntries(people.value.map((p) => [p.who, parseEuroInput(customText.value[p.who] ?? '') ?? 0])));
const preview = computed(() =>
  previewShares({
    payable: payable.value,
    mode: mode.value,
    people: people.value.map((p) => p.who),
    lines: detail.value?.receipt.lines.map((l) => ({ lineNo: l.lineNo, total: l.total })) ?? [],
    assignments: assignments.value,
    custom: customCents.value,
  }),
);

function isSelectedFriend(userId: string) {
  return selected.value.some((p) => p.userId === userId);
}
function removeAt(index: number) {
  // selection order defines the p-index, so assignments and custom amounts are rebuilt after removal
  const removed = `p${index}`;
  selected.value = selected.value.filter((_, i) => i !== index);
  const shift = (w: string): string | null => {
    if (!w.startsWith('p')) return w;
    const n = Number(w.slice(1));
    if (w === removed) return null;
    return n > index ? `p${n - 1}` : w;
  };
  const next: Record<number, string[]> = {};
  for (const [line, who] of Object.entries(assignments.value)) next[Number(line)] = who.map(shift).filter((w): w is string => w !== null);
  assignments.value = next;
  const text: Record<string, string> = {};
  for (const [w, v] of Object.entries(customText.value)) {
    const k = shift(w);
    if (k) text[k] = v;
  }
  customText.value = text;
}
const full = computed(() => selected.value.length >= MAX_SPLIT_PARTICIPANTS);
function toggleFriend(f: PublicUser) {
  const at = selected.value.findIndex((p) => p.userId === f.userId);
  if (at >= 0) return removeAt(at);
  if (full.value) return;
  selected.value = [...selected.value, { key: f.userId, userId: f.userId, guestName: null, label: userName(f) }];
}
function addGuest() {
  const n = guestName.value.trim();
  if (!n || full.value) return;
  selected.value = [...selected.value, { key: `guest-${Date.now()}-${selected.value.length}`, userId: null, guestName: n, label: n }];
  guestName.value = '';
}

function toggleAssign(lineNo: number, who: string) {
  const cur = assignments.value[lineNo] ?? [];
  assignments.value = { ...assignments.value, [lineNo]: cur.includes(who) ? cur.filter((w) => w !== who) : [...cur, who] };
}
function assignEveryone(lineNo: number) {
  assignments.value = { ...assignments.value, [lineNo]: people.value.map((p) => p.who) };
}

// entering custom mode starts from the equal split, so the user only edits what differs
watch(mode, (m) => {
  if (m !== 'custom' || Object.values(customText.value).some((v) => v !== '')) return;
  const eq = previewShares({ payable: payable.value, mode: 'equal', people: people.value.map((p) => p.who), lines: [], assignments: {}, custom: {} });
  customText.value = Object.fromEntries(Object.entries(eq.shares).map(([w, c]) => [w, (c / 100).toFixed(2)]));
});

const canCreate = computed(() => selected.value.length >= 1 && people.value.length >= 1 && preview.value.valid && !busy.value);

async function create() {
  if (!canCreate.value || !detail.value) return;
  busy.value = true;
  error.value = null;
  try {
    const body = {
      receiptId: detail.value.receipt.receiptId,
      mode: mode.value,
      participants: selected.value.map((p) => (p.userId ? { userId: p.userId } : { guestName: p.guestName })),
      includeMe: includeMe.value,
      ...(mode.value === 'items'
        ? { assignments: Object.entries(assignments.value).map(([lineNo, who]) => ({ lineNo: Number(lineNo), who: who.filter((w) => people.value.some((p) => p.who === w)) })).filter((a) => a.who.length > 0) }
        : {}),
      ...(mode.value === 'custom' ? { amounts: people.value.map((p) => ({ who: p.who, amount: customCents.value[p.who] ?? 0 })) } : {}),
    };
    const created = await wallet.api.createSplit(body);
    await navigateTo(`/splits/${created.id}`);
  } catch (e) {
    error.value = errorKey(e);
  } finally {
    busy.value = false;
  }
}

const modes: { value: SplitMode; label: MessageKey }[] = [
  { value: 'equal', label: 'split.mode.equal' },
  { value: 'items', label: 'split.mode.items' },
  { value: 'custom', label: 'split.mode.custom' },
];
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <NuxtLink :to="`/receipts/${id}`" class="inline-flex min-h-11 min-w-11 items-center gap-1 text-sm font-medium text-primary no-underline hover:text-brand-900" :aria-label="t('split.back')">
        <ChevronLeft class="size-5" aria-hidden="true" />
        <span class="sr-only sm:not-sr-only">{{ t('split.back') }}</span>
      </NuxtLink>
      <h1 class="text-h3 font-semibold">{{ t('split.title') }}</h1>
      <span class="min-w-11" aria-hidden="true" />
    </div>
    <p v-if="status === 'loading'" role="status" class="flex items-center gap-2 text-sm text-text-secondary">
      <Spinner role="presentation" aria-hidden="true" />
      {{ t('common.loading') }}
    </p>
    <div v-else-if="status !== 'ready' || !detail" role="alert" data-testid="social-offline" class="space-y-3 rounded-xl border border-border bg-card p-4">
      <p>{{ t(status === 'offline' ? 'social.offline' : 'social.err.generic') }}</p>
      <Button type="button" variant="secondary" size="lg" @click="load">{{ t('common.retry') }}</Button>
    </div>
    <template v-else>
      <section class="flex items-center justify-between gap-3 rounded-[14px] border border-border bg-card px-4 py-3.5">
        <div class="flex min-w-0 items-center gap-3">
          <MerchantLogo :name="detail.receipt.merchant.name" />
          <div class="min-w-0">
            <p class="truncate font-semibold">{{ detail.receipt.merchant.name }}</p>
            <p class="text-xs text-text-secondary">{{ t('split.payable') }}</p>
          </div>
        </div>
        <p class="font-mono text-xl font-semibold tabular-nums" data-testid="split-payable">{{ formatEuro(payable, locale) }}</p>
      </section>

      <!-- participants -->
      <section class="space-y-2" :aria-label="t('split.who')">
        <h2 class="text-xs font-medium tracking-wide text-text-secondary uppercase">{{ t('rcpt.split.withWhom') }}</h2>
        <ul class="-mx-4 flex gap-3 overflow-x-auto px-4 py-1">
          <li>
            <button type="button" role="checkbox" :aria-checked="includeMe" data-testid="split-include-me" class="flex w-16 flex-col items-center gap-1.5" @click="includeMe = !includeMe">
              <span class="relative rounded-full" :class="includeMe ? 'outline outline-2 outline-primary' : 'opacity-60'">
                <PersonAvatar :user="myProfile" :name="t('split.you')" me size="lg" />
                <i v-if="includeMe" class="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check class="size-3" aria-hidden="true" /></i>
              </span>
              <span class="text-xs">{{ t('split.you') }}</span>
            </button>
          </li>
          <li v-for="(f, n) in friends" :key="f.userId">
            <button
              type="button"
              role="checkbox"
              :aria-checked="isSelectedFriend(f.userId)"
              :data-testid="`split-participant-${n}`"
              class="flex w-16 flex-col items-center gap-1.5"
              @click="toggleFriend(f)"
            >
              <span class="relative rounded-full" :class="isSelectedFriend(f.userId) ? 'outline outline-2 outline-primary' : ''">
                <PersonAvatar :user="f" :name="userName(f)" size="lg" />
                <i v-if="isSelectedFriend(f.userId)" class="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check class="size-3" aria-hidden="true" /></i>
              </span>
              <span class="w-full truncate text-xs">{{ userName(f) }}</span>
              <span v-if="isSelectedFriend(f.userId)" class="sr-only">{{ t('split.picked') }}</span>
            </button>
          </li>
          <template v-for="(p, i) in selected" :key="p.key">
            <li v-if="p.guestName" :data-testid="`split-guest-${i}`">
              <button type="button" class="flex w-16 flex-col items-center gap-1.5" :aria-label="t('split.removeGuest', { name: p.label })" @click="removeAt(i)">
                <span class="relative rounded-full outline outline-2 outline-primary">
                  <PersonAvatar :user="null" :name="p.label" size="lg" />
                  <i class="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"><X class="size-3" aria-hidden="true" /></i>
                </span>
                <span class="w-full truncate text-xs">{{ p.label }}</span>
              </button>
            </li>
          </template>
        </ul>
        <p v-if="friends.length === 0" class="text-sm text-text-secondary">{{ t('split.noFriends') }}</p>
        <form class="flex gap-2" @submit.prevent="addGuest">
          <Input v-model="guestName" maxlength="40" :placeholder="t('split.guestPlaceholder')" :aria-label="t('split.guestLabel')" class="h-11 bg-card" data-testid="split-guest-input" />
          <Button type="submit" variant="secondary" size="lg" data-testid="split-guest-add" :disabled="!guestName.trim() || full">
            <Plus aria-hidden="true" />
            {{ t('split.guestAdd') }}
          </Button>
        </form>
        <p class="text-xs text-text-secondary">{{ t('split.guestHint') }}</p>
        <p v-if="full" class="text-xs text-warning">{{ t('split.max', { n: MAX_SPLIT_PARTICIPANTS }) }}</p>
      </section>

      <!-- mode -->
      <section class="space-y-3">
        <Tabs v-model="mode">
          <TabsList class="grid h-12 w-full grid-cols-3 rounded-[10px] border border-border bg-card p-1">
            <TabsTrigger v-for="m in modes" :key="m.value" :value="m.value" :data-testid="`split-mode-${m.value}`" class="min-h-9 rounded-[7px] text-sm data-[state=active]:bg-primary data-[state=active]:font-semibold data-[state=active]:text-primary-foreground">{{ t(m.label) }}</TabsTrigger>
          </TabsList>
        </Tabs>

        <p v-if="mode === 'equal'" class="text-sm text-text-secondary">{{ t('split.equalHint') }}</p>

        <div v-else-if="mode === 'items'" class="space-y-3 rounded-[14px] border border-border bg-card p-4">
          <p class="text-sm text-text-secondary">{{ t('split.itemsHint') }}</p>
          <ul class="space-y-3">
            <li v-for="line in detail.receipt.lines" :key="line.lineNo" class="space-y-2 border-t border-border pt-3 first:border-t-0 first:pt-0" :data-testid="`split-line-${line.lineNo}`">
              <div class="flex justify-between gap-3 text-sm">
                <span class="min-w-0 break-words font-medium">{{ line.description }}</span>
                <span class="font-mono tabular-nums">{{ formatEuro(line.total, locale) }}</span>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="p in people"
                  :key="p.who"
                  type="button"
                  :aria-pressed="(assignments[line.lineNo] ?? []).includes(p.who)"
                  :data-testid="`split-chip-${line.lineNo}-${p.who}`"
                  class="min-h-9 rounded-full border px-3 text-[13px] font-medium"
                  :class="(assignments[line.lineNo] ?? []).includes(p.who) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-text-secondary'"
                  @click="toggleAssign(line.lineNo, p.who)"
                >
                  {{ p.label }}
                </button>
                <button type="button" class="min-h-9 rounded-full px-3 text-sm text-primary" @click="assignEveryone(line.lineNo)">{{ t('split.everyone') }}</button>
              </div>
            </li>
          </ul>
          <p v-if="preview.unassigned.length" role="status" class="text-sm text-warning" data-testid="split-unassigned">{{ t('split.unassigned', { n: preview.unassigned.length }) }}</p>
        </div>

        <div v-else class="space-y-2 rounded-[14px] border border-border bg-card p-4">
          <p class="text-sm text-text-secondary">{{ t('split.customHint') }}</p>
          <div v-for="p in people" :key="p.who" class="flex items-center gap-3">
            <Label :for="`custom-${p.who}`" class="flex-1 text-sm font-medium">{{ p.label }}</Label>
            <Input :id="`custom-${p.who}`" v-model="customText[p.who]" inputmode="decimal" class="h-11 w-28 text-right font-mono" :data-testid="`split-custom-${p.who}`" placeholder="0,00" />
          </div>
          <p
            v-if="preview.customDiff !== 0"
            role="status"
            class="text-sm text-warning"
            data-testid="split-custom-diff"
          >{{ preview.customDiff > 0 ? t('split.customOver', { amount: formatEuro(preview.customDiff, locale) }) : t('split.customUnder', { amount: formatEuro(-preview.customDiff, locale) }) }}</p>
        </div>
      </section>

      <!-- preview -->
      <section class="space-y-3 rounded-[14px] border border-border bg-card p-4" :aria-label="t('split.preview')" data-testid="split-preview">
        <h2 class="text-xs font-medium tracking-wide text-text-secondary uppercase">{{ t('rcpt.split.eachPays') }}</h2>
        <p v-if="people.length === 0" class="text-sm text-text-secondary">{{ t('split.previewEmpty') }}</p>
        <template v-else>
          <div v-for="p in people" :key="p.who" class="flex items-center gap-3" :data-testid="`split-preview-${p.who}`">
            <PersonAvatar :user="p.who === 'me' ? myProfile : null" :name="p.label" :me="p.who === 'me'" size="sm" />
            <span class="flex-1 text-[15px]">{{ p.label }}</span>
            <span class="font-mono text-[15px] font-semibold tabular-nums">{{ formatEuro(preview.shares[p.who] ?? 0, locale) }}</span>
          </div>
          <div class="flex justify-between border-t border-border pt-3 text-[13px] text-text-secondary">
            <span>{{ t('split.detail.total') }}</span>
            <span class="font-mono tabular-nums">{{ formatEuro(payable, locale) }}</span>
          </div>
        </template>
        <p class="text-xs text-text-secondary">{{ t('split.tipNote') }}</p>
      </section>

      <p class="rounded-[14px] border border-selected-border bg-selected px-3.5 py-3 text-[13px] text-accent-foreground">{{ t('rcpt.split.privacy') }}</p>

      <p v-if="error" role="alert" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ t(error) }}</p>
      <Button type="button" size="lg" class="w-full" data-testid="split-create" :disabled="!canCreate" @click="create">
        {{ busy ? t('split.creating') : t('split.create') }}
      </Button>
    </template>
  </div>
</template>
