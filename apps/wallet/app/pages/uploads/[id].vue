<script setup lang="ts">
import { ChevronLeft, Plus, X } from '@lucide/vue';
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
    <NuxtLink to="/" class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary no-underline hover:text-brand-900">
      <ChevronLeft class="size-4" aria-hidden="true" />
      Alle bonnen
    </NuxtLink>
    <h1 class="text-h2 font-semibold">Bon uitlezen</h1>

    <p v-if="error" role="alert" data-testid="upload-error" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ error }}</p>

    <p v-if="!upload && !error" role="status" data-testid="upload-processing" class="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-text-secondary">
      <Spinner role="presentation" aria-hidden="true" />
      Bon laden…
    </p>

    <p
      v-else-if="upload && (upload.status === 'pending_upload' || upload.status === 'processing')"
      role="status"
      aria-live="polite"
      data-testid="upload-processing"
      class="rounded-xl border border-border bg-card p-4 text-text-secondary"
    >
      <Spinner class="mb-2 text-primary" role="presentation" aria-hidden="true" />
      We lezen je bon uit. Dit duurt meestal een paar seconden…
      <span v-if="timedOut" class="mt-2 block">Het duurt langer dan verwacht. Je kunt later terugkomen; we blijven werken.</span>
    </p>

    <section v-else-if="upload?.status === 'failed'" class="space-y-3 rounded-xl border border-danger-border bg-card p-4" role="alert" data-testid="upload-failed">
      <h2 class="text-h3 font-semibold">Uitlezen is niet gelukt</h2>
      <p class="text-text-secondary">We konden deze foto niet lezen. Probeer een scherpere foto, goed belicht en recht van boven.</p>
      <Button as-child variant="secondary" size="lg" class="w-full">
        <NuxtLink to="/add">Opnieuw proberen</NuxtLink>
      </Button>
    </section>

    <section v-else-if="upload?.status === 'replaced' && upload.matchedReceiptId" class="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="upload-replaced">
      <h2 class="text-h3 font-semibold">Vervangen door de officiële bon</h2>
      <Button as-child size="lg" class="w-full">
        <NuxtLink :to="`/receipts/${upload.matchedReceiptId}`">Bekijk de bon</NuxtLink>
      </Button>
    </section>

    <template v-else-if="upload">
      <section
        v-if="upload.matchedReceiptId && !matchDeclined && upload.status === 'done'"
        class="space-y-3 rounded-xl border-2 border-selected-border bg-card p-4"
        aria-labelledby="match-h"
        data-testid="match-offer"
      >
        <h2 id="match-h" class="text-h3 font-semibold">Officiële bon gevonden — vervangen?</h2>
        <p class="text-sm text-text-secondary">Official receipt found — replace?</p>
        <p v-if="upload.match" class="font-mono text-sm">
          {{ upload.match.merchantName }} · {{ formatEuro(upload.match.total) }} · {{ formatDateTime(upload.match.createdAt) }}
        </p>
        <p>De winkel heeft deze bon digitaal verstuurd. Vervang je foto door de officiële bon?</p>
        <div class="flex flex-col gap-2">
          <Button type="button" size="lg" data-testid="accept-match" :disabled="busy" @click="acceptMatch">Vervangen door de officiële bon</Button>
          <Button type="button" variant="secondary" size="lg" data-testid="decline-match" :disabled="busy" @click="matchDeclined = true">Nee, houd mijn foto</Button>
        </div>
      </section>

      <section v-if="upload.status === 'needs_review'" class="space-y-3" aria-labelledby="review-h" data-testid="correction-section">
        <div>
          <h2 id="review-h" class="text-h3 font-semibold">Controleer de gegevens</h2>
          <p class="text-text-secondary">We konden niet alles zeker lezen. Corrigeer wat er niet klopt.</p>
        </div>
        <ul v-if="upload.failures.length > 0" class="list-disc pl-5 text-sm text-text-secondary" data-testid="upload-failures">
          <li v-for="f in upload.failures" :key="f"><code class="font-mono">{{ f }}</code></li>
        </ul>
        <form class="space-y-4 rounded-xl border border-border bg-card p-4" data-testid="correction-form" novalidate @submit.prevent="submitCorrections">
          <div class="space-y-2">
            <Label for="corr-merchant">Winkel</Label>
            <Input id="corr-merchant" v-model="form.merchantName" class="h-11" data-testid="corr-merchant" required />
          </div>
          <div class="space-y-2">
            <Label for="corr-printed-at">Datum en tijd</Label>
            <Input id="corr-printed-at" v-model="form.printedAt" type="datetime-local" class="h-11" data-testid="corr-printed-at" required />
          </div>
          <div class="space-y-2">
            <Label for="corr-gross">Totaal (€)</Label>
            <Input id="corr-gross" v-model="form.gross" inputmode="decimal" class="h-11 font-mono" data-testid="corr-gross" required />
          </div>
          <fieldset class="space-y-3">
            <legend class="mb-2 text-label text-text-secondary">Regels</legend>
            <div v-for="(line, i) in form.lines" :key="i" class="grid grid-cols-[1fr_6rem_auto] items-end gap-2" data-testid="corr-line">
              <div class="space-y-2">
                <Label :for="`corr-line-desc-${i}`">Omschrijving</Label>
                <Input :id="`corr-line-desc-${i}`" v-model="line.description" class="h-11" :data-testid="`corr-line-desc-${i}`" />
              </div>
              <div class="space-y-2">
                <Label :for="`corr-line-total-${i}`">Bedrag</Label>
                <Input :id="`corr-line-total-${i}`" v-model="line.total" inputmode="decimal" class="h-11 font-mono" :data-testid="`corr-line-total-${i}`" />
              </div>
              <Button type="button" variant="secondary" class="size-11" :aria-label="`Regel ${i + 1} verwijderen`" @click="form.lines.splice(i, 1)">
                <X aria-hidden="true" />
              </Button>
            </div>
            <Button type="button" variant="secondary" size="lg" data-testid="corr-add-line" @click="addLine">
              <Plus aria-hidden="true" />
              Regel toevoegen
            </Button>
          </fieldset>
          <ul v-if="fieldErrors.length > 0" role="alert" class="list-disc pl-5 text-sm text-danger" data-testid="corr-errors">
            <li v-for="m in fieldErrors" :key="m">{{ m }}</li>
          </ul>
          <Button type="submit" size="lg" class="w-full" data-testid="corr-submit" :disabled="busy">Opslaan</Button>
        </form>
      </section>

      <section v-else-if="upload.status === 'done' && upload.draft" class="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="upload-done">
        <h2 class="text-h3 font-semibold">Bon toegevoegd</h2>
        <p class="text-sm text-text-secondary">
          {{ upload.draft.merchantName ?? 'Onbekende winkel' }}
          <template v-if="upload.draft.gross !== null"> · {{ formatEuro(upload.draft.gross) }}</template>
          <template v-if="upload.draft.printedAt"> · {{ formatDateTime(upload.draft.printedAt) }}</template>
        </p>
        <ul class="divide-y divide-dashed divide-border font-mono text-sm" data-testid="upload-draft-lines">
          <li v-for="(l, i) in upload.draft.lines" :key="i" class="flex justify-between gap-3 py-2">
            <span>{{ l.description }}</span>
            <span class="tabular-nums">{{ formatEuro(l.total) }}</span>
          </li>
        </ul>
        <Button as-child variant="secondary" size="lg" class="w-full">
          <NuxtLink to="/">Terug naar mijn bonnen</NuxtLink>
        </Button>
      </section>
    </template>
  </div>
</template>
