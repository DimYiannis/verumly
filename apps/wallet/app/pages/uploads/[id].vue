<script setup lang="ts">
import { ChevronLeft, CircleCheck, Plus, Trash2, X } from '@lucide/vue';
import type { MessageKey } from '~/i18n';
import { ApiError } from '~/utils/api';
import { LINE_CATEGORIES, type LineCategory, type ParsedLineDto } from '@lr/schema';
import type { UploadStatus } from '~/utils/api-schemas';
import { amsterdamLocalToUtcIso, centsFromInput, formatDateTime, formatEuro, inputFromCents, utcIsoToAmsterdamLocal } from '~/utils/format';
import { pollUpload } from '~/utils/uploads';

definePageMeta({ middleware: 'auth' });
const { t, tOr, locale } = useLocale();
useHead({ title: () => t('uploadPage.pageTitle') });

const route = useRoute();
const wallet = useWallet();
const id = String(route.params.id);

const upload = ref<UploadStatus | null>(null);
const timedOut = ref(false);
const error = ref<MessageKey | null>(null);
const busy = ref(false);
const matchDeclined = ref(false);
const photoUrl = ref<string | null>(null);
const photoFailed = ref(false);
const confirmingDelete = ref(false);
let photoRequested = false;
let stopped = false;

interface FormLine extends Omit<ParsedLineDto, 'total' | 'category' | 'sensitive'> {
  /** euro text as typed */
  total: string;
  /** what the select shows: the stored category until the buyer picks another */
  category: string;
}
const form = reactive<{ merchantName: string; printedAt: string; gross: string; lines: FormLine[] }>({ merchantName: '', printedAt: '', gross: '', lines: [] });
const fieldErrors = ref<MessageKey[]>([]);

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
    userCategory: l.userCategory ?? null,
    category: l.category ?? 'overig',
    total: inputFromCents(l.total),
  }));
}

async function loadPhoto() {
  try {
    photoUrl.value = URL.createObjectURL(await wallet.api.uploadPhoto(id));
  } catch {
    photoFailed.value = true;
  }
}

function setStatus(u: UploadStatus) {
  const wasReview = upload.value?.status === 'needs_review';
  upload.value = u;
  if (u.status === 'needs_review' && !wasReview) fillForm(u);
  if (u.status !== 'pending_upload' && !photoRequested) {
    photoRequested = true;
    void loadPhoto();
  }
}

/** The steps the buyer sees: the photo is uploaded, then read, then there is a result. */
const STEPS = ['pending_upload', 'processing', 'result'] as const;
function stepState(step: (typeof STEPS)[number]): 'done' | 'active' | 'todo' {
  const status = upload.value?.status ?? 'pending_upload';
  const current = status === 'pending_upload' ? 0 : status === 'processing' ? 1 : 2;
  const index = STEPS.indexOf(step);
  if (index < current) return 'done';
  return index === current ? 'active' : 'todo';
}
const resultStep = computed(() => {
  const status = upload.value?.status;
  return status === 'done' || status === 'needs_review' || status === 'failed' || status === 'replaced' ? status : 'done';
});

function categoryOf(l: ParsedLineDto): string {
  return l.category ?? 'overig';
}

function vatLabel(rate: number | null): string {
  return rate === null ? t('uploadPage.vatNone') : `${t('uploadPage.vatRate')} ${rate}%`;
}

function pickedCategory(event: Event): LineCategory | undefined {
  const select = event.target;
  return select instanceof HTMLSelectElement ? LINE_CATEGORIES.find((c) => c === select.value) : undefined;
}

function pickFormCategory(line: FormLine, event: Event) {
  const category = pickedCategory(event);
  if (!category) return;
  line.category = category;
  line.userCategory = category;
}

/** Store the buyer's category for one line of a done upload (`null`: the rules decide again). */
async function saveCategory(index: number, category: LineCategory | null) {
  busy.value = true;
  error.value = null;
  try {
    setStatus(await wallet.api.setUploadCategories(id, [{ index, category }]));
  } catch (e) {
    error.value = e instanceof ApiError && e.isNetwork ? 'uploadPage.err.offline' : 'uploadPage.err.categoryFailed';
  } finally {
    busy.value = false;
  }
}

function pickDoneCategory(index: number, event: Event) {
  const category = pickedCategory(event);
  if (category) void saveCategory(index, category);
}

async function deleteUpload() {
  busy.value = true;
  error.value = null;
  try {
    stopped = true;
    await wallet.api.deleteUpload(id);
    // photo receipts are listed with the other receipts (/receipts since the home page redesign)
    await navigateTo('/receipts');
  } catch (e) {
    stopped = false;
    confirmingDelete.value = false;
    error.value = e instanceof ApiError && e.isNetwork ? 'uploadPage.err.offline' : 'uploadPage.err.deleteFailed';
  } finally {
    busy.value = false;
  }
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
    error.value = e instanceof ApiError && e.status === 404 ? 'uploadPage.err.notFound' : e instanceof ApiError && e.isNetwork ? 'uploadPage.err.offline' : 'uploadPage.err.status';
  }
}

function addLine() {
  form.lines.push({ description: '', qty: '1', unitPrice: null, vatRate: null, kind: 'item', total: '', category: 'overig', userCategory: null });
}

async function submitCorrections() {
  fieldErrors.value = [];
  const gross = centsFromInput(form.gross);
  const printedAt = form.printedAt ? amsterdamLocalToUtcIso(form.printedAt) : null;
  if (!form.merchantName.trim()) fieldErrors.value.push('uploadPage.field.merchant');
  if (gross === null) fieldErrors.value.push('uploadPage.field.gross');
  if (!printedAt) fieldErrors.value.push('uploadPage.field.printedAt');
  const lines = form.lines.map((l) => ({ ...l, cents: centsFromInput(l.total) }));
  if (lines.some((l) => !l.description.trim() || l.cents === null)) fieldErrors.value.push('uploadPage.field.lines');
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
        lines: lines.length === 0 ? undefined : lines.map((l) => ({ description: l.description.trim(), qty: l.qty, unitPrice: l.unitPrice, total: l.cents ?? 0, vatRate: l.vatRate, kind: l.kind, userCategory: l.userCategory ?? null })),
      }),
    );
  } catch (e) {
    error.value = e instanceof ApiError && e.isNetwork ? 'uploadPage.err.offline' : 'uploadPage.err.saveFailed';
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
    error.value = e instanceof ApiError && e.isNetwork ? 'uploadPage.err.offline' : 'uploadPage.err.replaceFailed';
  } finally {
    busy.value = false;
  }
}

onMounted(() => void watchUpload());
onBeforeUnmount(() => {
  stopped = true;
  if (photoUrl.value) URL.revokeObjectURL(photoUrl.value);
});
</script>

<template>
  <div class="space-y-4">
    <NuxtLink to="/receipts" class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary no-underline hover:text-brand-900">
      <ChevronLeft class="size-4" aria-hidden="true" />
      {{ t('common.allReceipts') }}
    </NuxtLink>
    <h1 class="text-h2 font-semibold">{{ t('uploadPage.title') }}</h1>

    <p v-if="error" role="alert" data-testid="upload-error" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ t(error) }}</p>

    <ol v-if="upload" class="flex gap-2 text-sm" data-testid="upload-status" :data-status="upload.status" :aria-label="t('uploadPage.statusLabel')">
      <li
        v-for="step in STEPS"
        :key="step"
        :data-testid="`upload-step-${step}`"
        :data-state="stepState(step)"
        class="flex-1 rounded-lg border px-2 py-1.5 text-center"
        :class="stepState(step) === 'active' ? (step === 'result' && upload.status === 'failed' ? 'border-danger-border bg-danger-soft text-danger' : 'border-selected-border bg-selected font-medium text-accent-foreground') : stepState(step) === 'done' ? 'border-border bg-card text-foreground' : 'border-border bg-muted text-text-secondary'"
      >
        {{ t(`uploadPage.step.${step === 'result' ? resultStep : step}`) }}
      </li>
    </ol>

    <p v-if="!upload && !error" role="status" data-testid="upload-processing" class="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-text-secondary">
      <Spinner role="presentation" aria-hidden="true" />
      {{ t('uploadPage.loading') }}
    </p>

    <p
      v-else-if="upload && (upload.status === 'pending_upload' || upload.status === 'processing')"
      role="status"
      aria-live="polite"
      data-testid="upload-processing"
      class="rounded-xl border border-border bg-card p-4 text-text-secondary"
    >
      <Spinner class="mb-2 text-primary" role="presentation" aria-hidden="true" />
      {{ t('uploadPage.processing') }}
      <span v-if="timedOut" class="mt-2 block">{{ t('uploadPage.slow') }}</span>
    </p>

    <section v-else-if="upload?.status === 'failed'" class="space-y-3 rounded-xl border border-danger-border bg-card p-4" role="alert" data-testid="upload-failed">
      <h2 class="text-h3 font-semibold">{{ t('uploadPage.failedTitle') }}</h2>
      <p class="text-text-secondary">{{ t('uploadPage.failedBody') }}</p>
      <ul v-if="upload.failures.length > 0" class="list-disc pl-5 text-sm text-danger" data-testid="upload-failed-reason" :aria-label="t('uploadPage.reason')">
        <li v-for="f in upload.failures" :key="f">{{ tOr('uploadFailure', f) }}</li>
      </ul>
      <Button as-child variant="secondary" size="lg" class="w-full">
        <NuxtLink to="/add">{{ t('common.retry') }}</NuxtLink>
      </Button>
    </section>

    <section v-else-if="upload?.status === 'replaced' && upload.matchedReceiptId" class="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="upload-replaced">
      <h2 class="text-h3 font-semibold">{{ t('uploadPage.replacedTitle') }}</h2>
      <Button as-child size="lg" class="w-full">
        <NuxtLink :to="`/receipts/${upload.matchedReceiptId}`">{{ t('uploadPage.viewReceipt') }}</NuxtLink>
      </Button>
    </section>

    <template v-else-if="upload">
      <section
        v-if="upload.matchedReceiptId && !matchDeclined && upload.status === 'done'"
        class="space-y-3 rounded-xl border border-success-border bg-success-soft p-4"
        aria-labelledby="match-h"
        data-testid="match-offer"
      >
        <div class="flex items-start gap-3">
          <CircleCheck class="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <h2 id="match-h" class="font-semibold">{{ t('uploadPage.matchTitle') }}</h2>
            <p v-if="t('uploadPage.matchEn')" class="text-xs text-success">{{ t('uploadPage.matchEn') }}</p>
            <p v-if="upload.match" class="mt-1 font-mono text-sm">
              {{ upload.match.merchantName }} · {{ formatEuro(upload.match.total, locale) }} · {{ formatDateTime(upload.match.createdAt, locale) }}
            </p>
            <p class="mt-1 text-sm">{{ t('uploadPage.matchBody') }}</p>
          </div>
        </div>
        <div class="flex flex-col gap-2">
          <Button type="button" size="lg" data-testid="accept-match" :disabled="busy" @click="acceptMatch">{{ t('uploadPage.accept') }}</Button>
          <Button type="button" variant="secondary" size="lg" data-testid="decline-match" :disabled="busy" @click="matchDeclined = true">{{ t('uploadPage.decline') }}</Button>
        </div>
      </section>

      <section v-if="upload.status === 'needs_review'" class="space-y-3" aria-labelledby="review-h" data-testid="correction-section">
        <div>
          <h2 id="review-h" class="text-h3 font-semibold">{{ t('uploadPage.reviewTitle') }}</h2>
          <p class="text-text-secondary">{{ t('uploadPage.reviewBody') }}</p>
        </div>
        <ul v-if="upload.failures.length > 0" class="list-disc pl-5 text-sm text-text-secondary" data-testid="upload-failures">
          <li v-for="f in upload.failures" :key="f"><code class="font-mono">{{ f }}</code></li>
        </ul>
        <form class="space-y-4 rounded-xl border border-border bg-card p-4" data-testid="correction-form" novalidate @submit.prevent="submitCorrections">
          <div class="space-y-2">
            <Label for="corr-merchant" class="text-label text-text-secondary uppercase">{{ t('uploadPage.merchant') }}</Label>
            <Input id="corr-merchant" v-model="form.merchantName" class="h-11" data-testid="corr-merchant" required />
          </div>
          <div class="space-y-2">
            <Label for="corr-printed-at" class="text-label text-text-secondary uppercase">{{ t('uploadPage.dateTime') }}</Label>
            <Input id="corr-printed-at" v-model="form.printedAt" type="datetime-local" class="h-11" data-testid="corr-printed-at" required />
          </div>
          <div class="space-y-2">
            <Label for="corr-gross" class="text-label text-text-secondary uppercase">{{ t('uploadPage.gross') }}</Label>
            <Input id="corr-gross" v-model="form.gross" inputmode="decimal" class="h-11 font-mono" data-testid="corr-gross" required />
          </div>
          <fieldset class="space-y-3">
            <legend class="mb-2 flex w-full items-center justify-between text-label text-text-secondary uppercase">{{ t('uploadPage.lines') }}<Badge variant="neutral">{{ form.lines.length }}</Badge></legend>
            <div v-for="(line, i) in form.lines" :key="i" class="grid grid-cols-[1fr_6rem_auto] items-end gap-2 border-b border-dashed border-border pb-3" data-testid="corr-line" :data-category="line.category">
              <div class="space-y-2">
                <Label :for="`corr-line-desc-${i}`">{{ t('uploadPage.lineDesc') }}</Label>
                <Input :id="`corr-line-desc-${i}`" v-model="line.description" class="h-11" :data-testid="`corr-line-desc-${i}`" />
              </div>
              <div class="space-y-2">
                <Label :for="`corr-line-total-${i}`">{{ t('uploadPage.lineAmount') }}</Label>
                <Input :id="`corr-line-total-${i}`" v-model="line.total" inputmode="decimal" class="h-11 font-mono" :data-testid="`corr-line-total-${i}`" />
              </div>
              <Button type="button" variant="secondary" class="size-11" :aria-label="t('uploadPage.removeLine', { n: i + 1 })" @click="form.lines.splice(i, 1)">
                <X aria-hidden="true" />
              </Button>
              <p class="col-span-3 text-xs text-text-secondary" :data-testid="`corr-line-vat-${i}`">{{ vatLabel(line.vatRate) }}</p>
              <div class="col-span-3 space-y-2">
                <Label :for="`corr-line-category-${i}`">{{ t('uploadPage.category') }}</Label>
                <select
                  :id="`corr-line-category-${i}`"
                  :value="line.category"
                  class="h-11 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring"
                  :data-testid="`corr-line-category-${i}`"
                  @change="pickFormCategory(line, $event)"
                >
                  <option v-for="c in LINE_CATEGORIES" :key="c" :value="c">{{ tOr('category', c) }}</option>
                </select>
              </div>
            </div>
            <Button type="button" variant="secondary" size="lg" data-testid="corr-add-line" @click="addLine">
              <Plus aria-hidden="true" />
              {{ t('uploadPage.addLine') }}
            </Button>
          </fieldset>
          <ul v-if="fieldErrors.length > 0" role="alert" class="list-disc pl-5 text-sm text-danger" data-testid="corr-errors">
            <li v-for="m in fieldErrors" :key="m">{{ t(m) }}</li>
          </ul>
          <Button type="submit" size="lg" class="w-full" data-testid="corr-submit" :disabled="busy">{{ t('uploadPage.submit') }}</Button>
        </form>
      </section>

      <section v-else-if="upload.status === 'done' && upload.draft" class="space-y-4 rounded-xl border border-border bg-card p-4" data-testid="upload-done">
        <h2 class="text-h3 font-semibold">{{ t('uploadPage.doneTitle') }}</h2>
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" data-testid="upload-detail">
          <dt class="text-text-secondary">{{ t('uploadPage.shop') }}</dt>
          <dd class="text-right font-medium" data-testid="upload-merchant">{{ upload.draft.merchantName ?? t('common.unknownMerchant') }}</dd>
          <dt class="text-text-secondary">{{ t('uploadPage.date') }}</dt>
          <dd class="text-right" data-testid="upload-date">{{ upload.draft.printedAt ? formatDateTime(upload.draft.printedAt, locale) : '–' }}</dd>
          <dt class="text-text-secondary">{{ t('uploadPage.payment') }}</dt>
          <dd class="text-right" data-testid="upload-payment">{{ upload.draft.paymentMethod ? tOr('uploadPage.pay', upload.draft.paymentMethod) : '–' }}</dd>
          <dt class="text-text-secondary">{{ t('uploadPage.total') }}</dt>
          <dd class="text-right font-mono font-medium tabular-nums" data-testid="upload-total">{{ upload.draft.gross !== null ? formatEuro(upload.draft.gross, locale) : '–' }}</dd>
        </dl>

        <div>
          <h3 class="mb-2 text-label text-text-secondary">{{ t('uploadPage.items') }}</h3>
          <ul class="divide-y divide-dashed divide-border text-sm" data-testid="upload-draft-lines">
            <li
              v-for="(l, i) in upload.draft.lines"
              :key="i"
              class="space-y-2 py-3"
              data-testid="upload-line"
              :data-category="categoryOf(l)"
              :data-vat-rate="l.vatRate ?? ''"
              :data-user-category="l.userCategory ?? ''"
            >
              <div class="flex justify-between gap-3 font-mono">
                <span>{{ l.description }}</span>
                <span class="tabular-nums">{{ formatEuro(l.total, locale) }}</span>
              </div>
              <div class="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                <Badge variant="neutral" :data-testid="`line-vat-${i}`">{{ vatLabel(l.vatRate) }}</Badge>
                <Badge v-if="l.userCategory" variant="accent" :data-testid="`line-edited-${i}`">{{ t('uploadPage.categoryEdited') }}</Badge>
              </div>
              <div class="flex items-center gap-2">
                <Label :for="`line-category-${i}`" class="sr-only">{{ t('uploadPage.categoryOf', { item: l.description }) }}</Label>
                <select
                  :id="`line-category-${i}`"
                  :value="categoryOf(l)"
                  :disabled="busy"
                  class="h-11 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring"
                  :data-testid="`line-category-${i}`"
                  @change="pickDoneCategory(i, $event)"
                >
                  <option v-for="c in LINE_CATEGORIES" :key="c" :value="c">{{ tOr('category', c) }}</option>
                </select>
                <Button v-if="l.userCategory" type="button" variant="secondary" class="h-11" :disabled="busy" :data-testid="`line-category-reset-${i}`" @click="saveCategory(i, null)">
                  {{ t('uploadPage.categoryReset') }}
                </Button>
              </div>
            </li>
          </ul>
        </div>

        <div data-testid="upload-vat">
          <h3 class="mb-2 text-label text-text-secondary">{{ t('uploadPage.vatPerRate') }}</h3>
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-text-secondary">
                <th scope="col" class="font-normal">{{ t('uploadPage.vatRate') }}</th>
                <th scope="col" class="text-right font-normal">{{ t('uploadPage.vatBase') }}</th>
                <th scope="col" class="text-right font-normal">{{ t('uploadPage.vatAmount') }}</th>
              </tr>
            </thead>
            <tbody class="font-mono tabular-nums">
              <tr v-for="v in upload.draft.vatBreakdown ?? []" :key="v.rate" data-testid="upload-vat-row" :data-rate="v.rate">
                <th scope="row" class="text-left font-normal">{{ t('uploadPage.vatRowLabel', { rate: v.rate }) }}</th>
                <td class="text-right">{{ v.base === null ? '–' : formatEuro(v.base, locale) }}</td>
                <td class="text-right" data-testid="upload-vat-amount">{{ formatEuro(v.vat, locale) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <Button as-child variant="secondary" size="lg" class="w-full">
          <NuxtLink to="/receipts">{{ t('uploadPage.backToWallet') }}</NuxtLink>
        </Button>
      </section>
    </template>

    <section v-if="upload && upload.status !== 'pending_upload'" class="space-y-2" data-testid="upload-photo-section">
      <h2 class="text-label text-text-secondary">{{ t('uploadPage.photo') }}</h2>
      <img v-if="photoUrl" :src="photoUrl" :alt="t('uploadPage.photoAlt')" class="max-h-[32rem] w-full rounded-xl border border-border bg-card object-contain" data-testid="upload-photo" />
      <p v-else-if="photoFailed" class="text-sm text-text-secondary" data-testid="upload-photo-failed">{{ t('uploadPage.photoFailed') }}</p>
      <Skeleton v-else class="h-48 w-full" />
    </section>

    <section v-if="upload" class="space-y-2" data-testid="upload-delete-section">
      <Button v-if="!confirmingDelete" type="button" variant="secondary" size="lg" class="w-full" data-testid="delete-upload" :disabled="busy" @click="confirmingDelete = true">
        <Trash2 aria-hidden="true" />
        {{ t('uploadPage.delete') }}
      </Button>
      <div v-else class="space-y-3 rounded-xl border border-danger-border bg-card p-4" role="alertdialog" aria-labelledby="delete-h" data-testid="delete-confirm">
        <p id="delete-h">{{ t('uploadPage.deleteConfirm') }}</p>
        <div class="flex flex-col gap-2">
          <Button type="button" variant="destructive" size="lg" data-testid="confirm-delete" :disabled="busy" @click="deleteUpload">{{ t('uploadPage.deleteYes') }}</Button>
          <Button type="button" variant="secondary" size="lg" data-testid="cancel-delete" :disabled="busy" @click="confirmingDelete = false">{{ t('uploadPage.deleteNo') }}</Button>
        </div>
      </div>
    </section>
  </div>
</template>
