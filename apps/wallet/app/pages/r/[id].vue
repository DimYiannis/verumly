<script setup lang="ts">
import { ApiError } from '~/utils/api';
import type { ResolveView } from '~/utils/api-schemas';
import { UUIDV7_RE } from '~/utils/receipt-link';
import { pendingPollDelayMs } from '~/utils/retry';

type Phase = 'loading' | 'invalid' | 'nolink' | 'ready' | 'pending' | 'arriving' | 'notfound' | 'limited' | 'error';
type OkView = Extract<ResolveView, { status: 'ok' }>;

const route = useRoute();
const wallet = useWallet();
const id = String(route.params.id);

const phase = ref<Phase>('loading');
const view = shallowRef<OkView | null>(null);
const secret = ref<string | null>(null);
const sheetOpen = ref(false);
const dismissed = ref(false);
const takenByOther = ref(false);
const busy = ref(false);
const claimError = ref<string | null>(null);
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let pollAttempt = 0;

useHead({ title: 'Bon' });

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
    if (!(e instanceof ApiError)) claimError.value = 'Opslaan is niet gelukt. Probeer het opnieuw.';
    else if (e.isNetwork || e.status === 404 || e.status >= 500) {
      // keep the secret; the wallet shows it as "Arriving" and claims it when it can
      await queue(true);
      sheetOpen.value = false;
      phase.value = 'arriving';
    } else if (e.status === 409) {
      takenByOther.value = true;
      sheetOpen.value = false;
      await dropPending();
    } else if (e.status === 410) claimError.value = 'De bewaartermijn van deze bon is verstreken.';
    else if (e.status === 401) {
      await queue(false);
      await wallet.endSession();
      await navigateTo({ path: '/login', query: { next: `/r/${id}` } });
    } else claimError.value = 'Opslaan is niet gelukt. Probeer het opnieuw.';
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
    <p v-if="phase === 'loading'" role="status" data-testid="loading">Bon ophalen…</p>

    <section v-else-if="phase === 'invalid'" class="card" role="alert" data-testid="invalid-link">
      <h1 class="text-xl font-bold">Ongeldige link</h1>
      <p>Dit is geen geldige bonlink. Scan de QR-code op de bon opnieuw.</p>
    </section>

    <section v-else-if="phase === 'nolink'" class="card space-y-3" role="alert" data-testid="incomplete-link">
      <h1 class="text-xl font-bold">Link onvolledig</h1>
      <p>Het geheime deel van de link ontbreekt. Scan de QR-code op de bon opnieuw.</p>
      <NuxtLink v-if="wallet.session.value" to="/" class="btn btn-secondary">Naar mijn bonnen</NuxtLink>
    </section>

    <section v-else-if="phase === 'notfound'" class="card" role="alert" data-testid="not-found">
      <h1 class="text-xl font-bold">Bon niet gevonden</h1>
      <p>Deze link klopt niet. Vraag het personeel om een nieuwe QR-code.</p>
    </section>

    <section v-else-if="phase === 'limited'" class="card" role="alert" data-testid="rate-limited">
      <h1 class="text-xl font-bold">Even wachten</h1>
      <p>Er zijn te veel pogingen gedaan. Probeer het later opnieuw.</p>
    </section>

    <section v-else-if="phase === 'error'" class="card space-y-3" role="alert" data-testid="load-error">
      <h1 class="text-xl font-bold">Er ging iets mis</h1>
      <button type="button" class="btn btn-secondary" @click="resolve">Opnieuw proberen</button>
    </section>

    <section v-else-if="phase === 'arriving'" class="card space-y-3" role="status" data-testid="arriving-state">
      <h1 class="text-xl font-bold">Bon onderweg</h1>
      <p>Geen verbinding. We bewaren deze bon en halen hem op zodra je weer online bent.</p>
      <p v-if="!wallet.session.value">Log daarna in om hem op te slaan.</p>
      <NuxtLink :to="wallet.session.value ? '/' : { path: '/login', query: { next: `/r/${id}` } }" class="btn btn-secondary">
        {{ wallet.session.value ? 'Naar mijn bonnen' : 'Inloggen' }}
      </NuxtLink>
    </section>

    <section v-else-if="phase === 'pending'" class="card space-y-3" role="status" data-testid="pending-state">
      <h1 class="text-xl font-bold">Bon is bijna klaar</h1>
      <p>De kassa heeft de bon nog niet doorgestuurd. We blijven het proberen; je hoeft niets te doen.</p>
      <NuxtLink v-if="wallet.session.value" to="/" class="btn btn-secondary">Naar mijn bonnen</NuxtLink>
    </section>

    <template v-else-if="view">
      <p v-if="takenByOther" role="alert" data-testid="taken-notice" class="mb-4 rounded-xl border border-slate-300 bg-white p-3">
        Deze bon is al opgeslagen in een andere portemonnee.
      </p>
      <p v-else-if="dismissed" role="status" data-testid="dismissed-notice" class="mb-4 rounded-xl border border-slate-300 bg-white p-3">
        Niet opgeslagen.
        <button type="button" class="font-semibold underline" data-testid="reopen-sheet" @click="reopenSheet">Toch opslaan</button>
      </p>
      <!-- the sheet is modal: keep the receipt behind it out of the tab order and the accessibility tree -->
      <div :inert="sheetOpen">
        <ReceiptView :detail="view" />
      </div>
      <div v-if="!wallet.session.value && !takenByOther" class="sticky bottom-4 mt-4">
        <button type="button" class="btn btn-primary w-full shadow-lg" data-testid="save-to-wallet" @click="saveToWallet">Bewaar in portemonnee / Save to wallet</button>
      </div>
      <ConfirmSheet
        v-if="sheetOpen"
        :merchant="view.preview.merchantName"
        :total="view.preview.total"
        :time="view.preview.createdAt"
        :busy="busy"
        :error="claimError"
        @save="save"
        @reject="notMine"
      />
    </template>
  </div>
</template>
