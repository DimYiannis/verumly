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
    <h1 class="text-h1 font-semibold">Inloggen</h1>
    <p class="text-text-secondary">Vul je e-mailadres in. Je krijgt een code van 6 cijfers; een wachtwoord is niet nodig.</p>
    <div class="rounded-xl border border-border bg-card p-4"><EmailLogin @done="done" /></div>
  </section>
</template>
