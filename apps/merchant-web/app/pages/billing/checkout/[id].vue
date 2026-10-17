<script setup lang="ts">
import { ArchiveIcon, CreditCardIcon, LandmarkIcon, LoaderCircleIcon, LockIcon, TriangleAlertIcon } from '@lucide/vue';
import { IDEAL_BANKS, IDEAL_DECLINE_BANK, methodProblems, type Interval, type MethodInput, type MethodProblem, type Plan } from '@lr/billing';
import type { MessageKey } from '~/i18n/en';

// A PSP-like payment page outside the dashboard shell (still behind the dashboard session). Demo provider only.
definePageMeta({ middleware: 'dashboard-auth' });

interface Checkout {
  id: string;
  status: 'pending' | 'paid' | 'failed' | 'expired';
  merchantName: string;
  plan: Plan;
  interval: Interval;
  net: number;
  vat: number;
  gross: number;
  vatRate: number;
  periodStart: string;
  periodEnd: string;
}

const { t } = useLocale();
const route = useRoute();
const id = computed(() => String(route.params.id ?? ''));
const checkout = ref<Checkout | null>(null);
const problem = ref<'notFound' | 'expired' | 'paid' | 'failed' | null>(null);
const error = ref('');
const method = ref<'ideal' | 'card'>('ideal');
const bank = ref('');
const card = reactive({ number: '', expiry: '', cvc: '' });
const touched = ref(false);
const processing = ref(false);
const mk = (k: string) => k as MessageKey;

onMounted(async () => {
  try {
    checkout.value = await $fetch<Checkout>(`/api/dashboard/billing/checkout/${encodeURIComponent(id.value)}`);
    if (checkout.value.status !== 'pending') problem.value = checkout.value.status;
  } catch (e) {
    // 404 also covers another organisation's checkout (RLS hides it)
    if (typeof e === 'object' && e !== null && 'statusCode' in e && e.statusCode === 404) problem.value = 'notFound';
    else error.value = errorMessage(e);
  }
});

const input = computed<MethodInput>(() => (method.value === 'ideal' ? { method: 'ideal', bank: bank.value } : { method: 'card', ...card }));
const problems = computed<MethodProblem[]>(() => methodProblems(input.value, new Date()));
const shown = (p: MethodProblem) => touched.value && problems.value.includes(p);

/** `4242424242424242` → `4242 4242 4242 4242` while typing; `1230` → `12/30`. */
function formatNumber() {
  card.number = card.number.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
}
function formatExpiry() {
  const d = card.expiry.replace(/\D/g, '').slice(0, 4);
  card.expiry = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

async function pay() {
  touched.value = true;
  if (problems.value.length || !checkout.value) return;
  processing.value = true;
  error.value = '';
  try {
    // a short pause so the processing state is visible, as on a real payment page
    await new Promise((r) => setTimeout(r, 900));
    const r = await $fetch<{ status: 'paid' | 'failed' }>(`/api/dashboard/billing/checkout/${checkout.value.id}/pay`, { method: 'POST', body: input.value });
    await navigateTo(`/dashboard/billing?payment=${r.status === 'paid' ? 'success' : 'failed'}`);
  } catch (e) {
    processing.value = false;
    const msg = errorMessage(e);
    if (msg === 'checkout expired') problem.value = 'expired';
    else if (msg === 'checkout already completed') problem.value = 'paid';
    else error.value = msg;
  }
}
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-xl flex-col gap-4 px-4 py-8">
    <div role="status" class="flex items-center justify-center gap-2 rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-sm font-medium text-warning" data-testid="checkout-demo-banner">
      <TriangleAlertIcon class="size-4" />{{ t('checkout.demoBanner') }}
    </div>

    <div class="flex items-center gap-3 px-1">
      <div class="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><ArchiveIcon class="size-4" /></div>
      <div class="min-w-0">
        <p class="text-base font-semibold tracking-tight">Less Receipts</p>
        <p class="text-xs text-muted-foreground">{{ t('checkout.title') }}</p>
      </div>
      <div class="ml-auto"><AppLocaleSwitch /></div>
    </div>

    <AppErrorNote v-if="error" data-testid="error">{{ error }}</AppErrorNote>

    <Card v-if="problem" data-testid="checkout-problem">
      <CardContent class="space-y-4">
        <p class="text-sm" :data-testid="`checkout-problem-${problem}`">{{ t(mk(`checkout.error.${problem}`)) }}</p>
        <Button variant="outline" as-child><NuxtLink to="/dashboard/billing" data-testid="checkout-back">{{ t('checkout.back') }}</NuxtLink></Button>
      </CardContent>
    </Card>

    <template v-else-if="checkout">
      <Card data-testid="checkout-summary">
        <CardHeader>
          <CardDescription>{{ t('checkout.payingAs') }}</CardDescription>
          <CardTitle class="text-base" data-testid="checkout-merchant">{{ checkout.merchantName }}</CardTitle>
        </CardHeader>
        <CardContent class="mt-4">
          <dl class="space-y-2 text-sm">
            <div class="flex justify-between gap-4"><dt class="text-muted-foreground">{{ t('checkout.plan') }}</dt><dd class="font-medium" data-testid="checkout-plan">{{ t(mk(`bill.plan.${checkout.plan}`)) }}</dd></div>
            <div class="flex justify-between gap-4"><dt class="text-muted-foreground">{{ t('checkout.interval') }}</dt><dd data-testid="checkout-interval">{{ t(mk(`bill.interval.${checkout.interval}`)) }}</dd></div>
            <div class="flex justify-between gap-4"><dt class="text-muted-foreground">{{ t('checkout.period') }}</dt><dd>{{ amsterdamDay(checkout.periodStart) }} – {{ amsterdamDay(checkout.periodEnd) }}</dd></div>
            <Separator class="my-3" />
            <div class="flex justify-between gap-4"><dt class="text-muted-foreground">{{ t('checkout.net') }}</dt><dd class="font-mono" data-testid="checkout-net">{{ euro(checkout.net) }}</dd></div>
            <div class="flex justify-between gap-4"><dt class="text-muted-foreground">{{ t('checkout.vat', { rate: checkout.vatRate }) }}</dt><dd class="font-mono" data-testid="checkout-vat">{{ euro(checkout.vat) }}</dd></div>
            <div class="flex justify-between gap-4 text-base"><dt class="font-medium">{{ t('checkout.total') }}</dt><dd class="font-mono font-medium" data-testid="checkout-total">{{ euro(checkout.gross) }}</dd></div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <form novalidate @submit.prevent="pay">
          <CardHeader><CardTitle class="text-base">{{ t('checkout.method') }}</CardTitle></CardHeader>
          <CardContent class="mt-4 space-y-4">
            <div role="tablist" class="grid grid-cols-2 overflow-hidden rounded-md border">
              <button
                v-for="(m, idx) in (['ideal', 'card'] as const)"
                :key="m"
                type="button"
                role="tab"
                :aria-selected="method === m"
                :class="['flex h-9 items-center justify-center gap-2 text-sm transition-colors', idx ? 'border-l border-border' : '', method === m ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted']"
                :data-testid="`checkout-method-${m}`"
                @click="method = m; touched = false"
              >
                <component :is="m === 'ideal' ? LandmarkIcon : CreditCardIcon" class="size-4" />{{ t(m === 'ideal' ? 'checkout.ideal' : 'checkout.card') }}
              </button>
            </div>

            <div v-if="method === 'ideal'" class="space-y-2">
              <Label for="checkout-bank">{{ t('checkout.bank') }}</Label>
              <AppNativeSelect id="checkout-bank" v-model="bank" data-testid="checkout-bank">
                <option value="" disabled>{{ t('checkout.bankPlaceholder') }}</option>
                <option v-for="b in IDEAL_BANKS" :key="b" :value="b">{{ b }}</option>
                <option :value="IDEAL_DECLINE_BANK">{{ IDEAL_DECLINE_BANK }}</option>
              </AppNativeSelect>
              <p v-if="shown('ideal_bank')" class="text-xs text-danger">{{ t('checkout.problem.ideal_bank') }}</p>
            </div>

            <div v-else class="space-y-4">
              <div class="space-y-2">
                <Label for="checkout-card-number">{{ t('checkout.cardNumber') }}</Label>
                <Input id="checkout-card-number" v-model="card.number" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" class="font-mono" data-testid="checkout-card-number" @input="formatNumber" />
                <p v-if="shown('card_number')" class="text-xs text-danger">{{ t('checkout.problem.card_number') }}</p>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div class="space-y-2">
                  <Label for="checkout-card-expiry">{{ t('checkout.expiry') }}</Label>
                  <Input id="checkout-card-expiry" v-model="card.expiry" inputmode="numeric" autocomplete="cc-exp" placeholder="12/30" class="font-mono" data-testid="checkout-card-expiry" @input="formatExpiry" />
                  <p v-if="shown('card_expiry')" class="text-xs text-danger">{{ t('checkout.problem.card_expiry') }}</p>
                </div>
                <div class="space-y-2">
                  <Label for="checkout-card-cvc">{{ t('checkout.cvc') }}</Label>
                  <Input id="checkout-card-cvc" v-model="card.cvc" inputmode="numeric" autocomplete="cc-csc" maxlength="3" placeholder="123" class="font-mono" data-testid="checkout-card-cvc" />
                  <p v-if="shown('card_cvc')" class="text-xs text-danger">{{ t('checkout.problem.card_cvc') }}</p>
                </div>
              </div>
            </div>

            <div class="rounded-md bg-muted px-3 py-2 text-xs text-text-secondary" data-testid="checkout-hint">
              <p class="font-medium text-foreground">{{ t('checkout.hintTitle') }}</p>
              <p>{{ t('checkout.hintSuccess') }}</p>
              <p>{{ t('checkout.hintRenewalsFail') }}</p>
              <p>{{ t('checkout.hintDeclined') }}</p>
              <p>{{ t('checkout.hintIdeal') }}</p>
            </div>
          </CardContent>
          <CardFooter class="mt-6 flex-col gap-3">
            <Button class="w-full" :disabled="processing" data-testid="checkout-pay">
              <template v-if="processing"><LoaderCircleIcon class="animate-spin" /><span data-testid="checkout-processing">{{ t('checkout.processing') }}</span></template>
              <template v-else><LockIcon />{{ t('checkout.pay', { amount: euro(checkout.gross) }) }}</template>
            </Button>
            <NuxtLink to="/dashboard/billing" class="text-sm text-muted-foreground underline-offset-4 hover:underline" data-testid="checkout-cancel">{{ t('checkout.cancel') }}</NuxtLink>
            <p class="text-center text-xs text-muted-foreground">{{ t('checkout.noCardStored') }}</p>
          </CardFooter>
        </form>
      </Card>
    </template>
  </div>
</template>
