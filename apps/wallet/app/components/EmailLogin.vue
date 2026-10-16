<script setup lang="ts">
import { ApiError } from '~/utils/api';

const emit = defineEmits<{ done: [] }>();
const wallet = useWallet();
const step = ref<'email' | 'code'>('email');
const email = ref('');
const code = ref('');
const busy = ref(false);
const error = ref<string | null>(null);
const info = ref<string | null>(null);

function messageFor(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.isNetwork) return 'Geen verbinding. Probeer het opnieuw zodra je online bent.';
    if (e.status === 429) return 'Te vaak geprobeerd. Wacht even en probeer het later opnieuw.';
    if (e.status === 401) return 'Deze code klopt niet of is verlopen.';
  }
  return 'Er ging iets mis. Probeer het opnieuw.';
}

const demo = ref(false);
onMounted(async () => {
  // demo mode: the field fills itself with the seeded buyer
  const d = await wallet.api.demoInfo();
  if (d.enabled && d.email) {
    demo.value = true;
    email.value = d.email;
  }
});

async function demoSignIn() {
  busy.value = true;
  error.value = null;
  try {
    await wallet.demoLogin(email.value.trim().toLowerCase());
    emit('done');
  } catch (e) {
    error.value = messageFor(e);
  } finally {
    busy.value = false;
  }
}

async function sendCode() {
  busy.value = true;
  error.value = null;
  try {
    await wallet.api.emailStart(email.value.trim());
    step.value = 'code';
    info.value = `We hebben een code van 6 cijfers gestuurd naar ${email.value.trim()}.`;
  } catch (e) {
    error.value = messageFor(e);
  } finally {
    busy.value = false;
  }
}

async function verify() {
  busy.value = true;
  error.value = null;
  try {
    await wallet.login(email.value.trim().toLowerCase(), code.value.trim());
    emit('done');
  } catch (e) {
    error.value = messageFor(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div data-testid="email-login">
    <form v-if="step === 'email'" class="space-y-4" @submit.prevent="sendCode">
      <div class="space-y-2">
        <Label for="login-email" class="text-sm font-medium text-foreground">E-mailadres</Label>
        <Input
          id="login-email"
          v-model="email"
          class="h-11 text-base"
          type="email"
          name="email"
          autocomplete="email"
          inputmode="email"
          required
          data-testid="login-email"
        />
      </div>
      <Button type="submit" size="lg" class="w-full" :disabled="busy" data-testid="login-send">Stuur me een code</Button>
      <Button v-if="demo" type="button" size="lg" variant="secondary" class="w-full" :disabled="busy" data-testid="login-demo" @click="demoSignIn">Demo: direct inloggen</Button>
    </form>
    <form v-else class="space-y-4" @submit.prevent="verify">
      <p class="text-sm text-text-secondary" data-testid="login-info">{{ info }}</p>
      <div class="space-y-2">
        <Label for="login-code" class="text-sm font-medium text-foreground">Code</Label>
        <Input
          id="login-code"
          v-model="code"
          class="h-14 text-center font-mono text-2xl tracking-[0.5em]"
          name="code"
          autocomplete="one-time-code"
          inputmode="numeric"
          pattern="[0-9]{6}"
          maxlength="6"
          required
          data-testid="login-code"
        />
      </div>
      <Button type="submit" size="lg" class="w-full" :disabled="busy" data-testid="login-verify">Inloggen</Button>
      <Button type="button" size="lg" variant="secondary" class="w-full" :disabled="busy" @click="step = 'email'">Ander e-mailadres</Button>
    </form>
    <p role="alert" data-testid="login-error" class="mt-3 text-sm text-danger">{{ error }}</p>
  </div>
</template>
