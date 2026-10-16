<script setup lang="ts">
import { ArchiveIcon, BuildingIcon, ChartColumnIcon, DownloadIcon, LayoutDashboardIcon, LogOutIcon, MapPinIcon, MonitorSmartphoneIcon, ReceiptTextIcon, TabletSmartphoneIcon, UsersIcon } from '@lucide/vue';

const session = sessionState();
const route = useRoute();
const role = computed(() => session.value.user?.role);
const orgName = computed(() => session.value.user?.orgName ?? 'Merchant');
const initials = computed(() => (session.value.user?.email ?? '?').slice(0, 2).toUpperCase());

const main = [
  { to: '/dashboard/overview', label: 'Overview', id: 'nav-overview', icon: LayoutDashboardIcon },
  { to: '/dashboard/reports', label: 'Reports', id: 'nav-reports', icon: ChartColumnIcon },
  { to: '/dashboard/archive', label: 'Archive', id: 'nav-archive', icon: ArchiveIcon },
  { to: '/dashboard/exports', label: 'Exports', id: 'nav-exports', icon: DownloadIcon },
];
const setup = computed(() =>
  [
    { to: '/dashboard/terminals', label: 'Terminals', id: 'nav-terminals', icon: TabletSmartphoneIcon, show: role.value !== 'accountant' },
    { to: '/dashboard/locations', label: 'Locations', id: 'nav-locations', icon: MapPinIcon, show: true },
    { to: '/dashboard/users', label: 'Users', id: 'nav-users', icon: UsersIcon, show: role.value === 'owner' },
    { to: '/dashboard/organisation', label: 'Organisation', id: 'nav-organisation', icon: BuildingIcon, show: true },
    { to: '/simulator', label: 'Simulator', id: 'nav-simulator', icon: MonitorSmartphoneIcon, show: role.value !== 'accountant' },
  ].filter((l) => l.show),
);

const PAGES: Record<string, string> = {
  overview: 'Overview',
  reports: 'Reports',
  archive: 'Archive',
  exports: 'Exports',
  terminals: 'Terminals',
  locations: 'Locations',
  users: 'Users',
  organisation: 'Organisation',
};
const crumbs = computed(() => {
  const section = route.path.split('/').filter(Boolean)[1];
  const label = (section && PAGES[section]) || 'Overview';
  const list: Array<{ label: string; to?: string }> = [{ label: orgName.value }];
  if (section === 'archive' && route.params.id) list.push({ label: 'Archive', to: '/dashboard/archive' }, { label: 'Receipt' });
  else list.push({ label });
  return list;
});
const isActive = (to: string) => route.path === to || route.path.startsWith(`${to}/`);

async function logout() {
  await $fetch<unknown>('/api/dashboard/logout', { method: 'POST' });
  session.value = { state: 'anonymous' };
  await navigateTo('/dashboard/login');
}
</script>

<template>
  <SidebarProvider>
    <Sidebar collapsible="icon" class="overflow-x-hidden">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" as-child>
              <NuxtLink to="/dashboard/overview" aria-label="Less Receipts">
                <div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"><ReceiptTextIcon class="size-4" /></div>
                <span class="text-base font-semibold tracking-tight">Less Receipts</span>
              </NuxtLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent class="overflow-x-hidden">
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem v-for="l in main" :key="l.to">
              <SidebarMenuButton as-child :tooltip="l.label" :is-active="isActive(l.to)">
                <NuxtLink :to="l.to" :data-testid="l.id"><component :is="l.icon" /><span>{{ l.label }}</span></NuxtLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem v-for="l in setup" :key="l.to">
              <SidebarMenuButton as-child :tooltip="l.label" :is-active="isActive(l.to)">
                <NuxtLink :to="l.to" :data-testid="l.id"><component :is="l.icon" /><span>{{ l.label }}</span></NuxtLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter class="overflow-x-hidden">
        <SidebarSeparator />
        <div class="flex items-center gap-2 px-2 py-1 group-data-[collapsible=icon]:hidden">
          <Avatar class="size-8"><AvatarFallback class="text-xs">{{ initials }}</AvatarFallback></Avatar>
          <div class="min-w-0 text-xs leading-4" data-testid="whoami">
            <div class="truncate text-sm font-medium">{{ session.user?.orgName }}</div>
            <div class="truncate text-muted-foreground">{{ session.user?.email }} ({{ role }})</div>
          </div>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Log out" data-testid="logout" @click="logout"><LogOutIcon /><span>Log out</span></SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
    <SidebarInset>
      <header class="flex h-16 shrink-0 items-center gap-2 px-2 group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <SidebarTrigger class="-ml-0.5" />
        <Separator orientation="vertical" class="mr-2 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center" />
        <Breadcrumb class="min-w-0">
          <BreadcrumbList>
            <template v-for="(c, i) in crumbs" :key="`${c.label}-${i}`">
              <BreadcrumbSeparator v-if="i > 0" />
              <BreadcrumbItem>
                <BreadcrumbPage v-if="i === crumbs.length - 1" class="block max-w-xs truncate">{{ c.label }}</BreadcrumbPage>
                <NuxtLink v-else-if="c.to" :to="c.to" class="transition-colors hover:text-foreground">{{ c.label }}</NuxtLink>
                <span v-else>{{ c.label }}</span>
              </BreadcrumbItem>
            </template>
          </BreadcrumbList>
        </Breadcrumb>
      </header>
      <main class="flex flex-1 flex-col gap-4 p-4 pt-0">
        <slot />
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>
