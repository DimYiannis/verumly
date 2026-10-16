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
  <section v-if="!standalone" class="card" aria-labelledby="a2hs-h" data-testid="install-hint">
    <h2 id="a2hs-h" class="font-semibold">Zet Bonnen op je beginscherm</h2>
    <p v-if="ios" class="text-sm text-slate-800">Tik in Safari op <strong>Deel</strong> en kies <strong>Zet op beginscherm</strong>. Zo opent de app direct en kun je meldingen ontvangen.</p>
    <p v-else class="text-sm text-slate-800">Kies in het browsermenu <strong>App installeren</strong> of <strong>Toevoegen aan startscherm</strong>.</p>
    <button v-if="deferred" type="button" class="btn btn-primary mt-3" data-testid="install-button" @click="deferred?.prompt()">Installeer app</button>
  </section>
</template>
