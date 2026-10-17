<script setup lang="ts">
import { PlusIcon } from '@lucide/vue';

definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface U { id: string; email: string; role: Role; mfaEnrolled: boolean }
const { t, tx } = useLocale();
const rows = ref<U[]>([]);
const error = ref('');
const form = reactive<{ email: string; password: string; role: Role }>({ email: '', password: '', role: 'manager' });
const session = sessionState();
const ROLES: Role[] = ['owner', 'manager', 'accountant'];

const initials = (email: string) =>
  (email.split('@')[0] ?? '')
    .split(/[._-]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('') || email.slice(0, 2).toUpperCase();

function focusForm() {
  const el = document.getElementById('user-new-email');
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el?.focus({ preventScroll: true });
}

async function load() {
  const r = await attempt(error, () => $fetch<U[]>('/api/dashboard/users'));
  if (r) rows.value = r;
}
onMounted(load);

async function add() {
  if (await attempt(error, () => $fetch<unknown>('/api/dashboard/users', { method: 'POST', body: { ...form } }))) {
    form.email = '';
    form.password = '';
    await load();
  }
}
async function setRole(u: U, role: string | undefined) {
  await attempt(error, () => $fetch<unknown>(`/api/dashboard/users/${u.id}`, { method: 'PATCH', body: { role } }));
  await load();
}
async function remove(u: U) {
  if (await attempt(error, () => $fetch<unknown>(`/api/dashboard/users/${u.id}`, { method: 'DELETE' }))) await load();
}
async function resetTotp(u: U) {
  if (await attempt(error, () => $fetch<unknown>(`/api/dashboard/users/${u.id}/reset-totp`, { method: 'POST' }))) await load();
}
</script>

<template>
  <AppPageHeading :title="t('adm.users.title')" :description="t('adm.users.subtitle')">
    <Button data-testid="user-invite" @click="focusForm"><PlusIcon />{{ t('adm.users.invite') }}</Button>
  </AppPageHeading>
  <AppErrorNote v-if="error" data-testid="error">{{ error }}</AppErrorNote>

  <div class="grid gap-3 md:grid-cols-3">
    <Card v-for="r in ROLES" :key="r" size="sm">
      <CardContent class="space-y-2">
        <Badge :variant="r === 'owner' ? 'accent' : 'neutral'" class="capitalize">{{ tx('role', r) }}</Badge>
        <p class="text-sm text-muted-foreground">{{ t(`adm.users.${r}`) }}</p>
      </CardContent>
    </Card>
  </div>

  <Card>
    <CardContent>
      <div class="overflow-hidden rounded-md border">
        <Table>
          <TableHeader class="bg-muted [&_th]:text-xs [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-text-secondary">
            <TableRow class="hover:bg-muted"><TableHead class="px-4">{{ t('adm.users.person') }}</TableHead><TableHead>{{ t('common.role') }}</TableHead><TableHead>{{ t('adm.users.twoStep') }}</TableHead><TableHead class="px-4" /></TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="u in rows" :key="u.id" class="h-[52px]" data-testid="user-row">
              <TableCell class="px-4">
                <div class="flex items-center gap-3">
                  <Avatar><AvatarFallback class="text-xs">{{ initials(u.email) }}</AvatarFallback></Avatar>
                  <span class="font-medium" data-testid="user-email">{{ u.email }}</span>
                </div>
              </TableCell>
              <TableCell><Badge :variant="u.role === 'owner' ? 'accent' : 'neutral'" class="capitalize">{{ tx('role', u.role) }}</Badge></TableCell>
              <TableCell><Badge :variant="u.mfaEnrolled ? 'success' : 'warning'">{{ u.mfaEnrolled ? tx('status', 'enrolled') : t('users.notYet') }}</Badge></TableCell>
              <TableCell class="px-4">
                <div class="flex items-center justify-end gap-1">
                  <AppNativeSelect :model-value="u.role" class="w-36" :aria-label="t('adm.users.changeRole')" :title="t('adm.users.changeRole')" data-testid="user-role" @update:model-value="setRole(u, $event)">
                    <option v-for="r in ROLES" :key="r" :value="r">{{ tx('role', r) }}</option>
                  </AppNativeSelect>
                  <Button variant="outline" size="sm" data-testid="user-reset-totp" @click="resetTotp(u)">{{ t('adm.users.resetCode') }}</Button>
                  <Button v-if="u.email !== session.user?.email" variant="ghost" size="sm" class="text-danger hover:text-danger" data-testid="user-delete" @click="remove(u)">{{ t('common.delete') }}</Button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </CardContent>
  </Card>

  <Card>
    <form @submit.prevent="add">
      <CardHeader><CardTitle class="text-base">{{ t('users.add') }}</CardTitle></CardHeader>
      <CardContent class="mt-4 grid gap-6 sm:grid-cols-3">
        <div class="space-y-2"><Label for="user-new-email">{{ t('common.email') }}</Label><Input id="user-new-email" v-model="form.email" type="email" required data-testid="user-new-email" /></div>
        <div class="space-y-2">
          <Label for="user-new-password">{{ t('users.initialPassword') }}</Label>
          <Input id="user-new-password" v-model="form.password" type="password" minlength="12" required autocomplete="new-password" data-testid="user-new-password" />
          <p class="text-xs text-muted-foreground">{{ t('users.passwordHelp') }}</p>
        </div>
        <div class="space-y-2">
          <Label for="user-new-role">{{ t('common.role') }}</Label>
          <AppNativeSelect id="user-new-role" v-model="form.role" data-testid="user-new-role"><option v-for="r in ROLES" :key="r" :value="r">{{ tx('role', r) }}</option></AppNativeSelect>
        </div>
      </CardContent>
      <CardFooter class="mt-6 justify-end"><Button data-testid="user-create">{{ t('users.addButton') }}</Button></CardFooter>
    </form>
  </Card>
</template>
