<script setup lang="ts">
import { Check, Copy, Share2, X } from '@lucide/vue';
import type { MessageKey } from '~/i18n';
import type { Balances, FriendsResponse, Profile, ShareItem, SplitListItem } from '~/utils/api-schemas';
import { formatDateTime, formatEuro } from '~/utils/format';
import { AVATARS, copyText, errorKey, handleHint, inviteLink, isOffline, userName } from '~/utils/social';

definePageMeta({ middleware: 'auth' });

const wallet = useWallet();
const { t, locale } = useLocale();
const receiptHost = useRuntimeConfig().public.receiptHost;
useHead({ title: () => t('social.title') });

const status = ref<'loading' | 'ready' | 'offline' | 'error'>('loading');
const profile = ref<Profile | null>(null);
const friends = ref<FriendsResponse>({ friends: [], incoming: [], outgoing: [] });
const balances = ref<Balances>({ friends: [], totalOwedToMe: 0, totalIOwe: 0 });
const incomingShares = ref<ShareItem[]>([]);
const splits = ref<SplitListItem[]>([]);

async function load() {
  try {
    const [p, f, b, sh, sp] = await Promise.all([wallet.api.getProfile(), wallet.api.getFriends(), wallet.api.getBalances(), wallet.api.listShares(), wallet.api.listSplits()]);
    profile.value = p;
    friends.value = f;
    balances.value = b;
    incomingShares.value = sh.incoming;
    splits.value = [...sp.splits].sort((a, c) => Number(c.openMinor > 0) - Number(a.openMinor > 0) || c.createdAt.localeCompare(a.createdAt));
    status.value = 'ready';
  } catch (e) {
    status.value = isOffline(e) ? 'offline' : 'error';
  }
}
onMounted(load);

// ---- profile
const editing = ref(false);
const name = ref('');
const handle = ref('');
const avatar = ref<string | null>(null);
const profileBusy = ref(false);
const profileError = ref<MessageKey | null>(null);
const needsProfile = computed(() => profile.value !== null && !profile.value.handle);
const hint = computed(() => (handle.value === '' ? null : handleHint(handle.value)));
const hintText = computed(() => {
  const h = hint.value;
  if (h === 'tooShort') return t('social.profile.hint.tooShort');
  if (h === 'tooLong') return t('social.profile.hint.tooLong');
  if (h === 'chars') return t('social.profile.hint.chars');
  return t('social.profile.hint.ok');
});
watch(
  profile,
  (p) => {
    if (!p) return;
    name.value = p.displayName ?? '';
    handle.value = p.handle ?? '';
    avatar.value = p.avatar ?? AVATARS[0];
  },
  { immediate: true },
);

async function saveProfile() {
  profileBusy.value = true;
  profileError.value = null;
  try {
    await wallet.api.putProfile({ displayName: name.value.trim(), handle: handle.value, avatar: avatar.value });
    editing.value = false;
    await load();
  } catch (e) {
    profileError.value = errorKey(e);
  } finally {
    profileBusy.value = false;
  }
}

// ---- add friend and invite
const addHandle = ref('');
const addBusy = ref(false);
const addMsg = ref<{ kind: 'ok' | 'err'; key: MessageKey } | null>(null);
async function addFriend() {
  const h = addHandle.value.trim().replace(/^@/, '').toLowerCase();
  if (!h) return;
  addBusy.value = true;
  addMsg.value = null;
  try {
    const result = await wallet.api.requestFriend(h);
    addMsg.value = { kind: 'ok', key: result === 'accepted' ? 'social.add.accepted' : 'social.add.requested' };
    addHandle.value = '';
    await load();
  } catch (e) {
    addMsg.value = { kind: 'err', key: errorKey(e) };
  } finally {
    addBusy.value = false;
  }
}

const link = ref<string | null>(null);
const inviteBusy = ref(false);
const inviteError = ref<MessageKey | null>(null);
const copied = ref(false);
const canShare = computed(() => import.meta.client && typeof navigator.share === 'function');
async function createInvite() {
  inviteBusy.value = true;
  inviteError.value = null;
  copied.value = false;
  try {
    link.value = inviteLink(receiptHost, (await wallet.api.createInvite()).code);
  } catch (e) {
    inviteError.value = errorKey(e);
  } finally {
    inviteBusy.value = false;
  }
}
async function copyLink() {
  if (link.value) copied.value = await copyText(link.value);
}
async function shareLink() {
  if (!link.value) return;
  try {
    await navigator.share({ title: t('social.invite.shareTitle'), text: t('social.invite.shareText'), url: link.value });
  } catch {
    // dismissed by the user
  }
}
function selectAll(e: Event) {
  (e.target as HTMLInputElement).select();
}

// ---- requests and friends
const actionError = ref<MessageKey | null>(null);
async function act(fn: () => Promise<unknown>): Promise<boolean> {
  actionError.value = null;
  try {
    await fn();
    await load();
    return true;
  } catch (e) {
    actionError.value = errorKey(e);
    return false;
  }
}
const confirmRemove = ref<string | null>(null);
async function remove(userId: string) {
  if (await act(() => wallet.api.removeFriend(userId))) confirmRemove.value = null;
}
function net(userId: string): number {
  const row = balances.value.friends.find((r) => r.user.userId === userId);
  return row ? row.owesMe - row.iOwe : 0;
}
function openText(s: SplitListItem): string {
  if (s.openMinor === 0) return t('social.splits.settled');
  return t(s.creatorIsMe ? 'social.splits.owedToYou' : 'social.splits.youOwe', { amount: formatEuro(s.openMinor, locale.value) });
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-h1 font-semibold">{{ t('social.title') }}</h1>
    <p v-if="status === 'loading'" role="status" class="flex items-center gap-2 text-sm text-text-secondary">
      <Spinner role="presentation" aria-hidden="true" />
      {{ t('common.loading') }}
    </p>
    <div v-else-if="status !== 'ready'" role="alert" data-testid="social-offline" class="space-y-3 rounded-xl border border-border bg-card p-4">
      <p>{{ t(status === 'offline' ? 'social.offline' : 'social.err.generic') }}</p>
      <Button type="button" variant="secondary" size="lg" @click="load">{{ t('common.retry') }}</Button>
    </div>
    <template v-else-if="profile">
      <!-- profile -->
      <section data-testid="friends-profile" class="space-y-3 rounded-xl border border-border bg-card p-4">
        <template v-if="needsProfile || editing">
          <h2 class="text-h2 font-semibold">{{ needsProfile ? t('social.profile.setupTitle') : t('social.profile.editTitle') }}</h2>
          <p v-if="needsProfile" class="text-sm text-text-secondary">{{ t('social.profile.setupBody') }}</p>
          <form class="space-y-3" @submit.prevent="saveProfile">
            <div class="space-y-1">
              <Label for="profile-name">{{ t('social.profile.name') }}</Label>
              <Input id="profile-name" v-model="name" maxlength="40" autocomplete="nickname" class="h-11" data-testid="profile-name" />
            </div>
            <div class="space-y-1">
              <Label for="profile-handle">{{ t('social.profile.handle') }}</Label>
              <Input
                id="profile-handle"
                v-model="handle"
                maxlength="20"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                class="h-11"
                data-testid="profile-handle"
                :aria-invalid="hint !== null"
                aria-describedby="handle-hint"
              />
              <p id="handle-hint" class="text-xs" :class="hint ? 'text-danger' : 'text-text-secondary'">{{ hintText }}</p>
            </div>
            <fieldset class="space-y-1">
              <legend class="text-sm font-medium">{{ t('social.profile.avatar') }}</legend>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="a in AVATARS"
                  :key="a"
                  type="button"
                  :aria-pressed="avatar === a"
                  :aria-label="a"
                  class="flex size-11 items-center justify-center rounded-full border bg-card text-xl"
                  :class="avatar === a ? 'border-primary bg-muted' : 'border-border'"
                  @click="avatar = a"
                >
                  {{ a }}
                </button>
              </div>
            </fieldset>
            <p v-if="profileError" role="alert" class="text-sm text-danger">{{ t(profileError) }}</p>
            <div class="flex gap-2">
              <Button type="submit" size="lg" data-testid="profile-save" :disabled="profileBusy || !name.trim() || hint !== null || handle === ''">{{ t('social.profile.save') }}</Button>
              <Button v-if="!needsProfile" type="button" size="lg" variant="secondary" @click="editing = false">{{ t('social.cancel') }}</Button>
            </div>
          </form>
        </template>
        <div v-else class="flex items-center gap-3">
          <UserAvatar :user="profile" />
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium">{{ profile.displayName }}</p>
            <p class="truncate font-mono text-sm text-text-secondary">@{{ profile.handle }}</p>
          </div>
          <Button type="button" variant="secondary" data-testid="profile-edit" @click="editing = true">{{ t('social.profile.edit') }}</Button>
        </div>
      </section>

      <template v-if="!needsProfile">
        <!-- balances -->
        <section class="grid grid-cols-2 gap-2" :aria-label="t('social.balances.title')">
          <div class="rounded-xl border border-border bg-card p-4">
            <p class="text-xs text-text-secondary">{{ t('social.balances.owedToMe') }}</p>
            <p data-testid="balance-total-owed" class="font-mono text-lg font-medium tabular-nums text-success">{{ formatEuro(balances.totalOwedToMe, locale) }}</p>
          </div>
          <div class="rounded-xl border border-border bg-card p-4">
            <p class="text-xs text-text-secondary">{{ t('social.balances.iOwe') }}</p>
            <p data-testid="balance-total-owe" class="font-mono text-lg font-medium tabular-nums" :class="balances.totalIOwe > 0 ? 'text-danger' : ''">{{ formatEuro(balances.totalIOwe, locale) }}</p>
          </div>
        </section>

        <p v-if="actionError" role="alert" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ t(actionError) }}</p>

        <!-- add friend and invite -->
        <section class="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 class="text-h2 font-semibold">{{ t('social.add.title') }}</h2>
          <form class="flex gap-2" @submit.prevent="addFriend">
            <Input
              v-model="addHandle"
              :placeholder="t('social.add.placeholder')"
              :aria-label="t('social.add.title')"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              class="h-11"
              data-testid="friends-add-input"
            />
            <Button type="submit" size="lg" data-testid="friends-add-submit" :disabled="addBusy || !addHandle.trim()">{{ t('social.add.submit') }}</Button>
          </form>
          <p v-if="addMsg" :role="addMsg.kind === 'err' ? 'alert' : 'status'" class="text-sm" :class="addMsg.kind === 'err' ? 'text-danger' : 'text-success'">{{ t(addMsg.key) }}</p>
          <div class="space-y-2 border-t border-border pt-3">
            <p class="text-sm text-text-secondary">{{ t('social.invite.body') }}</p>
            <Button type="button" variant="secondary" size="lg" data-testid="friends-invite-create" :disabled="inviteBusy" @click="createInvite">{{ t('social.invite.create') }}</Button>
            <p v-if="inviteError" role="alert" class="text-sm text-danger">{{ t(inviteError) }}</p>
            <div v-if="link" class="space-y-2">
              <Input :model-value="link" readonly class="h-11 font-mono text-xs" data-testid="friends-invite-link" :aria-label="t('social.invite.link')" @focus="selectAll" />
              <div class="flex gap-2">
                <Button type="button" variant="secondary" size="lg" data-testid="friends-invite-copy" @click="copyLink">
                  <component :is="copied ? Check : Copy" aria-hidden="true" />
                  {{ copied ? t('social.copied') : t('social.copy') }}
                </Button>
                <Button v-if="canShare" type="button" variant="secondary" size="lg" @click="shareLink">
                  <Share2 aria-hidden="true" />
                  {{ t('social.invite.share') }}
                </Button>
              </div>
              <p class="text-xs text-text-secondary">{{ t('social.invite.expires') }}</p>
            </div>
          </div>
        </section>

        <!-- requests -->
        <section v-if="friends.incoming.length || friends.outgoing.length" class="space-y-2">
          <h2 class="text-h2 font-semibold">{{ t('social.requests.title') }}</h2>
          <ul class="divide-y divide-border rounded-xl border border-border bg-card">
            <li v-for="r in friends.incoming" :key="r.requestId" class="flex items-center gap-3 p-3" data-testid="friend-request">
              <UserAvatar :user="r.from" size="sm" />
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ userName(r.from) }}</span>
              <Button type="button" data-testid="friend-request-accept" size="lg" @click="act(() => wallet.api.acceptFriendRequest(r.requestId))">{{ t('social.requests.accept') }}</Button>
              <Button type="button" variant="secondary" size="icon" :aria-label="t('social.requests.decline')" class="size-11" data-testid="friend-request-decline" @click="act(() => wallet.api.declineFriendRequest(r.requestId))">
                <X aria-hidden="true" />
              </Button>
            </li>
            <li v-for="r in friends.outgoing" :key="r.requestId" class="flex items-center gap-3 p-3" data-testid="friend-request-outgoing">
              <UserAvatar :user="r.to" size="sm" />
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ userName(r.to) }}</span>
              <Badge variant="neutral">{{ t('social.requests.pending') }}</Badge>
            </li>
          </ul>
        </section>

        <!-- friends -->
        <section class="space-y-2">
          <h2 class="text-h2 font-semibold">{{ t('social.friends.title') }}</h2>
          <p v-if="friends.friends.length === 0" class="rounded-xl border border-border bg-card p-4 text-sm text-text-secondary">{{ t('social.friends.empty') }}</p>
          <ul v-else class="divide-y divide-border rounded-xl border border-border bg-card">
            <li v-for="f in friends.friends" :key="f.userId" class="space-y-2 p-3" data-testid="friend-row">
              <div class="flex items-center gap-3">
                <UserAvatar :user="f" size="sm" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">{{ userName(f) }}</p>
                  <p v-if="f.handle" class="truncate font-mono text-xs text-text-secondary">@{{ f.handle }}</p>
                </div>
                <p
                  class="text-right text-sm font-medium tabular-nums"
                  :class="net(f.userId) > 0 ? 'text-success' : net(f.userId) < 0 ? 'text-danger' : 'text-text-secondary'"
                  data-testid="friend-balance"
                >
                  <template v-if="net(f.userId) > 0">{{ t('social.friends.owesYou', { amount: formatEuro(net(f.userId), locale) }) }}</template>
                  <template v-else-if="net(f.userId) < 0">{{ t('social.friends.youOwe', { amount: formatEuro(-net(f.userId), locale) }) }}</template>
                  <template v-else>{{ t('social.friends.even') }}</template>
                </p>
                <Button v-if="confirmRemove !== f.userId" type="button" variant="ghost" data-testid="friend-remove" @click="confirmRemove = f.userId">{{ t('social.friends.remove') }}</Button>
              </div>
              <div v-if="confirmRemove === f.userId" class="space-y-2 rounded-lg border border-danger-border bg-danger-soft p-3" role="alert">
                <p class="text-sm text-danger">{{ t('social.friends.removeConfirm', { name: userName(f) }) }}</p>
                <div class="flex gap-2">
                  <Button type="button" variant="destructive" size="lg" data-testid="friend-remove-confirm" @click="remove(f.userId)">{{ t('social.friends.removeYes') }}</Button>
                  <Button type="button" variant="secondary" size="lg" @click="confirmRemove = null">{{ t('social.cancel') }}</Button>
                </div>
              </div>
            </li>
          </ul>
        </section>

        <!-- shared with me -->
        <section class="space-y-2">
          <h2 class="text-h2 font-semibold">{{ t('social.shared.title') }}</h2>
          <p v-if="incomingShares.length === 0" class="rounded-xl border border-border bg-card p-4 text-sm text-text-secondary">{{ t('social.shared.empty') }}</p>
          <ul v-else class="divide-y divide-border rounded-xl border border-border bg-card">
            <li v-for="s in incomingShares" :key="s.id">
              <NuxtLink :to="`/shared/${s.id}`" data-testid="share-open" class="flex min-h-14 items-center gap-3 p-3 no-underline hover:bg-muted">
                <UserAvatar :user="s.from" size="sm" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-foreground">{{ s.merchantName }}</p>
                  <p class="truncate text-xs text-text-secondary">{{ t('social.shared.from', { name: userName(s.from), date: formatDateTime(s.sharedAt, locale) }) }}</p>
                </div>
                <span v-if="s.myReaction" aria-hidden="true">{{ s.myReaction }}</span>
                <span class="font-mono text-sm tabular-nums text-foreground">{{ formatEuro(s.total, locale) }}</span>
              </NuxtLink>
            </li>
          </ul>
        </section>

        <!-- splits -->
        <section class="space-y-2">
          <h2 class="text-h2 font-semibold">{{ t('social.splits.title') }}</h2>
          <p v-if="splits.length === 0" class="rounded-xl border border-border bg-card p-4 text-sm text-text-secondary">{{ t('social.splits.empty') }}</p>
          <ul v-else class="divide-y divide-border rounded-xl border border-border bg-card">
            <li v-for="s in splits" :key="s.id">
              <NuxtLink :to="`/splits/${s.id}`" data-testid="split-open" class="flex min-h-14 items-center gap-3 p-3 no-underline hover:bg-muted">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-foreground">{{ s.merchantName }}</p>
                  <p class="truncate text-xs text-text-secondary">{{ formatDateTime(s.createdAt, locale) }} · {{ s.creatorIsMe ? t('social.splits.byYou') : userName(s.creator) }}</p>
                </div>
                <span class="text-right text-sm font-medium tabular-nums" :class="s.openMinor === 0 ? 'text-text-secondary' : s.creatorIsMe ? 'text-success' : 'text-danger'">{{ openText(s) }}</span>
              </NuxtLink>
            </li>
          </ul>
        </section>
      </template>
    </template>
  </div>
</template>
