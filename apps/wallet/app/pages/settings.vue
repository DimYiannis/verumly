<script setup lang="ts">
import { Download, LogOut, Trash2 } from '@lucide/vue';
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
    <h1 class="text-h2 font-semibold">Instellingen</h1>
    <p v-if="wallet.session.value" class="text-text-secondary">Ingelogd als <strong class="font-medium text-foreground" data-testid="settings-email">{{ wallet.session.value.email }}</strong></p>

    <ConsentToggles v-model="consents" />
    <PushOptIn />
    <InstallHint />

    <section class="space-y-3 rounded-xl border border-border bg-card p-4" aria-labelledby="export-h">
      <h2 id="export-h" class="text-h3 font-semibold">Jouw gegevens</h2>
      <p class="text-sm text-text-secondary">Download al je bonnen en instellingen als JSON-bestand.</p>
      <Button type="button" variant="secondary" size="lg" class="w-full" data-testid="export-button" :disabled="busy" @click="exportData">
        <Download aria-hidden="true" />
        Exporteer mijn gegevens
      </Button>
    </section>

    <p v-if="error" role="alert" data-testid="settings-error" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ error }}</p>

    <Button type="button" variant="secondary" size="lg" class="w-full" data-testid="logout-button" :disabled="busy" @click="logout">
      <LogOut aria-hidden="true" />
      Uitloggen
    </Button>

    <section class="space-y-3 rounded-xl border border-danger-border bg-card p-4" aria-labelledby="delete-h">
      <h2 id="delete-h" class="text-h3 font-semibold text-danger">Account verwijderen</h2>
      <p class="text-sm text-text-secondary">Je account en je opgeslagen bonnen worden verwijderd. De winkels houden hun eigen administratie.</p>
      <Button v-if="!confirmDelete" type="button" variant="secondary" size="lg" class="w-full" data-testid="delete-account" @click="confirmDelete = true">Account verwijderen…</Button>
      <div v-else class="space-y-2" role="alertdialog" aria-label="Bevestig verwijderen">
        <p class="font-medium">Weet je het zeker? Dit kan niet ongedaan worden gemaakt.</p>
        <Button type="button" variant="destructive" size="lg" class="w-full" data-testid="confirm-delete" :disabled="busy" @click="deleteAccount">
          <Trash2 aria-hidden="true" />
          Ja, verwijder alles
        </Button>
        <Button type="button" variant="secondary" size="lg" class="w-full" @click="confirmDelete = false">Annuleren</Button>
      </div>
    </section>
  </div>
</template>
