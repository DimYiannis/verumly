<script setup lang="ts">
import { ChevronRight, ScanLine, WifiOff } from '@lucide/vue';
import { ApiError } from '~/utils/api';
import type { Balances, HomeSummary } from '~/utils/api-schemas';
import { dayKey, formatMoney, formatTime } from '~/utils/format';
import { budgetInputText, budgetProgress, dayPart, parseBudgetInput, percentChange, sparkPoints } from '~/utils/home';
import { userName } from '~/utils/social';

definePageMeta({ middleware: 'auth' });
const wallet = useWallet();
const { t, locale } = useLocale();
const { name, load: loadProfile } = useProfile();
useHead({ title: () => t('home.nav.home') });

const home = ref<HomeSummary | null>(null);
const balances = ref<Balances | null>(null);
const loaded = ref(false);
const offline = ref(false);
const failed = ref(false);
/** receipts from the offline cache when the home summary cannot be fetched */
const cachedRecent = ref<HomeSummary['recent']>([]);

const BCP47 = { nl: 'nl-NL', en: 'en-GB' } as const;
const today = computed(() => new Intl.DateTimeFormat(BCP47[locale.value], { timeZone: 'Europe/Amsterdam', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()));
const greeting = computed(() => {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return t(`home.greet.${dayPart(hour)}`, { name: name.value });
});

const change = computed(() => (home.value ? percentChange(home.value.total, home.value.previousToDate) : null));
const changeLabel = computed(() => {
  const pct = change.value;
  if (pct === null) return '';
  if (pct === 0) return t('home.hero.flat');
  return t(pct > 0 ? 'home.hero.up' : 'home.hero.down', { pct });
});
const spark = computed(() => (home.value ? sparkPoints(home.value.daily, 300, 56) : null));
const recent = computed(() => home.value?.recent ?? cachedRecent.value);
const isNew = computed(() => loaded.value && !offline.value && !failed.value && home.value !== null && home.value.receipts === 0 && home.value.recent.length === 0);

// optional monthly budget, kept on this device only (cents as a plain integer string)
const budgetKey = computed(() => `lr-budget:${wallet.session.value?.userId ?? ''}`);
const budget = ref<number | null>(null);
const editing = ref(false);
const budgetText = ref('');
const budgetError = ref(false);
function readBudget() {
  try {
    const n = Number(localStorage.getItem(budgetKey.value));
    budget.value = Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    budget.value = null;
  }
}
function openEditor() {
  budgetText.value = budget.value ? budgetInputText(budget.value, locale.value === 'nl' ? ',' : '.') : '';
  budgetError.value = false;
  editing.value = true;
}
function saveBudget() {
  const cents = parseBudgetInput(budgetText.value);
  if (cents === null) {
    budgetError.value = true;
    return;
  }
  budget.value = cents;
  editing.value = false;
  try {
    localStorage.setItem(budgetKey.value, String(cents));
  } catch {
    // not persisted: still shown for this session
  }
}
function removeBudget() {
  budget.value = null;
  editing.value = false;
  try {
    localStorage.removeItem(budgetKey.value);
  } catch {
    // ignore
  }
}
const progress = computed(() => (home.value && budget.value ? budgetProgress(home.value.total, budget.value) : null));
const wholeEuro = (cents: number) => formatMoney(cents, locale.value, home.value?.currency).replace(/[,.]00(?=\D*$)/, '');

function people(rows: Balances['friends'], key: 'owesMe' | 'iOwe') {
  return rows
    .filter((r) => r[key] > 0)
    .slice(0, 3)
    .map((r) => r.user);
}
const owedBy = computed(() => (balances.value ? people(balances.value.friends, 'owesMe') : []));
const oweTo = computed(() => (balances.value ? people(balances.value.friends, 'iOwe') : []));
const names = (us: typeof owedBy.value) => us.map((u) => userName(u)).join(', ');

function whenLabel(iso: string): string {
  if (dayKey(iso) === dayKey(new Date().toISOString())) return formatTime(iso, locale.value);
  return new Intl.DateTimeFormat(BCP47[locale.value], { timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'short' }).format(new Date(iso));
}
function itemsLabel(n: number): string {
  return n === 1 ? t('home.recent.items.one') : t('home.recent.items', { n });
}

onMounted(async () => {
  readBudget();
  void loadProfile();
  const [h, b] = await Promise.allSettled([wallet.api.getHome(), wallet.api.getBalances()]);
  if (h.status === 'fulfilled') home.value = h.value;
  else {
    if (h.reason instanceof ApiError && h.reason.status === 401) {
      await wallet.endSession();
      return;
    }
    if (h.reason instanceof ApiError && h.reason.isNetwork) offline.value = true;
    else failed.value = true;
    try {
      cachedRecent.value = (await wallet.cache.getList()).slice(0, 5).map((i) => ({
        receiptId: i.receiptId,
        merchantName: i.merchantName,
        total: i.total,
        createdAt: i.createdAt,
        state: i.state,
        currency: i.currency,
        splitWith: [],
        itemCount: 0,
      }));
    } catch {
      // no cache: the offline note is enough
    }
  }
  if (b.status === 'fulfilled') balances.value = b.value;
  loaded.value = true;
});
</script>

<template>
  <div class="space-y-4">
    <div class="space-y-1">
      <p class="text-small text-muted-foreground" data-testid="home-date">{{ today }}</p>
      <h1 class="text-h1 font-semibold" data-testid="home-greeting">{{ greeting }}</h1>
    </div>

    <p v-if="offline" role="status" data-testid="home-offline" class="flex items-center gap-2 rounded-xl border border-warning-border bg-warning-soft p-3 text-sm text-warning">
      <WifiOff class="size-4 shrink-0" aria-hidden="true" />
      {{ t('home.offline') }}
    </p>
    <p v-else-if="failed" role="alert" class="rounded-xl border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ t('home.err.failed') }}</p>

    <div v-if="!loaded" class="space-y-3">
      <Skeleton class="h-48 w-full rounded-xl" />
      <Skeleton class="h-24 w-full rounded-xl" />
    </div>

    <NuxtLink
      v-else-if="isNew"
      to="/add"
      data-testid="home-empty"
      class="flex flex-col items-start gap-3 rounded-xl bg-brand-900 p-5 text-white no-underline hover:text-white"
    >
      <span class="flex size-12 items-center justify-center rounded-xl bg-white/15"><ScanLine class="size-6" aria-hidden="true" /></span>
      <span class="text-h2 font-semibold">{{ t('home.empty.title') }}</span>
      <span class="text-sm text-[#E6E7F8]">{{ t('home.empty.body') }}</span>
      <span class="rounded-md bg-white px-4 py-2 text-sm font-medium text-brand-900">{{ t('home.empty.cta') }}</span>
    </NuxtLink>

    <section v-else-if="home" class="space-y-3 rounded-xl bg-brand-900 p-4 text-white" data-testid="home-hero" :aria-label="t('home.hero.title')">
      <div class="flex items-center justify-between gap-2">
        <span class="text-label text-[#B3B6EE] uppercase">{{ t('home.hero.title') }}</span>
        <span v-if="changeLabel" data-testid="home-change" class="rounded-full border border-white/25 bg-white/15 px-2.5 py-0.5 text-xs font-medium">{{ changeLabel }}</span>
      </div>
      <p class="font-mono text-[38px] leading-[44px] font-medium tracking-tight" data-testid="home-total">{{ formatMoney(home.total, locale, home.currency) }}</p>
      <svg v-if="spark" viewBox="0 0 300 56" preserveAspectRatio="none" class="h-14 w-full" role="img" :aria-label="t('home.hero.spark')" data-testid="home-spark">
        <polygon :points="spark.area" fill="rgba(179,182,238,.16)" />
        <polyline :points="spark.line" fill="none" stroke="#B3B6EE" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
      </svg>
      <div v-if="progress && budget" class="space-y-2" data-testid="home-budget">
        <div class="flex items-center justify-between text-small text-[#E6E7F8]">
          <span>{{ progress.over ? t('home.budget.over') : t('home.budget.label') }}</span>
          <button type="button" class="font-mono underline-offset-2 hover:underline" :aria-label="t('home.budget.edit')" @click="openEditor">{{ t('home.budget.of', { spent: wholeEuro(home.total), budget: wholeEuro(budget) }) }}</button>
        </div>
        <div class="h-2 overflow-hidden rounded-full bg-white/20" role="progressbar" :aria-valuenow="progress.pct" aria-valuemin="0" aria-valuemax="100">
          <div class="h-full rounded-full" :class="progress.over ? 'bg-[#F4B5A8]' : 'bg-white'" :style="{ width: `${progress.pct}%` }" />
        </div>
      </div>
      <button v-else-if="!editing" type="button" data-testid="home-budget-set" class="text-sm font-medium text-[#B3B6EE] underline-offset-2 hover:underline" @click="openEditor">{{ t('home.budget.set') }}</button>
      <form v-if="editing" class="space-y-2 rounded-lg bg-white p-3 text-foreground" data-testid="home-budget-form" novalidate @submit.prevent="saveBudget">
        <Label for="home-budget-input">{{ t('home.budget.field') }}</Label>
        <Input id="home-budget-input" v-model="budgetText" inputmode="decimal" class="h-10 font-mono" data-testid="home-budget-input" />
        <p v-if="budgetError" role="alert" class="text-sm text-danger">{{ t('home.budget.invalid') }}</p>
        <div class="flex gap-2">
          <Button type="submit" size="sm" data-testid="home-budget-save">{{ t('home.budget.save') }}</Button>
          <Button type="button" size="sm" variant="secondary" @click="editing = false">{{ t('home.budget.cancel') }}</Button>
          <Button v-if="budget" type="button" size="sm" variant="ghost" class="ml-auto text-danger" @click="removeBudget">{{ t('home.budget.remove') }}</Button>
        </div>
      </form>
    </section>

    <div v-if="balances" class="grid grid-cols-2 gap-3" data-testid="home-balances">
      <NuxtLink to="/friends" class="space-y-2 rounded-xl border border-border bg-card p-4 text-foreground no-underline hover:text-foreground">
        <span class="block text-label text-text-secondary uppercase">{{ t('home.owed.label') }}</span>
        <span class="block font-mono text-h2 font-medium text-success" data-testid="home-owed">{{ formatMoney(balances.totalOwedToMe, locale, balances.currency) }}</span>
        <span class="flex items-center gap-2">
          <span v-if="owedBy.length" class="flex -space-x-2"><HomeAvatar v-for="u in owedBy" :key="userName(u)" :name="userName(u)" :emoji="u.avatar" size="sm" /></span>
          <span class="truncate text-xs text-text-secondary">{{ owedBy.length ? names(owedBy) : t('home.owed.none') }}</span>
        </span>
      </NuxtLink>
      <NuxtLink to="/friends" class="space-y-2 rounded-xl border border-border bg-card p-4 text-foreground no-underline hover:text-foreground">
        <span class="block text-label text-text-secondary uppercase">{{ t('home.owe.label') }}</span>
        <span class="block font-mono text-h2 font-medium" data-testid="home-owe">{{ formatMoney(balances.totalIOwe, locale, balances.currency) }}</span>
        <span class="flex items-center gap-2">
          <span v-if="oweTo.length" class="flex -space-x-2"><HomeAvatar v-for="u in oweTo" :key="userName(u)" :name="userName(u)" :emoji="u.avatar" size="sm" /></span>
          <span class="truncate text-xs text-text-secondary">{{ oweTo.length ? names(oweTo) : t('home.owe.none') }}</span>
        </span>
      </NuxtLink>
    </div>

    <section v-if="recent.length > 0" class="space-y-2" aria-labelledby="home-recent-h" data-testid="home-recent">
      <div class="flex items-center justify-between">
        <h2 id="home-recent-h" class="text-h3 font-semibold">{{ t('home.recent.title') }}</h2>
        <NuxtLink to="/receipts" class="text-sm font-medium" data-testid="home-all-receipts">{{ t('home.recent.all') }}</NuxtLink>
      </div>
      <ul class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        <li v-for="r in recent" :key="r.receiptId">
          <NuxtLink :to="`/receipts/${r.receiptId}`" data-testid="home-recent-item" class="flex min-h-14 items-center gap-3 px-4 py-3 text-foreground no-underline hover:bg-muted hover:text-foreground">
            <MerchantLogo :name="r.merchantName" />
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium" :class="r.state === 'void' ? 'line-through' : ''">{{ r.merchantName }}</span>
              <span class="block truncate text-xs text-muted-foreground">
                {{ whenLabel(r.createdAt) }}<template v-if="r.itemCount > 0"> · {{ itemsLabel(r.itemCount) }}</template><template v-if="r.splitWith.length"> · {{ t('home.recent.splitWith', { names: r.splitWith.join(', ') }) }}</template>
              </span>
            </span>
            <Badge v-if="r.state === 'void'" variant="warning">{{ t('home.recent.cancelled') }}</Badge>
            <span class="font-mono text-sm">{{ formatMoney(r.total, locale, r.currency) }}</span>
            <ChevronRight class="size-4 text-muted-foreground" aria-hidden="true" />
          </NuxtLink>
        </li>
      </ul>
    </section>
    <NuxtLink v-else-if="loaded && !isNew" to="/receipts" class="block text-sm font-medium">{{ t('home.recent.all') }}</NuxtLink>
  </div>
</template>
