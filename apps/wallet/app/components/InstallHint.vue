<script setup lang="ts">
import { isIos } from '~/utils/push';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}
function isInstallPrompt(e: Event): e is InstallPromptEvent {
  return 'prompt' in e && typeof e.prompt === 'function';
}

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
    <h2 id="a2hs-h" class="text-h3 font-semibold">Zet Bonnen op je beginscherm</h2>
    <p v-if="ios" class="text-sm text-text-secondary">Tik in Safari op <strong class="font-semibold text-foreground">Deel</strong> en kies <strong class="font-semibold text-foreground">Zet op beginscherm</strong>. Zo opent de app direct en kun je meldingen ontvangen.</p>
    <p v-else class="text-sm text-text-secondary">Kies in het browsermenu <strong class="font-semibold text-foreground">App installeren</strong> of <strong class="font-semibold text-foreground">Toevoegen aan startscherm</strong>.</p>
    <Button v-if="deferred" type="button" size="lg" class="mt-1" data-testid="install-button" @click="deferred?.prompt()">Installeer app</Button>
  </section>
</template>
