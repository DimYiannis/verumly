<script setup lang="ts">
import { ChevronLeft } from '@lucide/vue';
import type { MessageKey } from '~/i18n';
import { REACTIONS, type ShareDetail } from '~/utils/api-schemas';
import { ApiError, type Reaction } from '~/utils/api';
import { formatDateTime } from '~/utils/format';
import { errorKey, isOffline, userName } from '~/utils/social';

definePageMeta({ middleware: 'auth' });

const route = useRoute();
const wallet = useWallet();
const { t, locale } = useLocale();
const id = String(route.params.id);
useHead({ title: () => t('social.sharedPage.title') });

const status = ref<'loading' | 'ready' | 'offline' | 'notfound' | 'error'>('loading');
const detail = shallowRef<ShareDetail | null>(null);
const error = ref<MessageKey | null>(null);
const busy = ref(false);

async function load() {
  try {
    detail.value = await wallet.api.getShare(id);
    status.value = 'ready';
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) status.value = 'notfound';
    else status.value = isOffline(e) ? 'offline' : 'error';
  }
}
onMounted(load);

const viewDetail = computed(() => (detail.value ? { receipt: detail.value.receipt, final: true, versions: [], template: detail.value.template } : null));

/** Tapping the active reaction removes it. */
async function react(emoji: Reaction) {
  if (!detail.value) return;
  busy.value = true;
  error.value = null;
  try {
    await wallet.api.setReaction(id, detail.value.share.myReaction === emoji ? null : emoji);
    await load();
  } catch (e) {
    error.value = errorKey(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <NuxtLink to="/friends" class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary no-underline hover:text-brand-900">
      <ChevronLeft class="size-4" aria-hidden="true" />
      {{ t('social.title') }}
    </NuxtLink>
    <p v-if="status === 'loading'" role="status" class="flex items-center gap-2 text-sm text-text-secondary">
      <Spinner role="presentation" aria-hidden="true" />
      {{ t('common.loading') }}
    </p>
    <p v-else-if="status === 'notfound'" role="alert" data-testid="not-found" class="rounded-xl border border-border bg-card p-4">{{ t('social.sharedPage.notFound') }}</p>
    <div v-else-if="status !== 'ready' || !detail || !viewDetail" role="alert" data-testid="social-offline" class="space-y-3 rounded-xl border border-border bg-card p-4">
      <p>{{ t(status === 'offline' ? 'social.offline' : 'social.err.generic') }}</p>
      <Button type="button" variant="secondary" size="lg" @click="load">{{ t('common.retry') }}</Button>
    </div>
    <template v-else>
      <section class="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
        <UserAvatar :user="detail.share.from" />
        <div class="min-w-0">
          <p class="truncate font-medium">{{ t('social.sharedPage.from', { name: userName(detail.share.from) }) }}</p>
          <p class="text-xs text-text-secondary">{{ formatDateTime(detail.share.sharedAt, locale) }}</p>
        </div>
      </section>

      <ReceiptView :detail="viewDetail" />

      <section class="space-y-2 rounded-xl border border-border bg-card p-4">
        <h2 class="text-h2 font-semibold">{{ t('social.sharedPage.react') }}</h2>
        <div class="flex gap-2" role="group" :aria-label="t('social.sharedPage.react')">
          <button
            v-for="(emoji, i) in REACTIONS"
            :key="emoji"
            type="button"
            :aria-pressed="detail.share.myReaction === emoji"
            :aria-label="emoji"
            :data-testid="`reaction-${i}`"
            :disabled="busy"
            class="flex size-11 items-center justify-center rounded-full border bg-card text-xl disabled:opacity-50"
            :class="detail.share.myReaction === emoji ? 'border-primary bg-muted' : 'border-border'"
            @click="react(emoji)"
          >
            {{ emoji }}
          </button>
        </div>
        <p v-if="error" role="alert" class="text-sm text-danger">{{ t(error) }}</p>
        <ul v-if="detail.reactions.length" class="space-y-1 pt-1 text-sm text-text-secondary">
          <li v-for="r in detail.reactions" :key="r.user.userId">{{ r.emoji }} {{ userName(r.user) }}</li>
        </ul>
      </section>
    </template>
  </div>
</template>
