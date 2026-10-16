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
    if (e.isNetwork) return 'No connection. Try again once you are online.';
    if (e.status === 429) return 'Too many attempts. Wait a moment and try again later.';
    if (e.status === 401) return 'This code is incorrect or has expired.';
  }
  return 'Something went wrong. Please try again.';
}

async function sendCode() {
  busy.value = true;
  error.value = null;
  try {
    await wallet.api.emailStart(email.value.trim());
    step.value = 'code';
    info.value = `We sent a 6-digit code to ${email.value.trim()}.`;
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
    <form v-if="step === 'email'" class="space-y-3" @submit.prevent="sendCode">
      <label class="block font-medium" for="login-email">Email address</label>
      <input
        id="login-email"
        v-model="email"
        class="input"
        type="email"
        name="email"
        autocomplete="email"
        inputmode="email"
        required
        data-testid="login-email"
      />
      <button type="submit" class="btn btn-primary w-full" :disabled="busy" data-testid="login-send">Send me a code</button>
    </form>
    <form v-else class="space-y-3" @submit.prevent="verify">
      <p data-testid="login-info">{{ info }}</p>
      <label class="block font-medium" for="login-code">Code</label>
      <input
        id="login-code"
        v-model="code"
        class="input text-center text-2xl tracking-[0.5em]"
        name="code"
        autocomplete="one-time-code"
        inputmode="numeric"
        pattern="[0-9]{6}"
        maxlength="6"
        required
        data-testid="login-code"
      />
      <button type="submit" class="btn btn-primary w-full" :disabled="busy" data-testid="login-verify">Log in</button>
      <button type="button" class="btn btn-secondary w-full" :disabled="busy" @click="step = 'email'">Use a different email address</button>
    </form>
    <p role="alert" data-testid="login-error" class="mt-3 text-red-800">{{ error }}</p>
  </div>
</template>
