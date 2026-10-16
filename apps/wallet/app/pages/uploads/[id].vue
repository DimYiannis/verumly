<script setup lang="ts">
import { ApiError } from '~/utils/api';
import type { ParsedLineDto } from '@lr/schema';
import type { UploadStatus } from '~/utils/api-schemas';
import { amsterdamLocalToUtcIso, centsFromInput, formatDateTime, formatEuro, inputFromCents, utcIsoToAmsterdamLocal } from '~/utils/format';
import { pollUpload } from '~/utils/uploads';

definePageMeta({ middleware: 'auth' });
useHead({ title: 'Bon uitlezen' });

const route = useRoute();
const wallet = useWallet();
const id = String(route.params.id);

const upload = ref<UploadStatus | null>(null);
const timedOut = ref(false);
const error = ref<string | null>(null);
const busy = ref(false);
const matchDeclined = ref(false);
let stopped = false;

interface FormLine extends Omit<ParsedLineDto, 'total'> {
  /** euro text as typed */
  total: string;
}
const form = reactive<{ merchantName: string; printedAt: string; gross: string; lines: FormLine[] }>({ merchantName: '', printedAt: '', gross: '', lines: [] });
const fieldErrors = ref<string[]>([]);

function fillForm(u: UploadStatus) {
  form.merchantName = u.draft?.merchantName ?? '';
  form.printedAt = u.draft?.printedAt ? utcIsoToAmsterdamLocal(u.draft.printedAt) : '';
  form.gross = inputFromCents(u.draft?.gross ?? null);
  form.lines = (u.draft?.lines ?? []).map((l) => ({
    description: l.description,
    qty: l.qty,
    unitPrice: l.unitPrice,
    vatRate: l.vatRate,
    kind: l.kind,
    total: inputFromCents(l.total),
  }));
}

function setStatus(u: UploadStatus) {
  const wasReview = upload.value?.status === 'needs_review';
  upload.value = u;
  if (u.status === 'needs_review' && !wasReview) fillForm(u);
}

async function watchUpload() {
  timedOut.value = false;
  try {
    const settled = await pollUpload({
      fetchStatus: () => (stopped ? Promise.reject(new ApiError(0, 'stopped')) : wallet.api.getUpload(id)),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: Date.now,
      onStatus: setStatus,
    });
    timedOut.value = settled === null;
  } catch (e) {
    if (stopped) return;
    error.value = e instanceof ApiError && e.status === 404 ? 'Deze upload bestaat niet.' : e instanceof ApiError && e.isNetwork ? 'Geen verbinding.' : 'Status ophalen is niet gelukt.';
  }
}

function addLine() {
  form.lines.push({ description: '', qty: '1', unitPrice: null, vatRate: null, kind: 'item', total: '' });
}

async function submitCorrections() {
  fieldErrors.value = [];
  const gross = centsFromInput(form.gross);
  const printedAt = form.printedAt ? amsterdamLocalToUtcIso(form.printedAt) : null;
  if (!form.merchantName.trim()) fieldErrors.value.push('Vul de naam van de winkel in.');
  if (gross === null) fieldErrors.value.push('Vul het totaalbedrag in, bijvoorbeeld 12,50.');
  if (!printedAt) fieldErrors.value.push('Vul datum en tijd van de bon in.');
  const lines = form.lines.map((l) => ({ ...l, cents: centsFromInput(l.total) }));
  if (lines.some((l) => !l.description.trim() || l.cents === null)) fieldErrors.value.push('Elke regel heeft een omschrijving en een bedrag nodig.');
  if (fieldErrors.value.length > 0 || gross === null || !printedAt) return;

  busy.value = true;
  error.value = null;
  try {
    setStatus(
      await wallet.api.patchUpload(id, {
        merchantName: form.merchantName.trim(),
        printedAt,
        gross,
        // the API rejects an empty line list, so an empty form leaves the lines as extracted
        lines: lines.length === 0 ? undefined : lines.map((l) => ({ description: l.description.trim(), qty: l.qty, unitPrice: l.unitPrice, total: l.cents ?? 0, vatRate: l.vatRate, kind: l.kind })),
      }),
    );
  } catch (e) {
    error.value = e instanceof ApiError && e.isNetwork ? 'Geen verbinding.' : 'Opslaan is niet gelukt.';
  } finally {
    busy.value = false;
  }
}

async function acceptMatch() {
  busy.value = true;
  error.value = null;
  try {
    const { receiptId } = await wallet.api.acceptMatch(id);
    await wallet.cacheReceipt(receiptId);
    await navigateTo({ path: `/receipts/${receiptId}`, query: { saved: '1' } });
  } catch (e) {
    error.value = e instanceof ApiError && e.isNetwork ? 'Geen verbinding.' : 'Vervangen is niet gelukt.';
  } finally {
    busy.value = false;
  }
}

onMounted(() => void watchUpload());
onBeforeUnmount(() => {
  stopped = true;
});
</script>

<template>
  <div class="space-y-4">
    <NuxtLink to="/" class="inline-block py-2 font-medium text-brand-700 underline">← Alle bonnen</NuxtLink>
    <h1 class="text-2xl font-bold">Bon uitlezen</h1>

    <p v-if="error" role="alert" data-testid="upload-error" class="rounded-xl bg-red-50 p-3 text-red-900">{{ error }}</p>

    <p v-if="!upload && !error" role="status" data-testid="upload-processing" class="card">Bon laden…</p>

    <p v-else-if="upload && (upload.status === 'pending_upload' || upload.status === 'processing')" role="status" aria-live="polite" data-testid="upload-processing" class="card">
      We lezen je bon uit. Dit duurt meestal een paar seconden…
      <span v-if="timedOut" class="mt-2 block">Het duurt langer dan verwacht. Je kunt later terugkomen; we blijven werken.</span>
    </p>

    <section v-else-if="upload?.status === 'failed'" class="card space-y-2" role="alert" data-testid="upload-failed">
      <h2 class="font-semibold">Uitlezen is niet gelukt</h2>
      <p>We konden deze foto niet lezen. Probeer een scherpere foto, goed belicht en recht van boven.</p>
      <NuxtLink to="/add" class="btn btn-secondary">Opnieuw proberen</NuxtLink>
    </section>

    <section v-else-if="upload?.status === 'replaced' && upload.matchedReceiptId" class="card space-y-2" data-testid="upload-replaced">
      <h2 class="font-semibold">Vervangen door de officiële bon</h2>
      <NuxtLink :to="`/receipts/${upload.matchedReceiptId}`" class="btn btn-primary w-full">Bekijk de bon</NuxtLink>
    </section>

    <template v-else-if="upload">
      <section
        v-if="upload.matchedReceiptId && !matchDeclined && upload.status === 'done'"
        class="card space-y-3 border-2 border-brand-600"
        aria-labelledby="match-h"
        data-testid="match-offer"
      >
        <h2 id="match-h" class="text-lg font-bold">Officiële bon gevonden — vervangen?</h2>
        <p class="text-sm text-slate-700">Official receipt found — replace?</p>
        <p v-if="upload.match">
          {{ upload.match.merchantName }} · {{ formatEuro(upload.match.total) }} · {{ formatDateTime(upload.match.createdAt) }}
        </p>
        <p>De winkel heeft deze bon digitaal verstuurd. Vervang je foto door de officiële bon?</p>
        <div class="flex flex-col gap-3">
          <button type="button" class="btn btn-primary" data-testid="accept-match" :disabled="busy" @click="acceptMatch">Vervangen door de officiële bon</button>
          <button type="button" class="btn btn-secondary" data-testid="decline-match" :disabled="busy" @click="matchDeclined = true">Nee, houd mijn foto</button>
        </div>
      </section>

      <section v-if="upload.status === 'needs_review'" aria-labelledby="review-h" data-testid="correction-section">
        <h2 id="review-h" class="text-lg font-bold">Controleer de gegevens</h2>
        <p class="mb-3">We konden niet alles zeker lezen. Corrigeer wat er niet klopt.</p>
        <ul v-if="upload.failures.length > 0" class="mb-3 list-disc pl-5 text-sm text-slate-800" data-testid="upload-failures">
          <li v-for="f in upload.failures" :key="f"><code>{{ f }}</code></li>
        </ul>
        <form class="card space-y-3" data-testid="correction-form" novalidate @submit.prevent="submitCorrections">
          <label class="block font-medium">
            Winkel
            <input v-model="form.merchantName" class="input mt-1" data-testid="corr-merchant" required />
          </label>
          <label class="block font-medium">
            Datum en tijd
            <input v-model="form.printedAt" type="datetime-local" class="input mt-1" data-testid="corr-printed-at" required />
          </label>
          <label class="block font-medium">
            Totaal (€)
            <input v-model="form.gross" inputmode="decimal" class="input mt-1" data-testid="corr-gross" required />
          </label>
          <fieldset class="space-y-3">
            <legend class="font-medium">Regels</legend>
            <div v-for="(line, i) in form.lines" :key="i" class="grid grid-cols-[1fr_5rem_auto] items-end gap-2" data-testid="corr-line">
              <label class="text-sm">
                Omschrijving
                <input v-model="line.description" class="input mt-1" :data-testid="`corr-line-desc-${i}`" />
              </label>
              <label class="text-sm">
                Bedrag
                <input v-model="line.total" inputmode="decimal" class="input mt-1" :data-testid="`corr-line-total-${i}`" />
              </label>
              <button type="button" class="btn btn-secondary px-3" :aria-label="`Regel ${i + 1} verwijderen`" @click="form.lines.splice(i, 1)">✕</button>
            </div>
            <button type="button" class="btn btn-secondary" data-testid="corr-add-line" @click="addLine">Regel toevoegen</button>
          </fieldset>
          <ul v-if="fieldErrors.length > 0" role="alert" class="list-disc pl-5 text-red-800" data-testid="corr-errors">
            <li v-for="m in fieldErrors" :key="m">{{ m }}</li>
          </ul>
          <button type="submit" class="btn btn-primary w-full" data-testid="corr-submit" :disabled="busy">Opslaan</button>
        </form>
      </section>

      <section v-else-if="upload.status === 'done' && upload.draft" class="card space-y-2" data-testid="upload-done">
        <h2 class="font-semibold">Bon toegevoegd</h2>
        <p>
          {{ upload.draft.merchantName ?? 'Onbekende winkel' }}
          <template v-if="upload.draft.gross !== null"> · {{ formatEuro(upload.draft.gross) }}</template>
          <template v-if="upload.draft.printedAt"> · {{ formatDateTime(upload.draft.printedAt) }}</template>
        </p>
        <ul class="divide-y divide-slate-100" data-testid="upload-draft-lines">
          <li v-for="(l, i) in upload.draft.lines" :key="i" class="flex justify-between py-1">
            <span>{{ l.description }}</span>
            <span class="tabular-nums">{{ formatEuro(l.total) }}</span>
          </li>
        </ul>
        <NuxtLink to="/" class="btn btn-secondary w-full">Terug naar mijn bonnen</NuxtLink>
      </section>
    </template>
  </div>
</template>
