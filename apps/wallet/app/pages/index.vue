<script setup lang="ts">
import { z } from 'zod';
import { ApiError } from '~/utils/api';
import type { ReceiptFilters, ReceiptListItem, UploadStatus } from '~/utils/api-schemas';
import { filterCachedItems, formatDayHeading, formatEuro, formatTime, groupByDay } from '~/utils/format';

const wallet = useWallet();
useHead({ title: 'My receipts' });

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

function activeFilters(): ReceiptFilters {
  const f: ReceiptFilters = {};
  if (filters.q.trim()) f.q = filters.q.trim();
  const state = STATES.find((s) => s === filters.state);
  if (state) f.state = state;
  if (filters.from) f.from = filters.from;
  if (filters.to) f.to = filters.to;
  if (filters.category.trim()) f.category = filters.category.trim();
  if (filters.merchant.trim()) f.merchant = filters.merchant.trim();
  return f;
}

async function load(append: boolean) {
  loading.value = true;
  failed.value = false;
  const f = activeFilters();
  const unfiltered = Object.keys(f).length === 0;
  try {
    const page = await wallet.api.listReceipts({ ...f, cursor: append ? (nextCursor.value ?? undefined) : undefined });
    items.value = append ? [...items.value, ...page.items] : page.items;
    nextCursor.value = page.nextCursor;
    offlineList.value = false;
    if (unfiltered) await (append ? wallet.cache.addToList(page.items) : wallet.cache.replaceList(page.items));
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
}

async function loadUploads() {
  try {
    uploads.value = (await wallet.api.listUploads()).items;
  } catch {
    uploads.value = [];
  }
}

const groups = computed(() => groupByDay(items.value));
const UPLOAD_LABEL: Record<UploadStatus['status'], string> = {
  pending_upload: 'Uploading…',
  processing: 'Reading…',
  replaced: 'Replaced by the official receipt',
  done: 'Read',
  needs_review: 'Check the details',
  failed: 'Failed',
};

let debounce: ReturnType<typeof setTimeout> | undefined;
watch(filters, () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => void load(false), 300);
});
watch(wallet.savedTick, () => void load(false));
watch(wallet.online, (isOnline) => {
  if (isOnline) void load(false);
});

onMounted(async () => {
  if (!wallet.session.value) return;
  onboarded.value = (await wallet.kv.get('onboarded', z.boolean())) ?? false;
  await load(false);
  if (!offlineList.value) await loadUploads();
});
onBeforeUnmount(() => clearTimeout(debounce));
</script>

<template>
  <div>
    <section v-if="!wallet.session.value" class="space-y-4" data-testid="landing">
      <h1 class="text-3xl font-bold">Your receipts, digital</h1>
      <p class="text-lg">Scan the QR code on the receipt with your phone's camera. The receipt is then kept safely in your wallet, even offline.</p>
      <NuxtLink to="/login" class="btn btn-primary w-full" data-testid="login-link">Log in</NuxtLink>
      <InstallHint />
    </section>

    <template v-else>
      <NuxtLink
        v-if="!onboarded"
        to="/onboarding"
        data-testid="onboarding-prompt"
        class="mb-4 block rounded-xl border border-brand-600 bg-brand-50 p-3 font-medium text-brand-900"
      >
        Set your preferences (notifications and privacy) →
      </NuxtLink>

      <ArrivingSection />

      <h1 class="mb-3 text-2xl font-bold">My receipts</h1>

      <form class="mb-4 space-y-2" role="search" @submit.prevent="load(false)">
        <label for="q" class="sr-only">Search receipts</label>
        <input id="q" v-model="filters.q" type="search" class="input" placeholder="Search shop or product" data-testid="search-input" />
        <button type="button" class="btn btn-secondary w-full" :aria-expanded="showFilters" aria-controls="filters" data-testid="toggle-filters" @click="showFilters = !showFilters">
          Filters
        </button>
        <div v-show="showFilters" id="filters" class="card grid grid-cols-2 gap-3" data-testid="filters">
          <label class="col-span-2 block text-sm font-medium">
            Status
            <select v-model="filters.state" class="input mt-1" data-testid="filter-state">
              <option value="">All</option>
              <option value="presented">Bill</option>
              <option value="paid">Paid</option>
              <option value="void">Void</option>
            </select>
          </label>
          <label class="block text-sm font-medium">
            From
            <input v-model="filters.from" type="date" class="input mt-1" data-testid="filter-from" />
          </label>
          <label class="block text-sm font-medium">
            To
            <input v-model="filters.to" type="date" class="input mt-1" data-testid="filter-to" />
          </label>
          <label class="block text-sm font-medium">
            Shop
            <input v-model="filters.merchant" type="text" class="input mt-1" data-testid="filter-merchant" />
          </label>
          <label class="block text-sm font-medium">
            Category
            <input v-model="filters.category" type="text" class="input mt-1" data-testid="filter-category" />
          </label>
        </div>
      </form>

      <p v-if="offlineList" role="status" data-testid="offline-list-note" class="mb-3 rounded-xl bg-amber-100 p-3 text-sm text-amber-950">
        Offline: you see the receipts saved on this device.
      </p>
      <p v-if="failed" role="alert" class="mb-3 rounded-xl bg-red-50 p-3 text-red-900">The receipts could not be loaded.</p>
      <p v-if="loading && !loaded" role="status">Loading…</p>

      <div v-if="loaded && items.length === 0 && !failed" class="card" data-testid="empty-wallet">
        <p>No receipts yet. Scan a QR code at the till, or <NuxtLink to="/add" class="font-semibold underline">add an old receipt</NuxtLink>.</p>
      </div>

      <section v-for="g in groups" :key="g.day" class="mb-5" data-testid="day-group" :data-day="g.day" :aria-label="formatDayHeading(g.day)">
        <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700" data-testid="day-heading">{{ formatDayHeading(g.day) }}</h2>
        <ul class="space-y-2">
          <li v-for="r in g.items" :key="r.receiptId">
            <NuxtLink :to="`/receipts/${r.receiptId}`" class="card flex items-center justify-between gap-3" data-testid="receipt-item" :data-receipt-id="r.receiptId" :data-state="r.state">
              <span>
                <span class="block font-semibold">{{ r.merchantName }}</span>
                <span class="block text-sm text-slate-700">
                  {{ formatTime(r.createdAt) }}
                  <span v-if="r.state === 'presented'" class="ml-1 rounded bg-amber-100 px-2 py-0.5 text-amber-950">Bill</span>
                  <span v-else-if="r.state === 'void'" class="ml-1 rounded bg-red-100 px-2 py-0.5 text-red-900">Void</span>
                  <span v-else-if="r.final" class="ml-1 rounded bg-brand-100 px-2 py-0.5 text-brand-900">Final</span>
                </span>
              </span>
              <span class="font-semibold tabular-nums">{{ formatEuro(r.total) }}</span>
            </NuxtLink>
          </li>
        </ul>
      </section>

      <button v-if="nextCursor" type="button" class="btn btn-secondary w-full" :disabled="loading" data-testid="load-more" @click="load(true)">Load more</button>

      <section v-if="uploads.length > 0" class="mt-8" aria-labelledby="uploads-h" data-testid="uploads-section">
        <h2 id="uploads-h" class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">Added photos</h2>
        <ul class="space-y-2">
          <li v-for="u in uploads" :key="u.uploadId">
            <NuxtLink :to="`/uploads/${u.uploadId}`" class="card block" data-testid="upload-item">
              <span class="font-semibold">{{ u.draft?.merchantName ?? 'Unknown shop' }}</span>
              <span class="block text-sm text-slate-700">{{ UPLOAD_LABEL[u.status] }}</span>
            </NuxtLink>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
