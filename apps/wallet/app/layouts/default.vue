<script setup lang="ts">
import { ChartColumn, House, Plus, ReceiptText, Users, WifiOff } from '@lucide/vue';

const wallet = useWallet();
const route = useRoute();
const { t } = useLocale();
const { profile, name, load } = useProfile();
/** the login screen is a dark full-bleed page: no wordmark in the header, the page draws its own */
const bare = computed(() => route.path === '/login');

const tabs = [
  { to: '/', label: 'home.nav.home', testid: 'nav-home', icon: House },
  { to: '/receipts', label: 'home.nav.receipts', testid: 'nav-receipts', icon: ReceiptText },
  { to: '/add', label: 'home.nav.add', testid: 'nav-add', icon: Plus },
  { to: '/friends', label: 'home.nav.friends', testid: 'nav-friends', icon: Users },
  { to: '/insights', label: 'home.nav.insights', testid: 'nav-insights', icon: ChartColumn },
] as const;

/** Home is exactly "/"; /receipts and /r/ belong to Receipts; the social pages to Friends; /add and /uploads to the plus. */
function isActive(to: string): boolean {
  const p = route.path;
  if (to === '/') return p === '/';
  if (to === '/receipts') return p.startsWith('/receipts') || p.startsWith('/r/');
  if (to === '/add') return p.startsWith('/add') || p.startsWith('/uploads');
  if (to === '/friends') return p.startsWith('/friends') || p.startsWith('/splits') || p.startsWith('/shared') || p.startsWith('/i/');
  return p.startsWith(to);
}

// the header avatar: profile loaded once, lazily, and dropped again on logout
watch(
  () => wallet.session.value?.userId ?? wallet.session.value?.email ?? null,
  (who) => {
    profile.value = null;
    if (who) void load(true);
  },
  { immediate: true },
);
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-xl flex-col" :class="bare ? 'bg-brand-900 text-white' : 'bg-background'">
    <a href="#main" class="sr-only focus:not-sr-only focus:m-2 focus:rounded-md focus:border focus:border-border focus:bg-card focus:p-2">{{ t('layout.skip') }}</a>
    <header class="flex min-h-14 items-center justify-between gap-3 px-4 pt-[env(safe-area-inset-top)]">
      <NuxtLink v-if="!bare" to="/" class="font-sans text-xl font-semibold tracking-[-0.035em] text-foreground no-underline hover:text-foreground">{{ t('layout.brand') }}</NuxtLink>
      <div class="ml-auto flex shrink-0 items-center gap-3">
        <LocaleSwitch />
        <NuxtLink
          v-if="wallet.session.value"
          to="/settings"
          data-testid="nav-settings"
          :aria-label="t('home.nav.profile')"
          class="rounded-full no-underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        >
          <HomeAvatar :name="name || '?'" :emoji="profile?.avatar ?? null" size="sm" />
        </NuxtLink>
      </div>
    </header>
    <p
      v-if="!wallet.online.value"
      role="status"
      data-testid="offline-badge"
      class="mx-4 mb-1 flex items-center gap-1.5 rounded-sm border border-warning-border bg-warning-soft px-2 py-1 text-xs font-medium text-warning"
    >
      <WifiOff class="size-3.5" aria-hidden="true" />
      {{ t('layout.offline') }}
    </p>
    <main id="main" class="flex-1 px-4 pt-2 pb-[calc(6.5rem+env(safe-area-inset-bottom))]">
      <slot />
    </main>
    <nav v-if="wallet.session.value" :aria-label="t('layout.mainNav')" class="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
      <ul class="mx-auto flex max-w-xl items-end">
        <li v-for="item in tabs" :key="item.to" class="flex-1">
          <NuxtLink
            :to="item.to"
            :data-testid="item.testid"
            :aria-label="item.to === '/add' ? t(item.label) : undefined"
            :aria-current="isActive(item.to) ? 'page' : undefined"
            class="flex min-h-14 flex-col items-center justify-center gap-0.5 px-2 py-2 text-xs font-medium no-underline transition-colors duration-150"
            :class="isActive(item.to) ? 'text-primary hover:text-primary' : 'text-muted-foreground hover:text-foreground'"
          >
            <span
              v-if="item.to === '/add'"
              class="-mt-7 flex size-[52px] items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_6px_16px_rgba(51,56,184,0.35)] ring-4 ring-card"
              :class="isActive(item.to) ? 'bg-brand-900' : ''"
            >
              <component :is="item.icon" class="size-6" aria-hidden="true" />
            </span>
            <template v-else>
              <component :is="item.icon" class="size-5" aria-hidden="true" />
              {{ t(item.label) }}
            </template>
          </NuxtLink>
        </li>
      </ul>
    </nav>
  </div>
</template>
