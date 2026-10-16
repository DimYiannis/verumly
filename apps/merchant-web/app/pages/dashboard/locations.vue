<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Loc { id: string; name: string; address: string | null; postcode: string | null }
const session = sessionState();
const canWrite = computed(() => session.value.user?.role !== 'accountant');
const rows = ref<Loc[]>([]);
const error = ref('');
const draft = reactive({ name: '', address: '', postcode: '' });
const editing = ref<string | null>(null);
const edit = reactive({ name: '', address: '', postcode: '' });

const body = (v: { name: string; address: string; postcode: string }) => ({ name: v.name, address: v.address || null, postcode: v.postcode || null });

async function load() {
  const r = await attempt(error, () => $fetch<Loc[]>('/api/dashboard/locations'));
  if (r) rows.value = r;
}
onMounted(load);

async function add() {
  if (await attempt(error, () => $fetch<unknown>('/api/dashboard/locations', { method: 'POST', body: body(draft) }))) {
    Object.assign(draft, { name: '', address: '', postcode: '' });
    await load();
  }
}
function startEdit(l: Loc) {
  editing.value = l.id;
  Object.assign(edit, { name: l.name, address: l.address ?? '', postcode: l.postcode ?? '' });
}
async function saveEdit(id: string) {
  if (await attempt(error, () => $fetch<unknown>(`/api/dashboard/locations/${id}`, { method: 'PUT', body: body(edit) }))) {
    editing.value = null;
    await load();
  }
}
async function remove(id: string) {
  if (await attempt(error, () => $fetch<unknown>(`/api/dashboard/locations/${id}`, { method: 'DELETE' }))) await load();
}
</script>

<template>
  <h1 class="mb-4 text-xl font-semibold">Locations</h1>
  <p v-if="error" class="mb-3 text-sm text-red-700" role="alert" data-testid="error">{{ error }}</p>
  <table class="w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
    <thead class="bg-slate-100 text-left"><tr><th class="p-2">Name</th><th class="p-2">Address</th><th class="p-2">Postcode</th><th class="p-2" /></tr></thead>
    <tbody>
      <tr v-for="l in rows" :key="l.id" class="border-t border-slate-100" data-testid="location-row">
        <template v-if="editing === l.id">
          <td class="p-2"><input v-model="edit.name" class="w-full rounded border border-slate-300 px-2 py-1" data-testid="location-edit-name" /></td>
          <td class="p-2"><input v-model="edit.address" class="w-full rounded border border-slate-300 px-2 py-1" /></td>
          <td class="p-2"><input v-model="edit.postcode" class="w-28 rounded border border-slate-300 px-2 py-1" /></td>
          <td class="space-x-2 p-2 text-right"><button class="text-slate-900 underline" data-testid="location-save" @click="saveEdit(l.id)">Save</button><button class="text-slate-500" @click="editing = null">Cancel</button></td>
        </template>
        <template v-else>
          <td class="p-2">{{ l.name }}</td><td class="p-2">{{ l.address }}</td><td class="p-2">{{ l.postcode }}</td>
          <td v-if="canWrite" class="space-x-3 p-2 text-right"><button class="underline" data-testid="location-edit" @click="startEdit(l)">Edit</button><button class="text-red-700 underline" data-testid="location-delete" @click="remove(l.id)">Delete</button></td>
          <td v-else />
        </template>
      </tr>
    </tbody>
  </table>
  <form v-if="canWrite" class="mt-5 flex max-w-3xl flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4" @submit.prevent="add">
    <label class="text-sm">Name<input v-model="draft.name" required data-testid="location-name" class="mt-1 block rounded border border-slate-300 px-3 py-2" /></label>
    <label class="text-sm">Address<input v-model="draft.address" data-testid="location-address" class="mt-1 block rounded border border-slate-300 px-3 py-2" /></label>
    <label class="text-sm">Postcode<input v-model="draft.postcode" placeholder="1011AB" data-testid="location-postcode" class="mt-1 block w-28 rounded border border-slate-300 px-3 py-2" /></label>
    <button data-testid="location-add" class="rounded bg-slate-900 px-4 py-2 text-white">Add location</button>
  </form>
</template>
