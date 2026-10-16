<script setup lang="ts">
import { ApiError } from '~/utils/api';
import type { Consents } from '~/utils/api-schemas';

definePageMeta({ middleware: 'auth' });
useHead({ title: 'Preferences' });

const wallet = useWallet();
const consents = ref<Consents>({ analytics: false, marketing: false, push: false });
const loadError = ref<string | null>(null);

onMounted(async () => {
  try {
    consents.value = (await wallet.api.getConsents()).consents;
  } catch (e) {
    loadError.value = e instanceof ApiError && e.isNetwork ? 'Offline: preferences cannot be loaded right now.' : 'Loading preferences failed.';
  }
});

async function finish() {
  await wallet.kv.set('onboarded', true);
  await navigateTo('/');
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-bold">Welcome</h1>
    <p>You are logged in. Everything below is optional and off by default.</p>
    <p v-if="loadError" role="alert" class="text-red-800">{{ loadError }}</p>
    <ConsentToggles v-model="consents" />
    <PushOptIn />
    <InstallHint />
    <button type="button" class="btn btn-primary w-full" data-testid="onboarding-done" @click="finish">Done</button>
  </div>
</template>
