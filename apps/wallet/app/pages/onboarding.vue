<script setup lang="ts">
import type { MessageKey } from '~/i18n';
import { ApiError } from '~/utils/api';
import type { Consents } from '~/utils/api-schemas';

definePageMeta({ middleware: 'auth' });
const { t } = useLocale();
useHead({ title: () => t('onboarding.pageTitle') });

const wallet = useWallet();
const consents = ref<Consents>({ analytics: false, marketing: false, push: false });
const loadError = ref<MessageKey | null>(null);

onMounted(async () => {
  try {
    consents.value = (await wallet.api.getConsents()).consents;
  } catch (e) {
    loadError.value = e instanceof ApiError && e.isNetwork ? 'onboarding.err.offline' : 'onboarding.err.failed';
  }
});

async function finish() {
  await wallet.kv.set('onboarded', true);
  await navigateTo('/');
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-h1 font-semibold">{{ t('onboarding.title') }}</h1>
    <p class="text-text-secondary">{{ t('onboarding.body') }}</p>
    <p v-if="loadError" role="alert" class="text-sm text-danger">{{ t(loadError) }}</p>
    <ConsentToggles v-model="consents" />
    <PushOptIn />
    <InstallHint />
    <Button type="button" size="lg" class="w-full" data-testid="onboarding-done" @click="finish">{{ t('onboarding.done') }}</Button>
  </div>
</template>
