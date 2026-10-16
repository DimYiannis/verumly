<script setup lang="ts">
import { z } from 'zod';

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
    <h1 class="text-2xl font-bold">Log in</h1>
    <p>Enter your email address. You will receive a 6-digit code; no password needed.</p>
    <div class="card"><EmailLogin @done="done" /></div>
  </section>
</template>
