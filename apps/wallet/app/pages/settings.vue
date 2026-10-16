<script setup lang="ts">
import { Download, Languages, LogOut, Trash2 } from '@lucide/vue';
import type { MessageKey } from '~/i18n';
import { ApiError } from '~/utils/api';
import type { Consents } from '~/utils/api-schemas';

definePageMeta({ middleware: 'auth' });
const { t } = useLocale();
useHead({ title: () => t('settings.title') });

const wallet = useWallet();
const consents = ref<Consents>({ analytics: false, marketing: false, push: false });
const error = ref<MessageKey | null>(null);
const busy = ref(false);
const confirmDelete = ref(false);

onMounted(async () => {
  try {
    consents.value = (await wallet.api.getConsents()).consents;
  } catch {
    error.value = 'settings.err.load';
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
    error.value = e instanceof ApiError && e.isNetwork ? 'settings.err.exportOffline' : 'settings.err.exportFailed';
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
    error.value = e instanceof ApiError && e.isNetwork ? 'settings.err.deleteOffline' : 'settings.err.deleteFailed';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-h2 font-semibold">{{ t('settings.title') }}</h1>
    <p v-if="wallet.session.value" class="text-text-secondary">{{ t('settings.loggedInAs') }}<strong class="font-medium text-foreground" data-testid="settings-email">{{ wallet.session.value.email }}</strong></p>

    <section class="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4" aria-labelledby="locale-h" data-testid="locale-row">
      <div class="min-w-0">
        <h2 id="locale-h" class="flex items-center gap-2 text-h3 font-semibold">
          <Languages class="size-4 text-muted-foreground" aria-hidden="true" />
          {{ t('locale.row') }}
        </h2>
        <p class="mt-0.5 text-sm text-text-secondary">{{ t('locale.rowHint') }}</p>
      </div>
      <LocaleSwitch class="shrink-0" />
    </section>

    <ConsentToggles v-model="consents" />
    <PushOptIn />
    <InstallHint />

    <section class="space-y-3 rounded-xl border border-border bg-card p-4" aria-labelledby="export-h">
      <h2 id="export-h" class="text-h3 font-semibold">{{ t('settings.dataTitle') }}</h2>
      <p class="text-sm text-text-secondary">{{ t('settings.dataBody') }}</p>
      <Button type="button" variant="secondary" size="lg" class="w-full" data-testid="export-button" :disabled="busy" @click="exportData">
        <Download aria-hidden="true" />
        {{ t('settings.export') }}
      </Button>
    </section>

    <p v-if="error" role="alert" data-testid="settings-error" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ t(error) }}</p>

    <Button type="button" variant="secondary" size="lg" class="w-full" data-testid="logout-button" :disabled="busy" @click="logout">
      <LogOut aria-hidden="true" />
      {{ t('settings.logout') }}
    </Button>

    <section class="space-y-3 rounded-xl border border-danger-border bg-card p-4" aria-labelledby="delete-h">
      <h2 id="delete-h" class="text-h3 font-semibold text-danger">{{ t('settings.deleteTitle') }}</h2>
      <p class="text-sm text-text-secondary">{{ t('settings.deleteBody') }}</p>
      <Button v-if="!confirmDelete" type="button" variant="secondary" size="lg" class="w-full" data-testid="delete-account" @click="confirmDelete = true">{{ t('settings.deleteStart') }}</Button>
      <div v-else class="space-y-2" role="alertdialog" :aria-label="t('settings.deleteDialog')">
        <p class="font-medium">{{ t('settings.deleteSure') }}</p>
        <Button type="button" variant="destructive" size="lg" class="w-full" data-testid="confirm-delete" :disabled="busy" @click="deleteAccount">
          <Trash2 aria-hidden="true" />
          {{ t('settings.deleteConfirm') }}
        </Button>
        <Button type="button" variant="secondary" size="lg" class="w-full" @click="confirmDelete = false">{{ t('settings.cancel') }}</Button>
      </div>
    </section>
  </div>
</template>
