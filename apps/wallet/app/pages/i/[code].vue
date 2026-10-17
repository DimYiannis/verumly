<script setup lang="ts">
import { Check } from '@lucide/vue';
import type { MessageKey } from '~/i18n';
import { ApiError } from '~/utils/api';
import type { PublicUser } from '~/utils/api-schemas';
import { userName } from '~/utils/social';

// the auth middleware sends visitors without a session to /login?next=/i/<code> and brings them back
definePageMeta({ middleware: 'auth' });

const route = useRoute();
const wallet = useWallet();
const { t } = useLocale();
const code = String(route.params.code);
useHead({ title: () => t('social.invitePage.title') });

const status = ref<'loading' | 'done' | 'error'>('loading');
const friend = ref<PublicUser | null>(null);
const splitId = ref<string | null>(null);
const errorKeyName = ref<MessageKey>('social.err.generic');

async function accept() {
  status.value = 'loading';
  try {
    const res = await wallet.api.acceptInvite(code);
    friend.value = res.friend;
    splitId.value = res.splitId;
    status.value = 'done';
  } catch (e) {
    errorKeyName.value = 'social.err.generic';
    if (e instanceof ApiError) {
      if (e.isNetwork) errorKeyName.value = 'social.offline';
      else if (e.code === 'self' || e.status === 409) errorKeyName.value = 'social.invitePage.self';
      else if (e.status === 404 || e.status === 410) errorKeyName.value = 'social.invitePage.invalid';
    }
    status.value = 'error';
  }
}
onMounted(accept);
</script>

<template>
  <section class="space-y-4">
    <p v-if="status === 'loading'" role="status" class="flex items-center gap-2 text-sm text-text-secondary">
      <Spinner role="presentation" aria-hidden="true" />
      {{ t('social.invitePage.working') }}
    </p>
    <div v-else-if="status === 'done' && friend" data-testid="invite-done" class="space-y-4 rounded-xl border border-border bg-card p-4">
      <p role="status" class="flex items-center gap-2 font-medium text-success">
        <Check class="size-5" aria-hidden="true" />
        {{ t('social.invitePage.done', { name: userName(friend) }) }}
      </p>
      <NuxtLink v-if="splitId" :to="`/splits/${splitId}`" data-testid="invite-split-link" class="inline-flex min-h-11 items-center font-medium text-primary">{{ t('social.invitePage.toSplit') }}</NuxtLink>
      <div>
        <NuxtLink to="/friends" class="inline-flex min-h-11 items-center font-medium text-primary">{{ t('social.invitePage.toFriends') }}</NuxtLink>
      </div>
    </div>
    <div v-else role="alert" data-testid="invite-error" class="space-y-3 rounded-xl border border-danger-border bg-danger-soft p-4">
      <p class="text-danger">{{ t(errorKeyName) }}</p>
      <Button v-if="errorKeyName === 'social.offline' || errorKeyName === 'social.err.generic'" type="button" variant="secondary" size="lg" @click="accept">{{ t('common.retry') }}</Button>
      <NuxtLink v-else to="/friends" class="inline-flex min-h-11 items-center font-medium text-primary">{{ t('social.invitePage.toFriends') }}</NuxtLink>
    </div>
  </section>
</template>
