<script setup lang="ts">
const wallet = useWallet();
const nav = [
  { to: '/', label: 'Bonnen', testid: 'nav-wallet' },
  { to: '/add', label: 'Toevoegen', testid: 'nav-add' },
  { to: '/insights', label: 'Inzichten', testid: 'nav-insights' },
  { to: '/settings', label: 'Instellingen', testid: 'nav-settings' },
];
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-xl flex-col">
    <a href="#main" class="sr-only focus:not-sr-only focus:m-2 focus:rounded focus:bg-white focus:p-2">Naar de inhoud</a>
    <header class="flex items-center justify-between px-4 pt-4">
      <NuxtLink to="/" class="text-lg font-bold text-brand-700">Bonnen</NuxtLink>
      <p
        v-if="!wallet.online.value"
        role="status"
        data-testid="offline-badge"
        class="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900"
      >
        Offline — opgeslagen bonnen blijven leesbaar
      </p>
    </header>
    <main id="main" class="flex-1 px-4 py-4 pb-24">
      <slot />
    </main>
    <nav v-if="wallet.session.value" aria-label="Hoofdmenu" class="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 backdrop-blur">
      <ul class="mx-auto flex max-w-xl justify-around">
        <li v-for="item in nav" :key="item.to" class="flex-1">
          <NuxtLink
            :to="item.to"
            :data-testid="item.testid"
            class="block px-2 py-3 text-center text-sm font-medium text-slate-700"
            active-class="text-brand-700 font-bold"
            exact-active-class="text-brand-700 font-bold"
          >
            {{ item.label }}
          </NuxtLink>
        </li>
      </ul>
    </nav>
  </div>
</template>
