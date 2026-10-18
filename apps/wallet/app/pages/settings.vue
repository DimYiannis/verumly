<script setup lang="ts">
import { Download, Languages, LogOut, Trash2 } from '@lucide/vue';
import type { MessageKey } from '~/i18n';
import { ApiError } from '~/utils/api';
import type { Consents } from '~/utils/api-schemas';

definePageMeta({ middleware: 'auth' });
const { t } = useLocale();
useHead({ title: () => t('settings.title') });

const wallet = useWallet();
const { profile, name, load: loadProfile, reset: resetProfile } = useProfile();
onMounted(() => void loadProfile());
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
  resetProfile();
  await navigateTo('/');
}

async function deleteAccount() {
  busy.value = true;
  error.value = null;
  try {
    await wallet.api.deleteAccount();
    await wallet.forgetProfile();
    await wallet.endSession();
    resetProfile();
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
    <section v-if="wallet.session.value" class="flex items-center gap-4 rounded-xl border border-border bg-card p-4" data-testid="settings-profile">
      <HomeAvatar :name="name || '?'" :emoji="profile?.avatar ?? null" size="lg" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-h3 font-semibold">{{ profile?.displayName ?? name }}</p>
        <p v-if="profile?.handle" class="font-mono text-small text-muted-foreground">@{{ profile.handle }}</p>
        <p class="truncate text-xs text-muted-foreground"><span class="sr-only">{{ t('settings.loggedInAs') }}</span><span data-testid="settings-email">{{ wallet.session.value.email }}</span></p>
      </div>
      <Button as-child variant="secondary" size="sm"><NuxtLink to="/friends" class="no-underline">{{ t('home.settings.edit') }}</NuxtLink></Button>
    </section>

    <h2 class="pt-2 text-label text-text-secondary uppercase">{{ t('home.settings.app') }}</h2>

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

    <PushOptIn />
    <InstallHint />

    <h2 class="pt-2 text-label text-text-secondary uppercase">{{ t('home.settings.privacy') }}</h2>
    <ConsentToggles v-model="consents" />

    <section class="space-y-3 rounded-xl border border-border bg-card p-4" aria-labelledby="export-h">
      <h2 id="export-h" class="text-h3 font-semibold">{{ t('settings.dataTitle') }}</h2>
      <p class="text-sm text-text-secondary">{{ t('settings.dataBody') }}</p>
      <Button type="button" variant="secondary" size="lg" class="w-full" data-testid="export-button" :disabled="busy" @click="exportData">
        <Download aria-hidden="true" />
        {{ t('settings.export') }}
      </Button>
    </section>

    <p v-if="error" role="alert" data-testid="settings-error" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ t(error) }}</p>

    <h2 class="pt-2 text-label text-text-secondary uppercase">{{ t('home.settings.account') }}</h2>
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
