<script setup lang="ts">
import { ApiError } from '~/utils/api';
import type { Consents } from '~/utils/api-schemas';

definePageMeta({ middleware: 'auth' });
useHead({ title: 'Voorkeuren' });

const wallet = useWallet();
const consents = ref<Consents>({ analytics: false, marketing: false, push: false });
const loadError = ref<string | null>(null);

onMounted(async () => {
  try {
    consents.value = (await wallet.api.getConsents()).consents;
  } catch (e) {
    loadError.value = e instanceof ApiError && e.isNetwork ? 'Offline: voorkeuren zijn nu niet te laden.' : 'Voorkeuren laden is niet gelukt.';
  }
});

async function finish() {
  await wallet.kv.set('onboarded', true);
  await navigateTo('/');
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-h1 font-semibold">Welkom</h1>
    <p class="text-text-secondary">Je bent ingelogd. Alles hieronder is optioneel en staat standaard uit.</p>
    <p v-if="loadError" role="alert" class="text-sm text-danger">{{ loadError }}</p>
    <ConsentToggles v-model="consents" />
    <PushOptIn />
    <InstallHint />
    <Button type="button" size="lg" class="w-full" data-testid="onboarding-done" @click="finish">Klaar</Button>
  </div>
</template>
