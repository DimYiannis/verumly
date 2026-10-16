<script setup lang="ts">
import { ApiError } from '~/utils/api';
import type { Consents } from '~/utils/api-schemas';

definePageMeta({ middleware: 'auth' });
useHead({ title: 'Instellingen' });

const wallet = useWallet();
const consents = ref<Consents>({ analytics: false, marketing: false, push: false });
const error = ref<string | null>(null);
const busy = ref(false);
const confirmDelete = ref(false);

onMounted(async () => {
  try {
    consents.value = (await wallet.api.getConsents()).consents;
  } catch {
    error.value = 'Voorkeuren laden is niet gelukt (offline?).';
  }
});

async function exportData() {
  busy.value = true;
  error.value = null;
  try {
    const url = URL.createObjectURL(await wallet.api.exportData());
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mijn-bonnen.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (e) {
    error.value = e instanceof ApiError && e.isNetwork ? 'Exporteren kan alleen online.' : 'Exporteren is niet gelukt.';
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
    error.value = e instanceof ApiError && e.isNetwork ? 'Account verwijderen kan alleen online.' : 'Account verwijderen is niet gelukt.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-bold">Instellingen</h1>
    <p v-if="wallet.session.value" class="text-slate-800">Ingelogd als <strong data-testid="settings-email">{{ wallet.session.value.email }}</strong></p>

    <ConsentToggles v-model="consents" />
    <PushOptIn />
    <InstallHint />

    <section class="card space-y-2" aria-labelledby="export-h">
      <h2 id="export-h" class="font-semibold">Jouw gegevens</h2>
      <p class="text-sm text-slate-800">Download al je bonnen en instellingen als JSON-bestand.</p>
      <button type="button" class="btn btn-secondary w-full" data-testid="export-button" :disabled="busy" @click="exportData">Exporteer mijn gegevens</button>
    </section>

    <p v-if="error" role="alert" data-testid="settings-error" class="rounded-xl bg-red-50 p-3 text-red-900">{{ error }}</p>

    <button type="button" class="btn btn-secondary w-full" data-testid="logout-button" :disabled="busy" @click="logout">Uitloggen</button>

    <section class="card space-y-2 border-red-300" aria-labelledby="delete-h">
      <h2 id="delete-h" class="font-semibold text-red-900">Account verwijderen</h2>
      <p class="text-sm text-slate-800">Je account en je opgeslagen bonnen worden verwijderd. De winkels houden hun eigen administratie.</p>
      <button v-if="!confirmDelete" type="button" class="btn btn-secondary w-full" data-testid="delete-account" @click="confirmDelete = true">Account verwijderen…</button>
      <div v-else class="space-y-2" role="alertdialog" aria-label="Bevestig verwijderen">
        <p class="font-semibold">Weet je het zeker? Dit kan niet ongedaan worden gemaakt.</p>
        <button type="button" class="btn w-full bg-red-700 text-white hover:bg-red-900" data-testid="confirm-delete" :disabled="busy" @click="deleteAccount">Ja, verwijder alles</button>
        <button type="button" class="btn btn-secondary w-full" @click="confirmDelete = false">Annuleren</button>
      </div>
    </section>
  </div>
</template>
