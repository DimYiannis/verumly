<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface U { id: string; email: string; role: Role; mfaEnrolled: boolean }
const rows = ref<U[]>([]);
const error = ref('');
const form = reactive<{ email: string; password: string; role: Role }>({ email: '', password: '', role: 'manager' });
const session = sessionState();

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
  <AppPageHeading title="Users" description="Owner: everything. Manager: locations and terminals, no settings or users. Accountant: read-only, can request exports." />
  <AppErrorNote v-if="error" data-testid="error">{{ error }}</AppErrorNote>

  <Card>
    <CardContent>
      <div class="overflow-hidden rounded-md border">
        <Table>
          <TableHeader class="bg-muted [&_th]:text-xs [&_th]:font-medium [&_th]:text-text-secondary">
            <TableRow class="hover:bg-muted"><TableHead class="px-4">Email</TableHead><TableHead>Role</TableHead><TableHead>Authenticator</TableHead><TableHead class="px-4" /></TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="u in rows" :key="u.id" class="h-[52px]" data-testid="user-row">
              <TableCell class="px-4 font-medium" data-testid="user-email">{{ u.email }}</TableCell>
              <TableCell>
                <AppNativeSelect :model-value="u.role" class="w-36" aria-label="Role" data-testid="user-role" @update:model-value="setRole(u, $event)">
                  <option value="owner">owner</option><option value="manager">manager</option><option value="accountant">accountant</option>
                </AppNativeSelect>
              </TableCell>
              <TableCell><Badge :variant="u.mfaEnrolled ? 'success' : 'neutral'">{{ u.mfaEnrolled ? 'enrolled' : 'not yet' }}</Badge></TableCell>
              <TableCell class="space-x-1 px-4 text-right">
                <Button variant="ghost" data-testid="user-reset-totp" @click="resetTotp(u)">Reset authenticator</Button>
                <Button v-if="u.email !== session.user?.email" variant="ghost" class="text-danger hover:text-danger" data-testid="user-delete" @click="remove(u)">Delete</Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </CardContent>
  </Card>

  <Card>
    <form @submit.prevent="add">
      <CardHeader><CardTitle class="text-base">Add a user</CardTitle></CardHeader>
      <CardContent class="mt-4 grid gap-6 sm:grid-cols-3">
        <div class="space-y-2"><Label for="user-new-email">Email</Label><Input id="user-new-email" v-model="form.email" type="email" required data-testid="user-new-email" /></div>
        <div class="space-y-2">
          <Label for="user-new-password">Initial password</Label>
          <Input id="user-new-password" v-model="form.password" type="password" minlength="12" required autocomplete="new-password" data-testid="user-new-password" />
          <p class="text-xs text-muted-foreground">At least 12 characters.</p>
        </div>
        <div class="space-y-2">
          <Label for="user-new-role">Role</Label>
          <AppNativeSelect id="user-new-role" v-model="form.role" data-testid="user-new-role"><option>owner</option><option>manager</option><option>accountant</option></AppNativeSelect>
        </div>
      </CardContent>
      <CardFooter class="mt-6 justify-end"><Button data-testid="user-create">Add user</Button></CardFooter>
    </form>
  </Card>
</template>
