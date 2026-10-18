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
const TOTAL = 3;
const step = ref(1);

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
  <div class="flex min-h-[calc(100dvh-9rem)] flex-col justify-between gap-6">
    <div class="space-y-6">
      <div class="flex justify-end">
        <button type="button" class="min-h-11 px-1 text-sm font-medium text-primary" data-testid="onboarding-skip" @click="finish">{{ t('home.onb.skip') }}</button>
      </div>

      <div v-if="step === 1" class="space-y-6" data-testid="onboarding-step-1">
        <div class="relative mx-auto h-[260px] w-[260px]" aria-hidden="true">
          <div class="absolute top-4 left-7 w-[200px] -rotate-3 rounded-lg border border-border bg-card p-3 font-mono text-xs shadow-sm">
            <p class="text-center font-sans text-h3 font-semibold">Café Het Plein</p>
            <hr class="my-2 border-dashed border-border" />
            <p class="flex justify-between"><span>2 × Koffie</span><span>€6,80</span></p>
            <p class="flex justify-between"><span>1 × Bier</span><span>€3,89</span></p>
            <hr class="my-2 border-dashed border-border" />
            <p class="flex justify-between font-semibold"><span>Total</span><span>€10,69</span></p>
          </div>
          <div class="absolute right-0 bottom-4 size-24 rounded-lg border border-border bg-white p-2 shadow-md">
            <div class="size-full rounded-sm" style="background: repeating-conic-gradient(#14152b 0 25%, #fff 0 50%) 0 0 / 16px 16px" />
          </div>
        </div>
      </div>

      <div v-else-if="step === 2" class="space-y-6" data-testid="onboarding-step-2">
        <div class="mx-auto flex h-[260px] w-[260px] items-center justify-center" aria-hidden="true">
          <div class="w-[190px] rotate-2 space-y-2 rounded-xl border border-border bg-card p-3 shadow-md">
            <span class="block text-label text-text-secondary uppercase">{{ t('home.onb.split') }}</span>
            <div class="flex items-center gap-2"><HomeAvatar name="Sam" size="sm" /><HomeAvatar name="Anna" size="sm" class="-ml-3" /><span class="font-mono text-sm">€5,35</span></div>
          </div>
        </div>
      </div>

      <div v-else class="space-y-4" data-testid="onboarding-step-3">
        <div class="space-y-2">
          <h1 class="text-h1 font-semibold">{{ t('home.onb.3.title') }}</h1>
          <p class="text-text-secondary">{{ t('home.onb.3.body') }}</p>
        </div>
        <p v-if="loadError" role="alert" class="text-sm text-danger">{{ t(loadError) }}</p>
        <ConsentToggles v-model="consents" />
        <PushOptIn />
        <InstallHint />
      </div>

      <div v-if="step < 3" class="space-y-2 text-center">
        <h1 class="text-h1 font-semibold">{{ t(step === 1 ? 'home.onb.1.title' : 'home.onb.2.title') }}</h1>
        <p class="text-text-secondary">{{ t(step === 1 ? 'home.onb.1.body' : 'home.onb.2.body') }}</p>
      </div>
    </div>

    <div class="space-y-4">
      <div class="flex justify-center gap-2" role="img" :aria-label="t('home.onb.step', { n: step, total: TOTAL })">
        <i v-for="n in TOTAL" :key="n" class="h-1.5 rounded-full transition-all duration-150" :class="n === step ? 'w-[22px] bg-primary' : 'w-1.5 bg-border'" />
      </div>
      <Button v-if="step < TOTAL" type="button" size="lg" class="w-full" data-testid="onboarding-next" @click="step += 1">{{ t('home.onb.next') }}</Button>
      <Button v-else type="button" size="lg" class="w-full" data-testid="onboarding-done" @click="finish">{{ t('onboarding.done') }}</Button>
    </div>
  </div>
</template>
