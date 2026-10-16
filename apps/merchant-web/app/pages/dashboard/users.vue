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
async function setRole(u: U, role: string) {
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
  <h1 class="mb-1 text-xl font-semibold">Users &amp; roles</h1>
  <p class="mb-4 text-sm text-slate-600">Owner: everything. Manager: locations and terminals, no settings or users. Accountant: read-only, can request exports.</p>
  <p v-if="error" class="mb-3 text-sm text-red-700" role="alert" data-testid="error">{{ error }}</p>
  <table class="w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
    <thead class="bg-slate-100 text-left"><tr><th class="p-2">Email</th><th class="p-2">Role</th><th class="p-2">Authenticator</th><th class="p-2" /></tr></thead>
    <tbody>
      <tr v-for="u in rows" :key="u.id" class="border-t border-slate-100" data-testid="user-row">
        <td class="p-2" data-testid="user-email">{{ u.email }}</td>
        <td class="p-2">
          <select :value="u.role" data-testid="user-role" class="rounded border border-slate-300 px-2 py-1" @change="setRole(u, ($event.target as HTMLSelectElement).value)">
            <option value="owner">owner</option><option value="manager">manager</option><option value="accountant">accountant</option>
          </select>
        </td>
        <td class="p-2">{{ u.mfaEnrolled ? 'enrolled' : 'not yet' }}</td>
        <td class="space-x-3 p-2 text-right">
          <button class="underline" data-testid="user-reset-totp" @click="resetTotp(u)">Reset authenticator</button>
          <button v-if="u.email !== session.user?.email" class="text-red-700 underline" data-testid="user-delete" @click="remove(u)">Delete</button>
        </td>
      </tr>
    </tbody>
  </table>
  <form class="mt-6 flex max-w-3xl flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4" @submit.prevent="add">
    <label class="text-sm">Email<input v-model="form.email" type="email" required data-testid="user-new-email" class="mt-1 block rounded border border-slate-300 px-3 py-2" /></label>
    <label class="text-sm">Initial password (min 12)<input v-model="form.password" type="password" minlength="12" required autocomplete="new-password" data-testid="user-new-password" class="mt-1 block rounded border border-slate-300 px-3 py-2" /></label>
    <label class="text-sm">Role
      <select v-model="form.role" data-testid="user-new-role" class="mt-1 block rounded border border-slate-300 px-3 py-2"><option>owner</option><option>manager</option><option>accountant</option></select>
    </label>
    <button data-testid="user-create" class="rounded bg-slate-900 px-4 py-2 text-white">Add user</button>
  </form>
</template>
