<script setup lang="ts">
import { z } from 'zod';

const { t } = useLocale();
const wallet = useWallet();
const route = useRoute();

/** Only same-origin relative paths: never an open redirect. */
function safeNext(value: unknown): string | null {
  return typeof value === 'string' && /^\/(?!\/)/.test(value) ? value : null;
}

const invited = computed(() => /^\/i\/[^/]+/.test(safeNext(route.query.next) ?? ''));

async function done() {
  const next = safeNext(route.query.next);
  const onboarded = await wallet.kv.get('onboarded', z.boolean());
  await wallet.retryPending();
  await navigateTo(next ?? (onboarded ? '/' : '/onboarding'));
}
</script>

<template>
  <section class="flex min-h-[calc(100dvh-4rem)] flex-col justify-between gap-8 px-2 pt-6 pb-6">
    <div class="space-y-4">
      <p class="text-[52px] leading-[52px] font-semibold tracking-[-0.04em]">{{ t('layout.brand') }}</p>
      <h1 class="sr-only">{{ t('login.title') }}</h1>
      <p class="text-[22px] leading-[30px] font-normal text-[#E6E7F8]">{{ t('home.login.tagline') }}</p>
      <ul class="space-y-2 pt-3 text-body text-[#E6E7F8]">
        <li class="flex items-center gap-2"><i class="size-2 rounded-full bg-[#B3B6EE]" aria-hidden="true" />{{ t('home.login.point1') }}</li>
        <li class="flex items-center gap-2"><i class="size-2 rounded-full bg-[#B3B6EE]" aria-hidden="true" />{{ t('home.login.point2') }}</li>
      </ul>
    </div>
    <div class="space-y-3">
      <p v-if="invited" role="note" class="rounded-xl border border-[#B3B6EE] px-4 py-3 text-body text-[#E6E7F8]" data-testid="login-invited">{{ t('login.invited') }}</p>
      <div class="rounded-xl border border-border bg-card p-4 text-foreground"><EmailLogin @done="done" /></div>
    </div>
  </section>
</template>
