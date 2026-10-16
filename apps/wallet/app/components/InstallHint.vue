<script setup lang="ts">
import { isIos } from '~/utils/push';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}
function isInstallPrompt(e: Event): e is InstallPromptEvent {
  return 'prompt' in e && typeof e.prompt === 'function';
}

const { t } = useLocale();
const ios = ref(false);
const standalone = ref(false);
const deferred = shallowRef<InstallPromptEvent | null>(null);

onMounted(() => {
  ios.value = isIos({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints });
  standalone.value = matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && navigator.standalone === true);
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    if (isInstallPrompt(e)) deferred.value = e;
  });
});
</script>

<template>
  <section v-if="!standalone" class="space-y-2 rounded-xl border border-border bg-card p-4" aria-labelledby="a2hs-h" data-testid="install-hint">
    <h2 id="a2hs-h" class="text-h3 font-semibold">{{ t('install.title') }}</h2>
    <p v-if="ios" class="text-sm text-text-secondary">{{ t('install.ios1') }}<strong class="font-semibold text-foreground">{{ t('install.iosShare') }}</strong>{{ t('install.ios2') }}<strong class="font-semibold text-foreground">{{ t('install.iosAdd') }}</strong>{{ t('install.ios3') }}</p>
    <p v-else class="text-sm text-text-secondary">{{ t('install.other1') }}<strong class="font-semibold text-foreground">{{ t('install.otherInstall') }}</strong>{{ t('install.other2') }}<strong class="font-semibold text-foreground">{{ t('install.otherAdd') }}</strong>{{ t('install.other3') }}</p>
    <Button v-if="deferred" type="button" size="lg" class="mt-1" data-testid="install-button" @click="deferred?.prompt()">{{ t('install.button') }}</Button>
  </section>
</template>
