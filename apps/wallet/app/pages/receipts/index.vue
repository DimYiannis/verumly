<script setup lang="ts">
import { Search, SlidersHorizontal } from '@lucide/vue';
import { z } from 'zod';
import { ApiError } from '~/utils/api';
import type { ReceiptFilters, ReceiptListItem, UploadStatus } from '~/utils/api-schemas';
import { dayKey, filterCachedItems, formatDayHeading, formatEuro, formatMoney, formatTime, groupByDay } from '~/utils/format';
import { messages, type MessageKey } from '~/i18n';
import { hasActiveFilters, monthTotal, resolveCategory, visiblePhotos, visibleReceipts, type CategoryNames, type ListFilterState } from '~/utils/receipt-filters';
import { userName } from '~/utils/social';

const wallet = useWallet();
const { t, tOr, locale } = useLocale();
useHead({ title: () => t('wallet.title') });

const items = ref<ReceiptListItem[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const loaded = ref(false);
const offlineList = ref(false);
const failed = ref(false);
const showFilters = ref(false);
const onboarded = ref(true);
const uploads = ref<UploadStatus[]>([]);

const filters = reactive({ q: '', state: '', from: '', to: '', category: '', merchant: '' });
const STATES = ['presented', 'paid', 'void'] as const;

/** receiptId -> the people on its split ('shared with Anna' / 'from Lisa'); online only */
const splitHints = ref<Record<string, { mine: boolean; names: string[] }>>({});
const onlySplit = ref(false);

const chips = computed(() => [
  { id: 'all', label: t('rcpt.list.chipAll'), on: filters.state === '' && !onlySplit.value },
  { id: 'paid', label: t('rcpt.list.chipPaid'), on: filters.state === 'paid' && !onlySplit.value },
  { id: 'shared', label: t('rcpt.list.chipShared'), on: onlySplit.value },
  { id: 'void', label: t('rcpt.list.chipCancelled'), on: filters.state === 'void' && !onlySplit.value },
]);
function pickChip(id: string) {
  onlySplit.value = id === 'shared';
  filters.state = id === 'paid' || id === 'void' ? id : '';
}

function activeFilters(): ReceiptFilters {
  const f: ReceiptFilters = {};
  if (filters.q.trim()) f.q = filters.q.trim();
  const state = STATES.find((s) => s === filters.state);
  if (state) f.state = state;
  if (filters.from) f.from = filters.from;
  if (filters.to) f.to = filters.to;
  if (filters.category.trim()) f.category = resolveCategory(filters.category, categoryNames);
  if (filters.merchant.trim()) f.merchant = filters.merchant.trim();
  return f;
}

/** stored category key -> the names the user sees for it, in both languages */
const categoryNames: CategoryNames = {};
for (const key of Object.keys(messages.en)) {
  if (!key.startsWith('category.')) continue;
  const k = key as MessageKey;
  categoryNames[key.slice('category.'.length)] = [messages.en[k], messages.nl[k]];
}

const filterState = computed<ListFilterState>(() => ({ ...filters, onlySplit: onlySplit.value }));
const filtersActive = computed(() => hasActiveFilters(filterState.value));
const splitIds = computed(() => new Set(Object.keys(splitHints.value)));

function pageHasVisible(list: ReceiptListItem[]): boolean {
  return visibleReceipts(list, onlySplit.value, splitIds.value).length > 0;
}

async function load(append: boolean) {
  loading.value = true;
  failed.value = false;
  const f = activeFilters();
  const unfiltered = Object.keys(f).length === 0;
  try {
    let cursor = append ? (nextCursor.value ?? undefined) : undefined;
    let all = append ? items.value : [];
    // client-side chips (Shared) hide most of a page: keep paging until something new is visible or the list ends
    for (;;) {
      const page = await wallet.api.listReceipts({ ...f, cursor });
      all = [...all, ...page.items];
      items.value = all;
      nextCursor.value = page.nextCursor;
      cursor = page.nextCursor ?? undefined;
      if (unfiltered) await (all.length === page.items.length ? wallet.cache.replaceList(page.items) : wallet.cache.addToList(page.items));
      if (!cursor || !onlySplit.value || pageHasVisible(page.items)) break;
    }
    offlineList.value = false;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      await wallet.endSession();
    } else if (e instanceof ApiError && !e.isNetwork) {
      failed.value = true;
    } else {
      items.value = filterCachedItems(await wallet.cache.getList(), f);
      nextCursor.value = null;
      offlineList.value = true;
    }
  } finally {
    loading.value = false;
    loaded.value = true;
  }
  if (!append && !offlineList.value && !failed.value) await loadUploads();
}

async function loadUploads() {
  try {
    // photos are filtered client-side (`visibleUploads`), like the till receipts' Shared chip
    uploads.value = (await wallet.api.listUploads()).items;
  } catch {
    uploads.value = [];
  }
}

const visible = computed(() => visibleReceipts(items.value, onlySplit.value, splitIds.value));
const visibleUploads = computed(() => visiblePhotos(uploads.value, filterState.value, categoryNames));
const groups = computed(() => groupByDay(visible.value));
const noMatches = computed(() => loaded.value && !failed.value && filtersActive.value && visible.value.length === 0 && visibleUploads.value.length === 0);

function clearFilters() {
  filters.q = '';
  filters.state = '';
  filters.from = '';
  filters.to = '';
  filters.category = '';
  filters.merchant = '';
  onlySplit.value = false;
}

const monthKey = dayKey(new Date().toISOString()).slice(0, 7);
/** the month total counts one currency: the one of the newest shown receipt */
const totalCurrency = computed(() => visible.value[0]?.currency ?? 'EUR');
/** only what is shown: filters change the total */
const month = computed(() => monthTotal(visible.value, monthKey, totalCurrency.value));
const showMonthTotal = computed(() => loaded.value && visible.value.length > 0 && (!filtersActive.value || month.value.count > 0));
const monthName = computed(() => new Intl.DateTimeFormat(locale.value === 'nl' ? 'nl-NL' : 'en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(`${monthKey}-15T12:00:00Z`)));

function hintFor(receiptId: string): string | null {
  const h = splitHints.value[receiptId];
  if (!h || h.names.length === 0) return null;
  return h.mine ? t('rcpt.list.sharedWith', { names: h.names.join(', ') }) : t('rcpt.list.from', { name: h.names[0]! });
}

async function loadSplitHints() {
  try {
    const { splits } = await wallet.api.listSplits();
    const recent = splits.slice(0, 12);
    const details = await Promise.all(recent.map((s) => wallet.api.getSplit(s.id).catch(() => null)));
    const next: Record<string, { mine: boolean; names: string[] }> = {};
    recent.forEach((s, i) => {
      const d = details[i];
      if (!d) return;
      const names = s.creatorIsMe ? d.shares.filter((x) => !x.isMe).map((x) => (x.who ? userName(x.who) : (x.guestName ?? '?'))) : [userName(s.creator)];
      next[s.receiptId] = { mine: s.creatorIsMe, names };
    });
    splitHints.value = next;
  } catch {
    splitHints.value = {};
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
watch(filters, () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => void load(false), 300);
});
// Shared is a client-side chip: when the loaded pages hold none, fetch on until one shows up or the list ends
watch(onlySplit, (on) => {
  if (on && nextCursor.value && !loading.value && visible.value.length === 0) void load(true);
});
watch(wallet.savedTick, () => void load(false));
watch(wallet.online, (isOnline) => {
  if (isOnline) void load(false);
});

onMounted(async () => {
  if (!wallet.session.value) return;
  onboarded.value = (await wallet.kv.get('onboarded', z.boolean())) ?? false;
  await load(false);
  if (!offlineList.value) void loadSplitHints();
});
onBeforeUnmount(() => clearTimeout(debounce));
</script>

<template>
  <div>
    <section v-if="!wallet.session.value" class="space-y-4" data-testid="landing">
      <h1 class="text-h1 font-semibold">{{ t('wallet.landingTitle') }}</h1>
      <p class="text-text-secondary">{{ t('wallet.landingBody') }}</p>
      <Button as-child size="lg" class="w-full">
        <NuxtLink to="/login" data-testid="login-link">{{ t('common.login') }}</NuxtLink>
      </Button>
      <InstallHint />
    </section>

    <div v-else class="space-y-4">
      <NuxtLink
        v-if="!onboarded"
        to="/onboarding"
        data-testid="onboarding-prompt"
        class="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-selected-border bg-selected p-3 text-sm font-medium text-accent-foreground no-underline hover:text-accent-foreground"
      >
        {{ t('wallet.onboardingPrompt') }}
      </NuxtLink>

      <ArrivingSection />

      <h1 class="text-h2 font-semibold">{{ t('rcpt.list.title') }}</h1>

      <form class="space-y-3" role="search" @submit.prevent="load(false)">
        <Label for="q" class="sr-only">{{ t('wallet.searchLabel') }}</Label>
        <div class="relative">
          <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="q" v-model="filters.q" type="search" class="h-11 rounded-[10px] bg-card pl-9 text-base" :placeholder="t('wallet.searchPlaceholder')" data-testid="search-input" />
        </div>
        <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" :aria-label="t('wallet.filters')">
          <button
            v-for="c in chips"
            :key="c.id"
            type="button"
            :aria-pressed="c.on"
            :data-testid="`chip-${c.id}`"
            class="inline-flex min-h-9 shrink-0 items-center rounded-full border px-3 text-[13px] font-medium whitespace-nowrap"
            :class="c.on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-text-secondary'"
            @click="pickChip(c.id)"
          >
            {{ c.label }}
          </button>
          <button
            type="button"
            class="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[13px] font-medium whitespace-nowrap text-text-secondary"
            :aria-expanded="showFilters"
            aria-controls="filters"
            data-testid="toggle-filters"
            @click="showFilters = !showFilters"
          >
            <SlidersHorizontal class="size-3.5" aria-hidden="true" />
            {{ t('wallet.filters') }}
          </button>
        </div>
        <div v-show="showFilters" id="filters" class="grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-4" data-testid="filters">
          <div class="col-span-2 space-y-2">
            <Label for="f-state">{{ t('wallet.filterStatus') }}</Label>
            <select
              id="f-state"
              v-model="filters.state"
              class="h-11 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring"
              data-testid="filter-state"
            >
              <option value="">{{ t('wallet.filterAll') }}</option>
              <option value="paid">{{ t('wallet.filterPaid') }}</option>
              <option value="void">{{ t('wallet.filterVoid') }}</option>
            </select>
          </div>
          <div class="space-y-2">
            <Label for="f-from">{{ t('wallet.filterFrom') }}</Label>
            <Input id="f-from" v-model="filters.from" type="date" class="h-11" data-testid="filter-from" />
          </div>
          <div class="space-y-2">
            <Label for="f-to">{{ t('wallet.filterTo') }}</Label>
            <Input id="f-to" v-model="filters.to" type="date" class="h-11" data-testid="filter-to" />
          </div>
          <div class="space-y-2">
            <Label for="f-merchant">{{ t('wallet.filterMerchant') }}</Label>
            <Input id="f-merchant" v-model="filters.merchant" type="text" class="h-11" data-testid="filter-merchant" />
          </div>
          <div class="space-y-2">
            <Label for="f-category">{{ t('wallet.filterCategory') }}</Label>
            <Input id="f-category" v-model="filters.category" type="text" class="h-11" data-testid="filter-category" />
          </div>
        </div>
      </form>

      <p v-if="showMonthTotal" class="text-xs font-medium tracking-wide text-text-secondary uppercase" data-testid="month-total">{{ monthName }} · {{ formatMoney(month.total, locale, totalCurrency) }}</p>

      <p v-if="offlineList" role="status" data-testid="offline-list-note" class="rounded-lg border border-warning-border bg-warning-soft p-3 text-sm text-warning">
        {{ t('wallet.offlineList') }}
      </p>
      <p v-if="failed" role="alert" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ t('wallet.loadFailed') }}</p>
      <div v-if="loading && !loaded" class="space-y-2">
        <p role="status" class="flex items-center gap-2 text-sm text-text-secondary">
          <Spinner role="presentation" aria-hidden="true" />
          {{ t('common.loading') }}
        </p>
        <Skeleton class="h-16 w-full" />
        <Skeleton class="h-16 w-full" />
      </div>

      <div v-if="loaded && items.length === 0 && !failed && !filtersActive" class="rounded-xl border border-border bg-card p-4" data-testid="empty-wallet">
        <p class="text-text-secondary">{{ t('wallet.emptyPre') }}<NuxtLink to="/add" class="font-medium underline">{{ t('wallet.emptyLink') }}</NuxtLink>{{ t('wallet.emptyPost') }}</p>
      </div>

      <div v-if="groups.length" class="overflow-hidden rounded-[14px] border border-border bg-card">
        <section v-for="g in groups" :key="g.day" data-testid="day-group" :data-day="g.day" :aria-label="formatDayHeading(g.day, undefined, locale)">
          <h2 class="border-b border-border bg-muted px-4 py-2 text-xs font-semibold tracking-wide text-text-secondary uppercase" data-testid="day-heading">{{ formatDayHeading(g.day, undefined, locale) }}</h2>
          <ul>
            <li v-for="r in g.items" :key="r.receiptId" class="border-b border-border last:border-b-0">
              <NuxtLink
                :to="`/receipts/${r.receiptId}`"
                class="flex min-h-16 items-center gap-3 px-4 py-3 text-foreground no-underline transition-colors duration-150 hover:bg-muted hover:text-foreground"
                data-testid="receipt-item"
                :data-receipt-id="r.receiptId"
                :data-state="r.state"
              >
                <MerchantLogo :name="r.merchantName" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[15px] font-medium">{{ r.merchantName }}</span>
                  <span class="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-text-secondary">
                    {{ formatTime(r.createdAt, locale) }}
                    <template v-if="hintFor(r.receiptId) && r.state !== 'void'">· {{ hintFor(r.receiptId) }}</template>
                    <Badge v-if="r.state === 'void'" variant="danger">{{ t('wallet.badgeVoid') }}</Badge>
                  </span>
                </span>
                <span class="shrink-0 font-mono text-[15px] tabular-nums" :class="r.state === 'void' ? 'text-text-secondary line-through' : ''">{{ formatMoney(r.total, locale, r.currency) }}</span>
              </NuxtLink>
            </li>
          </ul>
        </section>
      </div>
      <div v-if="noMatches" class="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="no-results">
        <p class="text-text-secondary">{{ t('rcpt.list.noResults') }}</p>
        <Button type="button" variant="secondary" data-testid="clear-filters" @click="clearFilters">{{ t('rcpt.list.clearFilters') }}</Button>
      </div>

      <Button v-if="nextCursor" type="button" variant="secondary" size="lg" class="w-full" :disabled="loading" data-testid="load-more" @click="load(true)">{{ t('wallet.loadMore') }}</Button>

      <section v-if="visibleUploads.length > 0" aria-labelledby="uploads-h" data-testid="uploads-section">
        <h2 id="uploads-h" class="mb-2 text-label text-text-secondary">{{ t('wallet.uploads') }}</h2>
        <ul class="space-y-2">
          <li v-for="u in visibleUploads" :key="u.uploadId">
            <NuxtLink
              :to="`/uploads/${u.uploadId}`"
              class="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 text-foreground no-underline transition-shadow duration-150 hover:text-foreground hover:shadow-sm"
              data-testid="upload-item"
              :data-upload-id="u.uploadId"
              :data-status="u.status"
            >
              <span class="min-w-0">
                <span class="block truncate font-medium">{{ u.draft?.merchantName ?? t('common.unknownMerchant') }}</span>
                <span class="block text-sm text-text-secondary">{{ tOr('upload', u.status) }}</span>
              </span>
              <span v-if="u.draft?.gross != null" class="shrink-0 font-mono font-medium tabular-nums">{{ formatEuro(u.draft.gross, locale) }}</span>
            </NuxtLink>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
