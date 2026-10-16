<script setup lang="ts">
import { ChartColumn, CirclePlus, ReceiptText, Settings, WifiOff } from '@lucide/vue';

const wallet = useWallet();
const route = useRoute();
const nav = [
  { to: '/', label: 'Bonnen', testid: 'nav-wallet', icon: ReceiptText },
  { to: '/insights', label: 'Inzichten', testid: 'nav-insights', icon: ChartColumn },
  { to: '/add', label: 'Toevoegen', testid: 'nav-add', icon: CirclePlus },
  { to: '/settings', label: 'Instellingen', testid: 'nav-settings', icon: Settings },
];

/** "/" owns the wallet list and the receipt pages; the others match by prefix. */
function isActive(to: string): boolean {
  const p = route.path;
  if (to === '/') return p === '/' || p.startsWith('/receipts') || p.startsWith('/r/');
  if (to === '/add') return p.startsWith('/add') || p.startsWith('/uploads');
  return p.startsWith(to);
}
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-xl flex-col bg-background">
    <a href="#main" class="sr-only focus:not-sr-only focus:m-2 focus:rounded-md focus:border focus:border-border focus:bg-card focus:p-2">Naar de inhoud</a>
    <header class="flex min-h-14 items-center justify-between gap-3 px-4 pt-[env(safe-area-inset-top)]">
      <NuxtLink to="/" class="font-sans text-xl font-semibold tracking-[-0.035em] text-foreground no-underline hover:text-foreground">bonnen</NuxtLink>
      <p
        v-if="!wallet.online.value"
        role="status"
        data-testid="offline-badge"
        class="inline-flex items-center gap-1.5 rounded-sm border border-warning-border bg-warning-soft px-2 py-1 text-xs font-medium text-warning"
      >
        <WifiOff class="size-3.5" aria-hidden="true" />
        Offline — opgeslagen bonnen blijven leesbaar
      </p>
    </header>
    <main id="main" class="flex-1 px-4 pt-2 pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <slot />
    </main>
    <nav v-if="wallet.session.value" aria-label="Hoofdmenu" class="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
      <ul class="mx-auto flex max-w-xl">
        <li v-for="item in nav" :key="item.to" class="flex-1">
          <NuxtLink
            :to="item.to"
            :data-testid="item.testid"
            :aria-current="isActive(item.to) ? 'page' : undefined"
            class="flex min-h-14 flex-col items-center justify-center gap-0.5 px-2 py-2 text-xs font-medium no-underline transition-colors duration-150"
            :class="isActive(item.to) ? 'text-primary hover:text-primary' : 'text-muted-foreground hover:text-foreground'"
          >
            <component :is="item.icon" class="size-5" aria-hidden="true" />
            {{ item.label }}
          </NuxtLink>
        </li>
      </ul>
    </nav>
  </div>
</template>
