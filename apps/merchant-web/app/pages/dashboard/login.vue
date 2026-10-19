<script setup lang="ts">
import QRCode from 'qrcode';
import { ReceiptTextIcon } from '@lucide/vue';

definePageMeta({ layout: 'default' });
const { t } = useLocale();

type Step = 'credentials' | 'enrol' | 'verify';
const step = ref<Step>('credentials');
const email = ref('');
const password = ref('');
const code = ref('');
const error = ref('');
const busy = ref(false);
const enrol = ref<{ secret: string; uri: string; enrolToken: string } | null>(null);
const qrSvg = ref('');
/** development stub: set when the server runs with DEMO_MODE; no second factor then */
const demo = ref<{ email: string; password: string } | null>(null);

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

function fillDemo() {
  if (!demo.value) return;
  email.value = demo.value.email;
  password.value = demo.value.password;
}

onMounted(async () => {
  const s = await refreshSession();
  if (s.state === 'ready') return navigateTo('/dashboard');
  const d = await $fetch<{ enabled: boolean; email?: string; password?: string }>('/api/dashboard/demo').catch(() => ({ enabled: false }) as { enabled: boolean; email?: string; password?: string });
  if (d.enabled && d.email && d.password) demo.value = { email: d.email, password: d.password };
  if (s.state === 'mfa_enrol') await goto('enrol');
  if (s.state === 'mfa_verify') await goto('verify');
});

async function submitCredentials() {
  busy.value = true;
  if (demo.value) {
    const ok = await attempt(error, () => $fetch<unknown>('/api/dashboard/demo-login', { method: 'POST', body: { email: email.value, password: password.value } }));
    busy.value = false;
    password.value = '';
    if (ok) {
      await refreshSession();
      await navigateTo('/dashboard');
    }
    return;
  }
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
  <div class="flex min-h-screen flex-wrap">
  <div class="fixed right-4 top-4 z-10"><AppLocaleSwitch /></div>
  <div class="flex min-h-[320px] flex-[1_1_520px] flex-col justify-between gap-10 bg-[#1C1F6E] p-8 text-white md:p-14">
    <span class="flex items-center gap-3 text-[28px] font-semibold tracking-tight">
      <span class="flex size-9 items-center justify-center rounded-lg bg-white/15"><ReceiptTextIcon class="size-5" /></span>
      <span>Verumly <span class="font-normal text-[#B3B6EE]">{{ t('ov.login.forBusiness') }}</span></span>
    </span>
    <div class="flex max-w-[520px] flex-col gap-4">
      <h1 class="text-[34px] font-semibold leading-[40px] tracking-tight md:text-[44px] md:leading-[48px]">{{ t('ov.login.headline') }}</h1>
      <p class="text-lg leading-7 text-[#E6E7F8]">{{ t('ov.login.sub') }}</p>
    </div>
    <p class="text-sm text-[#B3B6EE]">{{ t('ov.login.privacy') }}</p>
  </div>
  <div class="flex flex-[1_1_480px] items-center justify-center bg-muted p-6 md:p-10">
    <Card class="w-full max-w-[400px] gap-6 py-8">
      <CardHeader class="px-8">
        <CardTitle class="text-2xl font-semibold tracking-tight">{{ t('ov.login.signIn') }}</CardTitle>
        <CardDescription>{{ demo ? t('login.demoDescription') : t('login.description') }}</CardDescription>
      </CardHeader>
      <CardContent class="px-8">
        <form v-if="step === 'credentials'" class="space-y-6" @submit.prevent="submitCredentials">
          <div class="space-y-2">
            <Label for="login-email">{{ t('login.email') }}</Label>
            <Input id="login-email" v-model="email" type="email" autocomplete="username" required data-testid="login-email" />
          </div>
          <div class="space-y-2">
            <Label for="login-password">{{ t('login.password') }}</Label>
            <Input id="login-password" v-model="password" type="password" autocomplete="current-password" required data-testid="login-password" />
          </div>
          <Button class="w-full" :disabled="busy" data-testid="login-submit">{{ demo ? t('login.signIn') : t('login.continue') }}</Button>
          <Button v-if="demo" type="button" variant="secondary" class="w-full" :disabled="busy" data-testid="login-fill-demo" @click="fillDemo">{{ t('login.fillDemo') }}</Button>
        </form>

        <form v-else class="space-y-6" @submit.prevent="submitCode">
          <div v-if="step === 'enrol'" data-testid="totp-enrol" class="space-y-3 text-sm">
            <p class="text-muted-foreground">{{ t('login.enrolIntro') }}</p>
            <div v-if="qrSvg" class="mx-auto w-40 rounded-md border bg-white p-1" v-html="qrSvg" />
            <template v-if="enrol">
              <p>{{ t('login.secret') }} <code class="break-all rounded-sm bg-muted px-1 font-mono text-xs" data-testid="totp-secret">{{ enrol.secret }}</code></p>
              <p>{{ t('login.uri') }} <code class="break-all rounded-sm bg-muted px-1 font-mono text-xs" data-testid="totp-uri">{{ enrol.uri }}</code></p>
            </template>
          </div>
          <p v-else class="text-sm text-muted-foreground">{{ t('login.verifyIntro') }}</p>
          <div class="space-y-2">
            <Label for="totp-input">{{ t('login.code') }}</Label>
            <Input id="totp-input" v-model="code" inputmode="numeric" autocomplete="one-time-code" pattern="\d{6}" maxlength="6" required class="tracking-widest" data-testid="totp-input" />
          </div>
          <Button class="w-full" :disabled="busy || (step === 'enrol' && !enrol)" data-testid="totp-submit">{{ step === 'enrol' ? t('login.verifyFinish') : t('login.verify') }}</Button>
        </form>

        <AppErrorNote v-if="error" class="mt-6" data-testid="login-error">{{ error }}</AppErrorNote>
      </CardContent>
    </Card>
  </div>
  </div>
</template>
