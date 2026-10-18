<script setup lang="ts">
import { WifiOff } from '@lucide/vue';
import type { MessageKey } from '~/i18n';
import { ApiError } from '~/utils/api';
import type { ResolveView } from '~/utils/api-schemas';
import { UUIDV7_RE } from '~/utils/receipt-link';
import { pendingPollDelayMs } from '~/utils/retry';

type Phase = 'loading' | 'invalid' | 'nolink' | 'ready' | 'pending' | 'arriving' | 'notfound' | 'limited' | 'error';
type OkView = Extract<ResolveView, { status: 'ok' }>;

const route = useRoute();
const wallet = useWallet();
const { t } = useLocale();
const id = String(route.params.id);

const phase = ref<Phase>('loading');
const view = shallowRef<OkView | null>(null);
const secret = ref<string | null>(null);
const sheetOpen = ref(false);
const dismissed = ref(false);
const takenByOther = ref(false);
const busy = ref(false);
const claimError = ref<MessageKey | null>(null);
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let pollAttempt = 0;

useHead({ title: () => t('viewer.pageTitle') });

/** Park the secret so a reload, a login round trip or a dead network cannot lose it. */
async function queue(autoClaim: boolean) {
  if (secret.value) await wallet.claims.add(id, secret.value, autoClaim);
  await wallet.refreshPending();
}

async function dropPending() {
  await wallet.claims.remove(id);
  await wallet.refreshPending();
}

async function isMine(): Promise<boolean> {
  try {
    await wallet.cache.putDetail(await wallet.api.getReceipt(id));
    return true;
  } catch {
    return false;
  }
}

async function goToSaved(saved: boolean) {
  await dropPending();
  await navigateTo({ path: `/receipts/${id}`, query: saved ? { saved: '1' } : {} }, { replace: true });
}

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => void resolve(), pendingPollDelayMs(pollAttempt++));
}

async function resolve() {
  const s = secret.value;
  if (!s) return;
  try {
    const res = await wallet.api.resolveView(id, s);
    if (res.status === 'pending') {
      // the shop's upload has not reached us yet: keep the secret, keep asking
      await queue(wallet.session.value !== null);
      phase.value = 'pending';
      schedulePoll();
      return;
    }
    view.value = res;
    phase.value = 'ready';
    if (res.preview.claimed && wallet.session.value) {
      if (await isMine()) return goToSaved(false);
      takenByOther.value = true;
      await dropPending();
      return;
    }
    if (wallet.session.value) sheetOpen.value = true;
  } catch (e) {
    if (!(e instanceof ApiError)) phase.value = 'error';
    else if (e.isNetwork) {
      await queue(wallet.session.value !== null);
      phase.value = 'arriving';
    } else if (e.status === 404) {
      await dropPending();
      phase.value = 'notfound';
    } else phase.value = e.status === 429 ? 'limited' : 'error';
  }
}

async function load() {
  if (!UUIDV7_RE.test(id)) {
    phase.value = 'invalid';
    return;
  }
  const parked = await wallet.claims.get(id);
  secret.value = wallet.vault[id] ?? (parked?.status === 'pending' ? parked.secret : null);
  if (!secret.value) {
    // /r/<id> without a fragment: this is either a receipt we already saved, or an incomplete link
    if (wallet.session.value && (await isMine())) return goToSaved(false);
    phase.value = 'nolink';
    return;
  }
  await resolve();
}

async function save() {
  const s = secret.value;
  if (!s) return;
  busy.value = true;
  claimError.value = null;
  try {
    await wallet.api.claim(id, s);
    await wallet.cacheReceipt(id);
    await goToSaved(true);
  } catch (e) {
    if (!(e instanceof ApiError)) claimError.value = 'viewer.err.saveFailed';
    else if (e.isNetwork || e.status === 404 || e.status >= 500) {
      // keep the secret; the wallet shows it as "Arriving" and claims it when it can
      await queue(true);
      sheetOpen.value = false;
      phase.value = 'arriving';
    } else if (e.status === 409) {
      takenByOther.value = true;
      sheetOpen.value = false;
      await dropPending();
    } else if (e.status === 410) claimError.value = 'viewer.err.claimExpired';
    else if (e.status === 401) {
      await queue(false);
      await wallet.endSession();
      await navigateTo({ path: '/login', query: { next: `/r/${id}` } });
    } else claimError.value = 'viewer.err.saveFailed';
  } finally {
    busy.value = false;
  }
}

async function notMine() {
  await dropPending();
  sheetOpen.value = false;
  dismissed.value = true;
}

function reopenSheet() {
  dismissed.value = false;
  sheetOpen.value = true;
}

async function saveToWallet() {
  await queue(false);
  await navigateTo({ path: '/login', query: { next: `/r/${id}` } });
}

// back online: let the retrier claim first; if the shop's data is there but we are not, resolve again
watch(wallet.online, async (isOnline) => {
  if (!isOnline || (phase.value !== 'arriving' && phase.value !== 'pending')) return;
  await wallet.retryPending();
  if (wallet.session.value && (await isMine())) return goToSaved(false);
  pollAttempt = 0;
  await resolve();
});
watch(wallet.savedTick, async () => {
  if (wallet.session.value && (await isMine())) await goToSaved(false);
});

onMounted(load);
onBeforeUnmount(() => clearTimeout(pollTimer));
</script>

<template>
  <div>
    <p v-if="phase === 'loading'" role="status" data-testid="loading" class="flex items-center gap-2 text-sm text-text-secondary">
      <Spinner role="presentation" aria-hidden="true" />
      {{ t('viewer.loading') }}
    </p>

    <section v-else-if="phase === 'invalid'" class="space-y-2 rounded-xl border border-danger-border bg-card p-4" role="alert" data-testid="invalid-link">
      <h1 class="text-h2 font-semibold">{{ t('viewer.invalidTitle') }}</h1>
      <p class="text-text-secondary">{{ t('viewer.invalidBody') }}</p>
    </section>

    <section v-else-if="phase === 'nolink'" class="space-y-3 rounded-xl border border-border bg-card p-4" role="alert" data-testid="incomplete-link">
      <h1 class="text-h2 font-semibold">{{ t('viewer.incompleteTitle') }}</h1>
      <p class="text-text-secondary">{{ t('viewer.incompleteBody') }}</p>
      <Button v-if="wallet.session.value" as-child variant="secondary" size="lg" class="w-full">
        <NuxtLink to="/">{{ t('common.toMyReceipts') }}</NuxtLink>
      </Button>
    </section>

    <section v-else-if="phase === 'notfound'" class="space-y-2 rounded-xl border border-border bg-card p-4" role="alert" data-testid="not-found">
      <h1 class="text-h2 font-semibold">{{ t('viewer.notFoundTitle') }}</h1>
      <p class="text-text-secondary">{{ t('viewer.notFoundBody') }}</p>
    </section>

    <section v-else-if="phase === 'limited'" class="space-y-2 rounded-xl border border-warning-border bg-card p-4" role="alert" data-testid="rate-limited">
      <h1 class="text-h2 font-semibold">{{ t('viewer.limitedTitle') }}</h1>
      <p class="text-text-secondary">{{ t('viewer.limitedBody') }}</p>
    </section>

    <section v-else-if="phase === 'error'" class="space-y-3 rounded-xl border border-danger-border bg-card p-4" role="alert" data-testid="load-error">
      <h1 class="text-h2 font-semibold">{{ t('viewer.errorTitle') }}</h1>
      <Button type="button" variant="secondary" size="lg" class="w-full" @click="resolve">{{ t('common.retry') }}</Button>
    </section>

    <section v-else-if="phase === 'arriving'" class="space-y-3 rounded-xl border border-border bg-card p-4" role="status" data-testid="arriving-state">
      <h1 class="flex items-center gap-2 text-h2 font-semibold">
        <WifiOff class="size-5 text-warning" aria-hidden="true" />
        {{ t('viewer.arrivingTitle') }}
      </h1>
      <p class="text-text-secondary">{{ t('viewer.arrivingBody') }}</p>
      <p v-if="!wallet.session.value" class="text-text-secondary">{{ t('viewer.arrivingLogin') }}</p>
      <Button as-child variant="secondary" size="lg" class="w-full">
        <NuxtLink :to="wallet.session.value ? '/' : { path: '/login', query: { next: `/r/${id}` } }">
          {{ wallet.session.value ? t('common.toMyReceipts') : t('common.login') }}
        </NuxtLink>
      </Button>
    </section>

    <section v-else-if="phase === 'pending'" class="space-y-3 rounded-xl border border-border bg-card p-4" role="status" data-testid="pending-state">
      <h1 class="flex items-center gap-2 text-h2 font-semibold">
        <Spinner class="text-primary" role="presentation" aria-hidden="true" />
        {{ t('viewer.pendingTitle') }}
      </h1>
      <p class="text-text-secondary">{{ t('viewer.pendingBody') }}</p>
      <Button v-if="wallet.session.value" as-child variant="secondary" size="lg" class="w-full">
        <NuxtLink to="/">{{ t('common.toMyReceipts') }}</NuxtLink>
      </Button>
    </section>

    <template v-else-if="view">
      <p v-if="takenByOther" role="alert" data-testid="taken-notice" class="mb-4 rounded-xl border border-border bg-card p-4 text-sm">
        {{ t('viewer.taken') }}
      </p>
      <p v-else-if="dismissed" role="status" data-testid="dismissed-notice" class="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-sm">
        {{ t('viewer.dismissed') }}
        <Button type="button" size="lg" data-testid="reopen-sheet" @click="reopenSheet">{{ t('viewer.reopen') }}</Button>
      </p>
      <!-- the sheet is modal: keep the receipt behind it out of the tab order and the accessibility tree -->
      <div :inert="sheetOpen">
        <ReceiptView :detail="view" />
      </div>
      <div v-if="!wallet.session.value && !takenByOther" class="sticky bottom-[calc(1rem+env(safe-area-inset-bottom))] mt-4">
        <Button type="button" size="lg" class="w-full shadow-md" data-testid="save-to-wallet" @click="saveToWallet">{{ t('viewer.saveToWallet') }}</Button>
      </div>
      <ConfirmSheet
        v-if="sheetOpen"
        :merchant="view.preview.merchantName"
        :total="view.preview.total"
        :currency="view.preview.currency"
        :time="view.preview.createdAt"
        :busy="busy"
        :error="claimError"
        @save="save"
        @reject="notMine"
      />
    </template>
  </div>
</template>
