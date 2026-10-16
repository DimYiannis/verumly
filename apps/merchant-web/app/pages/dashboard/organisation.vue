<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Org { legalName: string; kvkNumber: string; vatNumber: string | null; retentionYears: number }
const session = sessionState();
const canWrite = computed(() => session.value.user?.role === 'owner');
const form = reactive<Org>({ legalName: '', kvkNumber: '', vatNumber: null, retentionYears: 7 });
const error = ref('');
const saved = ref(false);

onMounted(async () => {
  const o = await attempt(error, () => $fetch<Org>('/api/dashboard/org'));
  if (o) Object.assign(form, o);
});

async function save() {
  saved.value = false;
  const o = await attempt(error, () =>
    $fetch<Org>('/api/dashboard/org', { method: 'PUT', body: { legalName: form.legalName, kvkNumber: form.kvkNumber, vatNumber: form.vatNumber || null, retentionYears: Number(form.retentionYears) } }),
  );
  if (o) {
    Object.assign(form, o);
    saved.value = true;
  }
}
</script>

<template>
  <h1 class="mb-4 text-xl font-semibold">Organisation</h1>
  <form class="max-w-lg space-y-3 rounded-lg border border-slate-200 bg-white p-5" @submit.prevent="save">
    <label class="block text-sm">Legal name
      <input v-model="form.legalName" :disabled="!canWrite" required data-testid="org-legal-name" class="mt-1 w-full rounded border border-slate-300 px-3 py-2 disabled:bg-slate-100" />
    </label>
    <label class="block text-sm">KvK number (8 digits)
      <input v-model="form.kvkNumber" :disabled="!canWrite" required pattern="\d{8}" data-testid="org-kvk" class="mt-1 w-full rounded border border-slate-300 px-3 py-2 disabled:bg-slate-100" />
    </label>
    <label class="block text-sm">BTW-id (NL123456789B01)
      <input v-model="form.vatNumber" :disabled="!canWrite" pattern="NL\d{9}B\d{2}" placeholder="optional" data-testid="org-vat" class="mt-1 w-full rounded border border-slate-300 px-3 py-2 disabled:bg-slate-100" />
    </label>
    <label class="block text-sm">Retention (years, minimum 7)
      <input v-model.number="form.retentionYears" :disabled="!canWrite" type="number" min="7" max="25" required data-testid="org-retention" class="mt-1 w-full rounded border border-slate-300 px-3 py-2 disabled:bg-slate-100" />
    </label>
    <button v-if="canWrite" data-testid="org-save" class="rounded bg-slate-900 px-4 py-2 text-white">Save</button>
    <p v-else class="text-sm text-slate-500">Only owners can change organisation settings.</p>
    <p v-if="saved" class="text-sm text-green-700" data-testid="org-saved">Saved.</p>
    <p v-if="error" class="text-sm text-red-700" role="alert" data-testid="error">{{ error }}</p>
  </form>
</template>
