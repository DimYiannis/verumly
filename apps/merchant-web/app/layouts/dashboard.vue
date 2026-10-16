<script setup lang="ts">
const session = sessionState();
const role = computed(() => session.value.user?.role);
const links = computed(() =>
  [
    { to: '/dashboard/archive', label: 'Archive', id: 'nav-archive', show: true },
    { to: '/dashboard/reports', label: 'Reports', id: 'nav-reports', show: true },
    { to: '/dashboard/exports', label: 'Exports', id: 'nav-exports', show: true },
    { to: '/dashboard/organisation', label: 'Organisation', id: 'nav-organisation', show: true },
    { to: '/dashboard/locations', label: 'Locations', id: 'nav-locations', show: true },
    { to: '/dashboard/terminals', label: 'Terminals', id: 'nav-terminals', show: role.value !== 'accountant' },
    { to: '/dashboard/users', label: 'Users & roles', id: 'nav-users', show: role.value === 'owner' },
    { to: '/simulator', label: 'Simulator', id: 'nav-simulator', show: role.value !== 'accountant' },
  ].filter((l) => l.show),
);

async function logout() {
  await $fetch<unknown>('/api/dashboard/logout', { method: 'POST' });
  session.value = { state: 'anonymous' };
  await navigateTo('/dashboard/login');
}
</script>

<template>
  <div class="min-h-screen bg-slate-50 text-slate-900">
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <NuxtLink to="/dashboard" class="font-semibold">Less Receipts</NuxtLink>
        <nav class="flex flex-wrap gap-4 text-sm">
          <NuxtLink v-for="l in links" :key="l.to" :to="l.to" :data-testid="l.id" class="text-slate-600 hover:text-slate-900" active-class="font-semibold text-slate-900">{{ l.label }}</NuxtLink>
        </nav>
        <div class="ml-auto flex items-center gap-3 text-sm text-slate-600">
          <span data-testid="whoami">{{ session.user?.orgName }} · {{ session.user?.email }} ({{ role }})</span>
          <button class="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100" data-testid="logout" @click="logout">Log out</button>
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-6xl px-4 py-6">
      <slot />
    </main>
  </div>
</template>
