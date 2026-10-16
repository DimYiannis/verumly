<script setup lang="ts">
import { ApiError } from '~/utils/api';
import type { Consents } from '~/utils/api-schemas';

definePageMeta({ middleware: 'auth' });
useHead({ title: 'Settings' });

const wallet = useWallet();
const consents = ref<Consents>({ analytics: false, marketing: false, push: false });
const error = ref<string | null>(null);
const busy = ref(false);
const confirmDelete = ref(false);

onMounted(async () => {
  try {
    consents.value = (await wallet.api.getConsents()).consents;
  } catch {
    error.value = 'Loading preferences failed (offline?).';
  }
});

async function exportData() {
  busy.value = true;
  error.value = null;
  try {
    const url = URL.createObjectURL(await wallet.api.exportData());
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my-receipts.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (e) {
    error.value = e instanceof ApiError && e.isNetwork ? 'Exporting is only possible online.' : 'Exporting failed.';
  } finally {
    busy.value = false;
  }
}

async function logout() {
  busy.value = true;
  await wallet.logout();
  await navigateTo('/');
}

async function deleteAccount() {
  busy.value = true;
  error.value = null;
  try {
    await wallet.api.deleteAccount();
    await wallet.endSession();
    await wallet.cache.clear();
    for (const c of [...wallet.pending.value, ...wallet.closed.value]) await wallet.claims.remove(c.receiptId);
    await wallet.refreshPending();
    await navigateTo('/');
  } catch (e) {
    error.value = e instanceof ApiError && e.isNetwork ? 'Deleting your account is only possible online.' : 'Deleting your account failed.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-bold">Settings</h1>
    <p v-if="wallet.session.value" class="text-slate-800">Logged in as <strong data-testid="settings-email">{{ wallet.session.value.email }}</strong></p>

    <ConsentToggles v-model="consents" />
    <PushOptIn />
    <InstallHint />

    <section class="card space-y-2" aria-labelledby="export-h">
      <h2 id="export-h" class="font-semibold">Your data</h2>
      <p class="text-sm text-slate-800">Download all your receipts and settings as a JSON file.</p>
      <button type="button" class="btn btn-secondary w-full" data-testid="export-button" :disabled="busy" @click="exportData">Export my data</button>
    </section>

    <p v-if="error" role="alert" data-testid="settings-error" class="rounded-xl bg-red-50 p-3 text-red-900">{{ error }}</p>

    <button type="button" class="btn btn-secondary w-full" data-testid="logout-button" :disabled="busy" @click="logout">Log out</button>

    <section class="card space-y-2 border-red-300" aria-labelledby="delete-h">
      <h2 id="delete-h" class="font-semibold text-red-900">Delete account</h2>
      <p class="text-sm text-slate-800">Your account and your saved receipts will be deleted. Shops keep their own records.</p>
      <button v-if="!confirmDelete" type="button" class="btn btn-secondary w-full" data-testid="delete-account" @click="confirmDelete = true">Delete account…</button>
      <div v-else class="space-y-2" role="alertdialog" aria-label="Confirm deletion">
        <p class="font-semibold">Are you sure? This cannot be undone.</p>
        <button type="button" class="btn w-full bg-red-700 text-white hover:bg-red-900" data-testid="confirm-delete" :disabled="busy" @click="deleteAccount">Yes, delete everything</button>
        <button type="button" class="btn btn-secondary w-full" @click="confirmDelete = false">Cancel</button>
      </div>
    </section>
  </div>
</template>
