<script setup lang="ts">
import type { MessageKey } from '~/i18n';
import { ApiError } from '~/utils/api';

const emit = defineEmits<{ done: [] }>();
const wallet = useWallet();
const step = ref<'email' | 'code'>('email');
const email = ref('');
const code = ref('');
const busy = ref(false);
const { t } = useLocale();
const error = ref<MessageKey | null>(null);
/** the address the code was sent to, once it was */
const sentTo = ref<string | null>(null);

function messageFor(e: unknown): MessageKey {
  if (e instanceof ApiError) {
    if (e.isNetwork) return 'login.err.offline';
    if (e.status === 429) return 'login.err.rateLimited';
    if (e.status === 401) return 'login.err.badCode';
  }
  return 'login.err.generic';
}

async function sendCode() {
  busy.value = true;
  error.value = null;
  try {
    await wallet.api.emailStart(email.value.trim());
    step.value = 'code';
    sentTo.value = email.value.trim();
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
        <Label for="login-email" class="text-sm font-medium text-foreground">{{ t('login.email') }}</Label>
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
      <Button type="submit" size="lg" class="w-full" :disabled="busy" data-testid="login-send">{{ t('login.sendCode') }}</Button>
    </form>
    <form v-else class="space-y-4" @submit.prevent="verify">
      <p class="text-sm text-text-secondary" data-testid="login-info">{{ sentTo === null ? '' : t('login.codeSent', { email: sentTo }) }}</p>
      <div class="space-y-2">
        <Label for="login-code" class="text-sm font-medium text-foreground">{{ t('login.code') }}</Label>
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
      <Button type="submit" size="lg" class="w-full" :disabled="busy" data-testid="login-verify">{{ t('login.verify') }}</Button>
      <Button type="button" size="lg" variant="secondary" class="w-full" :disabled="busy" @click="step = 'email'">{{ t('login.otherEmail') }}</Button>
    </form>
    <p role="alert" data-testid="login-error" class="mt-3 text-sm text-danger">{{ error ? t(error) : '' }}</p>
  </div>
</template>
