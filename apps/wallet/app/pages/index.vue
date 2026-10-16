<script setup lang="ts">
import { Search, SlidersHorizontal } from '@lucide/vue';
import { z } from 'zod';
import { ApiError } from '~/utils/api';
import type { ReceiptFilters, ReceiptListItem, UploadStatus } from '~/utils/api-schemas';
import { filterCachedItems, formatDayHeading, formatEuro, formatTime, groupByDay } from '~/utils/format';

const wallet = useWallet();
useHead({ title: 'Mijn bonnen' });

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
  pending_upload: 'Wordt geüpload…',
  processing: 'Wordt gelezen…',
  replaced: 'Vervangen door de officiële bon',
  done: 'Gelezen',
  needs_review: 'Controleer de gegevens',
  failed: 'Mislukt',
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
      <h1 class="text-h1 font-semibold">Je kassabonnen, digitaal</h1>
      <p class="text-text-secondary">Scan de QR-code op de bon met de camera van je telefoon. De bon staat daarna veilig in je portemonnee, ook offline.</p>
      <Button as-child size="lg" class="w-full">
        <NuxtLink to="/login" data-testid="login-link">Inloggen</NuxtLink>
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
        Stel je voorkeuren in (meldingen en privacy) →
      </NuxtLink>

      <ArrivingSection />

      <h1 class="text-h2 font-semibold">Mijn bonnen</h1>

      <form class="space-y-2" role="search" @submit.prevent="load(false)">
        <Label for="q" class="sr-only">Zoeken in bonnen</Label>
        <div class="relative">
          <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="q" v-model="filters.q" type="search" class="h-11 pl-9 text-base" placeholder="Zoek winkel of product" data-testid="search-input" />
        </div>
        <Button type="button" variant="secondary" class="w-full" :aria-expanded="showFilters" aria-controls="filters" data-testid="toggle-filters" @click="showFilters = !showFilters">
          <SlidersHorizontal aria-hidden="true" />
          Filters
        </Button>
        <div v-show="showFilters" id="filters" class="grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-4" data-testid="filters">
          <div class="col-span-2 space-y-2">
            <Label for="f-state">Status</Label>
            <select
              id="f-state"
              v-model="filters.state"
              class="h-11 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring"
              data-testid="filter-state"
            >
              <option value="">Alle</option>
              <option value="presented">Rekening</option>
              <option value="paid">Betaald</option>
              <option value="void">Vervallen</option>
            </select>
          </div>
          <div class="space-y-2">
            <Label for="f-from">Van</Label>
            <Input id="f-from" v-model="filters.from" type="date" class="h-11" data-testid="filter-from" />
          </div>
          <div class="space-y-2">
            <Label for="f-to">Tot</Label>
            <Input id="f-to" v-model="filters.to" type="date" class="h-11" data-testid="filter-to" />
          </div>
          <div class="space-y-2">
            <Label for="f-merchant">Winkel</Label>
            <Input id="f-merchant" v-model="filters.merchant" type="text" class="h-11" data-testid="filter-merchant" />
          </div>
          <div class="space-y-2">
            <Label for="f-category">Categorie</Label>
            <Input id="f-category" v-model="filters.category" type="text" class="h-11" data-testid="filter-category" />
          </div>
        </div>
      </form>

      <p v-if="offlineList" role="status" data-testid="offline-list-note" class="rounded-lg border border-warning-border bg-warning-soft p-3 text-sm text-warning">
        Offline: je ziet de bonnen die op dit toestel zijn bewaard.
      </p>
      <p v-if="failed" role="alert" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">De bonnen konden niet worden geladen.</p>
      <div v-if="loading && !loaded" class="space-y-2">
        <p role="status" class="flex items-center gap-2 text-sm text-text-secondary">
          <Spinner role="presentation" aria-hidden="true" />
          Laden…
        </p>
        <Skeleton class="h-16 w-full" />
        <Skeleton class="h-16 w-full" />
      </div>

      <div v-if="loaded && items.length === 0 && !failed" class="rounded-xl border border-border bg-card p-4" data-testid="empty-wallet">
        <p class="text-text-secondary">Nog geen bonnen. Scan een QR-code bij de kassa, of <NuxtLink to="/add" class="font-medium underline">voeg een oude bon toe</NuxtLink>.</p>
      </div>

      <section v-for="g in groups" :key="g.day" data-testid="day-group" :data-day="g.day" :aria-label="formatDayHeading(g.day)">
        <h2 class="mb-2 text-label text-text-secondary" data-testid="day-heading">{{ formatDayHeading(g.day) }}</h2>
        <ul class="space-y-2">
          <li v-for="r in g.items" :key="r.receiptId">
            <NuxtLink
              :to="`/receipts/${r.receiptId}`"
              class="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 text-foreground no-underline transition-shadow duration-150 hover:text-foreground hover:shadow-sm"
              data-testid="receipt-item"
              :data-receipt-id="r.receiptId"
              :data-state="r.state"
            >
              <span class="min-w-0">
                <span class="block truncate font-medium">{{ r.merchantName }}</span>
                <span class="mt-0.5 flex items-center gap-2 text-sm text-text-secondary">
                  {{ formatTime(r.createdAt) }}
                  <Badge v-if="r.state === 'presented'" variant="warning">Rekening</Badge>
                  <Badge v-else-if="r.state === 'void'" variant="danger">Vervallen</Badge>
                  <Badge v-else-if="r.final" variant="success">Definitief</Badge>
                </span>
              </span>
              <span class="shrink-0 font-mono font-medium tabular-nums">{{ formatEuro(r.total) }}</span>
            </NuxtLink>
          </li>
        </ul>
      </section>

      <Button v-if="nextCursor" type="button" variant="secondary" size="lg" class="w-full" :disabled="loading" data-testid="load-more" @click="load(true)">Meer laden</Button>

      <section v-if="uploads.length > 0" aria-labelledby="uploads-h" data-testid="uploads-section">
        <h2 id="uploads-h" class="mb-2 text-label text-text-secondary">Toegevoegde foto's</h2>
        <ul class="space-y-2">
          <li v-for="u in uploads" :key="u.uploadId">
            <NuxtLink :to="`/uploads/${u.uploadId}`" class="block rounded-lg border border-border bg-card p-4 text-foreground no-underline transition-shadow duration-150 hover:text-foreground hover:shadow-sm" data-testid="upload-item">
              <span class="font-medium">{{ u.draft?.merchantName ?? 'Onbekende winkel' }}</span>
              <span class="block text-sm text-text-secondary">{{ UPLOAD_LABEL[u.status] }}</span>
            </NuxtLink>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
