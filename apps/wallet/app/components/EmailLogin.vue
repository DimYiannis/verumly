<script setup lang="ts">
import type { MessageKey } from '~/i18n';
import { ApiError } from '~/utils/api';
import { isDemoAddress } from '~/utils/login-mode';

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

/** development stub: the seeded buyer, when the server runs with DEMO_MODE (no email code then) */
const demoEmail = ref<string | null>(null);
const demoUsers = ref<Array<{ email: string; label: string }>>([]);
onMounted(async () => {
  const d = await wallet.api.demoInfo();
  if (d.enabled && d.email) {
    demoEmail.value = d.email;
    demoUsers.value = d.users ?? [{ email: d.email, label: '' }];
  }
});

const isDemo = computed(() => !!demoEmail.value && isDemoAddress(demoUsers.value, email.value));

async function sendCode() {
  busy.value = true;
  error.value = null;
  try {
    if (isDemo.value) {
      await wallet.demoLogin(email.value.trim().toLowerCase());
      emit('done');
      return;
    }
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
        <Label for="login-email" class="text-label text-text-secondary uppercase">{{ t('login.email') }}</Label>
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
      <p v-if="demoEmail" class="rounded-md border border-warning-border bg-warning-soft p-3 text-sm text-warning" data-testid="login-demo-note">{{ t('login.demoNote', { emails: demoUsers.map((u) => u.email).join(', ') }) }}</p>
      <Button type="submit" size="lg" class="w-full" :disabled="busy" data-testid="login-send">{{ isDemo ? t('login.signIn') : t('login.sendCode') }}</Button>
      <div v-if="demoEmail" class="flex flex-wrap justify-center gap-2">
        <Button type="button" size="sm" variant="secondary" class="rounded-full" :disabled="busy" data-testid="login-fill-demo" @click="email = demoEmail ?? ''">{{ t('login.fillDemo') }}{{ demoUsers[0]?.label ? ` (${demoUsers[0].label})` : '' }}</Button>
        <Button v-for="u in demoUsers.slice(1)" :key="u.email" type="button" size="sm" variant="secondary" class="rounded-full" :disabled="busy" :data-testid="`login-fill-demo-${u.label.toLowerCase()}`" @click="email = u.email">{{ t('login.fillDemoFriend', { name: u.label }) }}</Button>
      </div>
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
