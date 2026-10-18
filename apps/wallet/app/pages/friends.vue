<script setup lang="ts">
import { ChevronRight, X } from '@lucide/vue';
import type { MessageKey } from '~/i18n';
import type { ActivityItem, Balances, FriendsResponse, Profile } from '~/utils/api-schemas';
import { ACTIVITY_SENTENCE, activityTarget, sentenceParts } from '~/utils/activity';
import { formatMoney } from '~/utils/format';
import { formatRelative } from '~/utils/relative-time';
import { AVATARS, errorKey, handleHint, inviteLink, isOffline, userName } from '~/utils/social';

definePageMeta({ middleware: 'auth' });

const NuxtLinkC = resolveComponent('NuxtLink');
const wallet = useWallet();
const { t, locale } = useLocale();
const receiptHost = useRuntimeConfig().public.receiptHost;
useHead({ title: () => t('social.title') });

const status = ref<'loading' | 'ready' | 'offline' | 'error'>('loading');
const profile = ref<Profile | null>(null);
const friends = ref<FriendsResponse>({ friends: [], incoming: [], outgoing: [] });
const balances = ref<Balances>({ currency: 'EUR', friends: [], totalOwedToMe: 0, totalIOwe: 0 });
const activity = ref<ActivityItem[]>([]);

async function load() {
  try {
    const [p, f, b, a] = await Promise.all([wallet.api.getProfile(), wallet.api.getFriends(), wallet.api.getBalances(), wallet.api.getActivity()]);
    profile.value = p;
    friends.value = f;
    balances.value = b;
    activity.value = a.items;
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
// an old error (that is you, no such username) is about the text that was typed: editing or clearing it ends it
watch(addHandle, () => {
  if (addMsg.value?.kind === 'err') addMsg.value = null;
});
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
async function createInvite() {
  inviteBusy.value = true;
  inviteError.value = null;
  try {
    link.value = inviteLink(receiptHost, (await wallet.api.createInvite()).code);
  } catch (e) {
    inviteError.value = errorKey(e);
  } finally {
    inviteBusy.value = false;
  }
}

/** the header button brings the add-a-friend card into view and focuses the username field */
function jumpToAdd() {
  const el = document.getElementById('add-friend');
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => document.getElementById('add-friend-input')?.focus({ preventScroll: true }), 250);
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
const selectedId = ref<string | null>(null);
const confirmRemove = ref<string | null>(null);
async function remove(userId: string) {
  if (await act(() => wallet.api.removeFriend(userId))) {
    confirmRemove.value = null;
    selectedId.value = null;
  }
}
function net(userId: string): number {
  const row = balances.value.friends.find((r) => r.user.userId === userId);
  return row ? row.owesMe - row.iOwe : 0;
}
const strip = computed(() => [...friends.value.friends].sort((a, b) => Math.abs(net(b.userId)) - Math.abs(net(a.userId))));
const selected = computed(() => friends.value.friends.find((f) => f.userId === selectedId.value) ?? null);
function toggleSelected(userId: string) {
  selectedId.value = selectedId.value === userId ? null : userId;
  confirmRemove.value = null;
}
function signed(cents: number): string {
  return `${cents > 0 ? '+' : '−'}${formatMoney(Math.abs(cents), locale.value, balances.value.currency)}`;
}

// ---- feed
const feed = computed(() => activity.value.filter((i) => i.kind !== 'friend_request'));
function sentence(i: ActivityItem): ReturnType<typeof sentenceParts> {
  const who = i.user ? userName(i.user) : '?';
  const key = ACTIVITY_SENTENCE[i.kind];
  return sentenceParts(t(key), {
    name: who,
    merchant: i.merchantName ?? '',
    amount: formatMoney(i.amountMinor ?? 0, locale.value, balances.value.currency),
    emoji: i.emoji ?? '',
  });
}
function detail(i: ActivityItem): string {
  const bits: string[] = [];
  if (i.merchantName && i.kind !== 'split_with_me' && i.kind !== 'split_created') bits.push(i.merchantName);
  if (i.kind === 'share_received' && i.amountMinor !== null) bits.push(formatMoney(i.amountMinor, locale.value, balances.value.currency));
  if (i.kind === 'split_created' && i.amountMinor !== null) bits.push(i.amountMinor > 0 ? t('rcpt.act.stillOpen', { amount: formatMoney(i.amountMinor, locale.value, balances.value.currency) }) : t('social.splits.settled'));
  if (i.kind === 'split_with_me' && i.amountMinor !== null) bits.push(t('rcpt.act.yourShare', { amount: formatMoney(i.amountMinor, locale.value, balances.value.currency) }));
  bits.push(formatRelative(i.at, locale.value));
  return bits.join(' · ');
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <h1 class="text-h2 font-semibold">{{ t('social.title') }}</h1>
      <Button v-if="status === 'ready' && profile && !needsProfile" type="button" size="sm" data-testid="friends-add-open" @click="jumpToAdd">{{ t('rcpt.friends.add') }}</Button>
    </div>
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
      <section data-testid="friends-profile" class="space-y-3 rounded-[14px] border border-border bg-card p-4">
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
          <PersonAvatar :user="profile" :name="userName(profile)" me />
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium">{{ profile.displayName }}</p>
            <p class="truncate font-mono text-sm text-text-secondary">@{{ profile.handle }}</p>
          </div>
          <Button type="button" variant="secondary" size="sm" data-testid="profile-edit" @click="editing = true">{{ t('social.profile.edit') }}</Button>
        </div>
      </section>

      <template v-if="!needsProfile">
        <!-- friends as people, with what is between you -->
        <section :aria-label="t('social.friends.title')" class="space-y-3">
          <p v-if="friends.friends.length === 0" class="rounded-[14px] border border-border bg-card p-4 text-sm text-text-secondary">{{ t('social.friends.empty') }}</p>
          <ul v-else class="-mx-4 flex gap-4 overflow-x-auto px-4 py-1">
            <li v-for="f in strip" :key="f.userId" data-testid="friend-row">
              <button type="button" class="flex w-16 flex-col items-center gap-1.5 text-center" :aria-expanded="selectedId === f.userId" :aria-label="userName(f)" data-testid="friend-open" @click="toggleSelected(f.userId)">
                <span class="rounded-full" :class="selectedId === f.userId ? 'ring-[3px] ring-selected ring-offset-0 outline outline-1 outline-primary' : ''">
                  <PersonAvatar :user="f" :name="userName(f)" :muted="net(f.userId) === 0" size="lg" />
                </span>
                <span class="w-full truncate text-xs">{{ userName(f) }}</span>
                <span
                  class="font-mono text-xs tabular-nums"
                  :class="net(f.userId) > 0 ? 'text-success' : net(f.userId) < 0 ? 'text-danger' : 'text-text-secondary'"
                  data-testid="friend-balance"
                >{{ net(f.userId) === 0 ? formatMoney(0, locale, balances.currency) : signed(net(f.userId)) }}</span>
              </button>
            </li>
          </ul>
          <div v-if="selected" class="space-y-2 rounded-[14px] border border-border bg-card p-4" data-testid="friend-panel">
            <div class="flex items-center gap-3">
              <PersonAvatar :user="selected" :name="userName(selected)" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ userName(selected) }}</p>
                <p v-if="selected.handle" class="truncate font-mono text-xs text-text-secondary">@{{ selected.handle }}</p>
              </div>
              <p class="text-right text-sm font-medium tabular-nums" :class="net(selected.userId) > 0 ? 'text-success' : net(selected.userId) < 0 ? 'text-danger' : 'text-text-secondary'">
                <template v-if="net(selected.userId) > 0">{{ t('social.friends.owesYou', { amount: formatMoney(net(selected.userId), locale, balances.currency) }) }}</template>
                <template v-else-if="net(selected.userId) < 0">{{ t('social.friends.youOwe', { amount: formatMoney(-net(selected.userId), locale, balances.currency) }) }}</template>
                <template v-else>{{ t('social.friends.even') }}</template>
              </p>
            </div>
            <Button v-if="confirmRemove !== selected.userId" type="button" variant="ghost" size="sm" data-testid="friend-remove" @click="confirmRemove = selected.userId">{{ t('social.friends.remove') }}</Button>
            <div v-else class="space-y-2 rounded-lg border border-danger-border bg-danger-soft p-3" role="alert">
              <p class="text-sm text-danger">{{ t('social.friends.removeConfirm', { name: userName(selected) }) }}</p>
              <div class="flex gap-2">
                <Button type="button" variant="destructive" size="lg" data-testid="friend-remove-confirm" @click="remove(selected.userId)">{{ t('social.friends.removeYes') }}</Button>
                <Button type="button" variant="secondary" size="lg" @click="confirmRemove = null">{{ t('social.cancel') }}</Button>
              </div>
            </div>
          </div>

          <!-- totals -->
          <div class="grid grid-cols-2 gap-2" :aria-label="t('social.balances.title')" role="group">
            <div class="rounded-[14px] border border-border bg-card p-3">
              <p class="text-xs text-text-secondary">{{ t('social.balances.owedToMe') }}</p>
              <p data-testid="balance-total-owed" class="font-mono text-lg font-medium tabular-nums text-success">{{ formatMoney(balances.totalOwedToMe, locale, balances.currency) }}</p>
            </div>
            <div class="rounded-[14px] border border-border bg-card p-3">
              <p class="text-xs text-text-secondary">{{ t('social.balances.iOwe') }}</p>
              <p data-testid="balance-total-owe" class="font-mono text-lg font-medium tabular-nums" :class="balances.totalIOwe > 0 ? 'text-danger' : ''">{{ formatMoney(balances.totalIOwe, locale, balances.currency) }}</p>
            </div>
          </div>
        </section>

        <p v-if="actionError" role="alert" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ t(actionError) }}</p>

        <!-- activity -->
        <section class="space-y-3" aria-labelledby="activity-h">
          <h2 id="activity-h" class="text-xs font-medium tracking-wide text-text-secondary uppercase">{{ t('rcpt.friends.activity') }}</h2>

          <div v-for="r in friends.incoming" :key="r.requestId" class="flex items-center gap-3 rounded-[14px] border border-border bg-card p-3.5" data-testid="friend-request">
            <PersonAvatar :user="r.from" :name="userName(r.from)" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-[15px]"><b class="font-semibold">{{ userName(r.from) }}</b> {{ t('rcpt.act.wantsFriend') }}</p>
            </div>
            <Button type="button" data-testid="friend-request-accept" @click="act(() => wallet.api.acceptFriendRequest(r.requestId))">{{ t('social.requests.accept') }}</Button>
            <Button type="button" variant="secondary" size="icon" :aria-label="t('social.requests.decline')" data-testid="friend-request-decline" @click="act(() => wallet.api.declineFriendRequest(r.requestId))">
              <X aria-hidden="true" />
            </Button>
          </div>
          <div v-for="r in friends.outgoing" :key="r.requestId" class="flex items-center gap-3 rounded-[14px] border border-border bg-card p-3.5" data-testid="friend-request-outgoing">
            <PersonAvatar :user="r.to" :name="userName(r.to)" />
            <span class="min-w-0 flex-1 truncate text-[15px] font-medium">{{ userName(r.to) }}</span>
            <Badge variant="neutral">{{ t('social.requests.pending') }}</Badge>
          </div>

          <p v-if="feed.length === 0 && friends.incoming.length === 0" class="rounded-[14px] border border-border bg-card p-4 text-sm text-text-secondary">{{ t('rcpt.friends.noActivity') }}</p>
          <template v-for="i in feed" :key="i.id">
            <component
              :is="activityTarget(i) ? NuxtLinkC : 'div'"
              v-bind="activityTarget(i) ? { to: activityTarget(i)!.to, 'data-testid': activityTarget(i)!.testid } : {}"
              class="flex items-center gap-3 rounded-[14px] border border-border bg-card p-3.5 text-foreground no-underline hover:text-foreground"
              :class="activityTarget(i) ? 'transition-colors hover:bg-muted' : ''"
            >
              <PersonAvatar :user="i.user" :name="i.user ? userName(i.user) : userName(profile)" :me="!i.user" />
              <div class="min-w-0 flex-1">
                <p class="text-[15px] leading-snug">
                  <template v-for="(p, n) in sentence(i)" :key="n"><b v-if="p.bold" class="font-semibold">{{ p.text }}</b><template v-else>{{ p.text }}</template></template>
                </p>
                <p class="truncate text-xs text-text-secondary">{{ detail(i) }}</p>
              </div>
              <ChevronRight v-if="activityTarget(i)" class="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
            </component>
          </template>
        </section>

        <!-- add a friend: by username, by invite link or QR, or by scanning a friend's code -->
        <section id="add-friend" class="scroll-mt-4 space-y-3 rounded-[14px] border border-border bg-card p-4" data-testid="friends-add">
          <h2 class="text-h3 font-semibold">{{ t('social.add.title') }}</h2>
          <form class="flex gap-2" @submit.prevent="addFriend">
            <Input
              id="add-friend-input"
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
          <div class="space-y-3 border-t border-border pt-3">
            <p class="text-sm text-text-secondary">{{ t('social.invite.body') }}</p>
            <Button type="button" variant="secondary" size="lg" data-testid="friends-invite-create" :disabled="inviteBusy" @click="createInvite">{{ t('social.invite.create') }}</Button>
            <p v-if="inviteError" role="alert" class="text-sm text-danger">{{ t(inviteError) }}</p>
            <InviteShare v-if="link" :link="link" />
            <InviteScan />
          </div>
        </section>
      </template>
    </template>
  </div>
</template>
