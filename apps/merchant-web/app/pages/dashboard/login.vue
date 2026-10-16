<script setup lang="ts">
import QRCode from 'qrcode';
import { ReceiptTextIcon } from '@lucide/vue';

definePageMeta({ layout: 'default' });

type Step = 'credentials' | 'enrol' | 'verify';
const step = ref<Step>('credentials');
const email = ref('');
const password = ref('');
const code = ref('');
const error = ref('');
const busy = ref(false);
const enrol = ref<{ secret: string; uri: string; enrolToken: string } | null>(null);
const qrSvg = ref('');

async function beginEnrol() {
  const r = await attempt(error, () => $fetch<{ secret: string; uri: string; enrolToken: string }>('/api/dashboard/totp/begin', { method: 'POST' }));
  if (r) {
    enrol.value = r;
    qrSvg.value = await QRCode.toString(r.uri, { type: 'svg', margin: 1 });
  }
}

async function goto(next: Step) {
  step.value = next;
  code.value = '';
  if (next === 'enrol') await beginEnrol();
}

onMounted(async () => {
  const s = await refreshSession();
  if (s.state === 'ready') return navigateTo('/dashboard');
  if (s.state === 'mfa_enrol') await goto('enrol');
  if (s.state === 'mfa_verify') await goto('verify');
});

async function submitCredentials() {
  busy.value = true;
  const r = await attempt(error, () => $fetch<{ next: 'enrol' | 'verify' }>('/api/dashboard/login', { method: 'POST', body: { email: email.value, password: password.value } }));
  busy.value = false;
  password.value = '';
  if (r) await goto(r.next);
}

async function submitCode() {
  busy.value = true;
  const ok = await attempt(error, () =>
    step.value === 'enrol'
      ? $fetch<unknown>('/api/dashboard/totp/confirm', { method: 'POST', body: { enrolToken: enrol.value?.enrolToken, code: code.value } })
      : $fetch<unknown>('/api/dashboard/totp/verify', { method: 'POST', body: { code: code.value } }),
  );
  busy.value = false;
  if (ok) {
    await refreshSession();
    await navigateTo('/dashboard');
  } else {
    code.value = '';
    // five wrong codes end the pending login: start over from the password
    const s = await refreshSession();
    if (s.state === 'anonymous') step.value = 'credentials';
  }
}
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-md items-center px-4 py-8">
    <Card class="w-full gap-6 py-8">
      <CardHeader class="px-8">
        <div class="mb-4 flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground"><ReceiptTextIcon class="size-5" /></div>
        <CardTitle class="text-2xl font-medium tracking-tight">Merchant dashboard</CardTitle>
        <CardDescription>Sign in with your email, password and authenticator code.</CardDescription>
      </CardHeader>
      <CardContent class="px-8">
        <form v-if="step === 'credentials'" class="space-y-6" @submit.prevent="submitCredentials">
          <div class="space-y-2">
            <Label for="login-email">Email</Label>
            <Input id="login-email" v-model="email" type="email" autocomplete="username" required data-testid="login-email" />
          </div>
          <div class="space-y-2">
            <Label for="login-password">Password</Label>
            <Input id="login-password" v-model="password" type="password" autocomplete="current-password" required data-testid="login-password" />
          </div>
          <Button class="w-full" :disabled="busy" data-testid="login-submit">Continue</Button>
        </form>

        <form v-else class="space-y-6" @submit.prevent="submitCode">
          <div v-if="step === 'enrol'" data-testid="totp-enrol" class="space-y-3 text-sm">
            <p class="text-muted-foreground">First sign-in: set up an authenticator app (Google Authenticator, 1Password and similar). Scan the code or enter the secret, then type the 6-digit code it shows.</p>
            <div v-if="qrSvg" class="mx-auto w-40 rounded-md border bg-white p-1" v-html="qrSvg" />
            <template v-if="enrol">
              <p>Secret: <code class="break-all rounded-sm bg-muted px-1 font-mono text-xs" data-testid="totp-secret">{{ enrol.secret }}</code></p>
              <p>URI: <code class="break-all rounded-sm bg-muted px-1 font-mono text-xs" data-testid="totp-uri">{{ enrol.uri }}</code></p>
            </template>
          </div>
          <p v-else class="text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app.</p>
          <div class="space-y-2">
            <Label for="totp-input">Code</Label>
            <Input id="totp-input" v-model="code" inputmode="numeric" autocomplete="one-time-code" pattern="\d{6}" maxlength="6" required class="tracking-widest" data-testid="totp-input" />
          </div>
          <Button class="w-full" :disabled="busy || (step === 'enrol' && !enrol)" data-testid="totp-submit">{{ step === 'enrol' ? 'Verify and finish' : 'Verify' }}</Button>
        </form>

        <AppErrorNote v-if="error" class="mt-6" data-testid="login-error">{{ error }}</AppErrorNote>
      </CardContent>
    </Card>
  </div>
</template>
