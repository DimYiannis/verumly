<script setup lang="ts">
import QRCode from 'qrcode';

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
  <div class="mx-auto flex min-h-screen max-w-md items-center px-4">
    <div class="w-full rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 class="mb-1 text-xl font-semibold">Merchant dashboard</h1>
      <p class="mb-5 text-sm text-slate-500">Sign in with your email, password and authenticator code.</p>

      <form v-if="step === 'credentials'" class="space-y-3" @submit.prevent="submitCredentials">
        <label class="block text-sm">Email
          <input v-model="email" type="email" autocomplete="username" required data-testid="login-email" class="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
        </label>
        <label class="block text-sm">Password
          <input v-model="password" type="password" autocomplete="current-password" required data-testid="login-password" class="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
        </label>
        <button :disabled="busy" data-testid="login-submit" class="w-full rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50">Continue</button>
      </form>

      <form v-else class="space-y-3" @submit.prevent="submitCode">
        <div v-if="step === 'enrol'" data-testid="totp-enrol" class="space-y-2 text-sm">
          <p>First sign-in: set up an authenticator app (Google Authenticator, 1Password, …). Scan the code or enter the secret, then type the 6-digit code it shows.</p>
          <div v-if="qrSvg" class="mx-auto w-40" v-html="qrSvg" />
          <template v-if="enrol">
            <p>Secret: <code class="break-all rounded bg-slate-100 px-1" data-testid="totp-secret">{{ enrol.secret }}</code></p>
            <p>URI: <code class="break-all rounded bg-slate-100 px-1 text-xs" data-testid="totp-uri">{{ enrol.uri }}</code></p>
          </template>
        </div>
        <p v-else class="text-sm">Enter the 6-digit code from your authenticator app.</p>
        <label class="block text-sm">Code
          <input v-model="code" inputmode="numeric" autocomplete="one-time-code" pattern="\d{6}" maxlength="6" required data-testid="totp-input" class="mt-1 w-full rounded border border-slate-300 px-3 py-2 tracking-widest" />
        </label>
        <button :disabled="busy || (step === 'enrol' && !enrol)" data-testid="totp-submit" class="w-full rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50">{{ step === 'enrol' ? 'Verify and finish' : 'Verify' }}</button>
      </form>

      <p v-if="error" class="mt-3 text-sm text-red-700" role="alert" data-testid="login-error">{{ error }}</p>
    </div>
  </div>
</template>
