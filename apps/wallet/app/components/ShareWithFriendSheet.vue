<script setup lang="ts">
import { Check } from '@lucide/vue';
import type { MessageKey } from '~/i18n';
import type { PublicUser } from '~/utils/api-schemas';
import { errorKey, userName } from '~/utils/social';

const props = defineProps<{ receiptId: string; open: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();
const wallet = useWallet();
const { t } = useLocale();

const friends = ref<PublicUser[]>([]);
const selected = ref<string | null>(null);
const status = ref<'loading' | 'ready' | 'sending' | 'done'>('loading');
const error = ref<MessageKey | null>(null);
const doneName = ref('');

async function load() {
  status.value = 'loading';
  error.value = null;
  selected.value = null;
  try {
    friends.value = (await wallet.api.getFriends()).friends;
    status.value = 'ready';
  } catch (e) {
    error.value = errorKey(e);
    status.value = 'ready';
  }
}
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) void load();
  },
);

async function send() {
  const friend = friends.value.find((f) => f.userId === selected.value);
  if (!friend) return;
  status.value = 'sending';
  error.value = null;
  try {
    await wallet.api.createShare(props.receiptId, friend.userId);
    doneName.value = userName(friend);
    status.value = 'done';
  } catch (e) {
    error.value = errorKey(e);
    status.value = 'ready';
  }
}
</script>

<template>
  <Sheet :open="open" @update:open="(v: boolean) => emit('update:open', v)">
    <SheetContent side="bottom" data-testid="share-sheet" class="mx-auto w-full max-w-xl rounded-t-xl border-border p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <SheetHeader class="p-0">
        <SheetTitle class="text-h2 font-semibold">{{ t('social.share.title') }}</SheetTitle>
        <SheetDescription class="text-sm text-text-secondary">{{ t('social.share.warning') }}</SheetDescription>
      </SheetHeader>
      <p v-if="status === 'done'" role="status" data-testid="share-done" class="flex items-center gap-2 rounded-lg border border-success-border bg-success-soft p-3 text-sm font-medium text-success">
        <Check class="size-4" aria-hidden="true" />
        {{ t('social.share.done', { name: doneName }) }}
      </p>
      <template v-else>
        <p v-if="status === 'loading'" role="status" class="text-sm text-text-secondary">{{ t('common.loading') }}</p>
        <p v-else-if="friends.length === 0 && !error" class="text-sm text-text-secondary">
          {{ t('social.share.noFriends') }}
          <NuxtLink to="/friends" class="font-medium text-primary">{{ t('social.share.goFriends') }}</NuxtLink>
        </p>
        <ul v-else class="max-h-64 space-y-1 overflow-y-auto" role="radiogroup" :aria-label="t('social.share.title')">
          <li v-for="f in friends" :key="f.userId">
            <button
              type="button"
              role="radio"
              :aria-checked="selected === f.userId"
              :data-testid="`share-friend-${f.userId}`"
              class="flex min-h-11 w-full items-center gap-3 rounded-lg border bg-card px-3 text-left text-sm"
              :class="selected === f.userId ? 'border-primary' : 'border-border'"
              @click="selected = f.userId"
            >
              <UserAvatar :user="f" size="sm" />
              <span class="flex-1 font-medium">{{ userName(f) }}</span>
              <Check v-if="selected === f.userId" class="size-4 text-primary" aria-hidden="true" />
            </button>
          </li>
        </ul>
        <p v-if="error" role="alert" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ t(error) }}</p>
        <Button type="button" size="lg" data-testid="share-confirm" :disabled="!selected || status !== 'ready'" @click="send">
          {{ status === 'sending' ? t('social.share.sending') : t('social.share.confirm') }}
        </Button>
      </template>
    </SheetContent>
  </Sheet>
</template>
