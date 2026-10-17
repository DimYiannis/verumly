<script setup lang="ts">
import { z } from 'zod';

const { t } = useLocale();
const wallet = useWallet();
const route = useRoute();

/** Only same-origin relative paths: never an open redirect. */
function safeNext(value: unknown): string | null {
  return typeof value === 'string' && /^\/(?!\/)/.test(value) ? value : null;
}

async function done() {
  const next = safeNext(route.query.next);
  const onboarded = await wallet.kv.get('onboarded', z.boolean());
  await wallet.retryPending();
  await navigateTo(next ?? (onboarded ? '/' : '/onboarding'));
}
</script>

<template>
  <section class="space-y-4">
    <h1 class="text-h1 font-semibold">{{ t('login.title') }}</h1>
    <p class="text-text-secondary">{{ t('login.body') }}</p>
    <div class="rounded-xl border border-border bg-card p-4"><EmailLogin @done="done" /></div>
  </section>
</template>
