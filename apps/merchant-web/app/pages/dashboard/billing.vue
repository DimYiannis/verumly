<script setup lang="ts">
import { CheckIcon, ClockIcon, CreditCardIcon, FileDownIcon, LandmarkIcon, RefreshCwIcon } from '@lucide/vue';
import { CATALOGUE, INTERVALS, monthlyEquivalent, PLANS, priceFor, vatSplit, type Interval, type Plan } from '@lr/billing';
import type { MessageKey } from '~/i18n/en';

definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

type Status = 'trialing' | 'active' | 'past_due' | 'canceled';
interface Billing {
  status: Status;
  plan: Plan;
  interval: Interval;
  effectivePlan: Plan | null;
  limits: { locations: number | null; activeTerminals: number | null } | null;
  usage: { locations: number; activeTerminals: number };
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pendingPlan: Plan | null;
  pendingInterval: Interval | null;
  graceEndsAt: string | null;
  method: string | null;
  next: { at: string; plan: Plan; interval: Interval; net: number; vat: number; gross: number } | null;
  canSimulateRenewal: boolean;
}
interface Invoice { id: string; number: string; plan: Plan; interval: Interval; periodStart: string; periodEnd: string; gross: number; status: 'paid' | 'failed'; createdAt: string }

const { t } = useLocale();
const route = useRoute();
const router = useRouter();
const session = sessionState();
const canWrite = computed(() => session.value.user?.role === 'owner');
const billing = ref<Billing | null>(null);
const invoices = ref<Invoice[]>([]);
const error = ref('');
const busy = ref(false);
const choosing = ref(false);
const cancelOpen = ref(false);
const simulated = ref<'renewed' | 'renewal_failed' | 'ended' | 'skipped' | null>(null);
const interval = ref<Interval>('monthly');
// the result of a checkout (?payment=success|failed), kept on screen after the query is cleared
const payment = ref<'success' | 'failed' | null>(null);

const mk = (k: string) => k as MessageKey;
const planName = (p: Plan) => t(mk(`bill.plan.${p}`));

async function load() {
  const [b, inv] = await Promise.all([attempt(error, () => $fetch<Billing>('/api/dashboard/billing')), attempt(error, () => $fetch<Invoice[]>('/api/dashboard/billing/invoices'))]);
  if (b) {
    billing.value = b;
    if (b.status === 'active') interval.value = b.pendingInterval ?? b.interval;
  }
  if (inv) invoices.value = inv;
  await refreshBillingNotice();
}

onMounted(async () => {
  const p = route.query.payment;
  if (p === 'success' || p === 'failed') {
    payment.value = p;
    await router.replace({ query: {} });
  }
  await load();
});

async function act(fn: () => Promise<unknown>) {
  busy.value = true;
  simulated.value = null;
  payment.value = null;
  try {
    if ((await attempt(error, fn)) !== undefined) await load();
  } finally {
    busy.value = false;
  }
}

async function choose(plan: Plan) {
  busy.value = true;
  const r = await attempt(error, () => $fetch<{ id: string }>('/api/dashboard/billing/checkout', { method: 'POST', body: { plan, interval: interval.value } }));
  busy.value = false;
  if (r) await navigateTo(`/billing/checkout/${r.id}`);
}
/** past_due: pay the current plan now with another method (a new checkout and mandate). */
async function payAgain() {
  const b = billing.value;
  if (!b) return;
  interval.value = b.interval;
  await choose(b.plan);
}
const scheduleChange = (plan: Plan) => act(() => $fetch<unknown>('/api/dashboard/billing/change', { method: 'POST', body: { plan, interval: interval.value } }));
const undoChange = () => act(() => $fetch<unknown>('/api/dashboard/billing/change', { method: 'DELETE' }));
const resume = () => act(() => $fetch<unknown>('/api/dashboard/billing/resume', { method: 'POST' }));
const cancel = () => act(() => $fetch<unknown>('/api/dashboard/billing/cancel', { method: 'POST' }));
async function simulate() {
  busy.value = true;
  payment.value = null;
  const r = await attempt(error, () => $fetch<{ result: NonNullable<typeof simulated.value> }>('/api/dashboard/billing/simulate-renewal', { method: 'POST' }));
  if (r) await load();
  simulated.value = r?.result ?? null;
  busy.value = false;
}

const statusLabel = computed(() => {
  const b = billing.value;
  if (!b) return '';
  if (b.status === 'trialing') return b.trialDaysLeft === 1 ? t('bill.status.trialingOne') : t('bill.status.trialing', { n: b.trialDaysLeft ?? 0 });
  return t(mk(`bill.status.${b.status}`));
});
const statusVariant = computed(() => ({ trialing: 'accent', active: 'success', past_due: 'danger', canceled: 'neutral' } as const)[billing.value?.status ?? 'canceled']);

/** "€40,83 per month, billed yearly (€490,00 excl. BTW)"; empty while there is no paid plan. */
const priceText = computed(() => {
  const b = billing.value;
  if (!b || (b.status !== 'active' && b.status !== 'past_due')) return '';
  if (b.interval === 'annual') return t('bill.price.annual', { monthly: euro(monthlyEquivalent(b.plan)), amount: euro(CATALOGUE[b.plan].prices.annual) });
  return t('bill.price.monthly', { amount: euro(CATALOGUE[b.plan].prices.monthly) });
});
const showDemoTools = computed(() => !!billing.value?.canSimulateRenewal && canWrite.value && (billing.value.status === 'active' || billing.value.status === 'past_due'));

/** Over a limit: red advice. From 80% of a limit: amber advice. Nothing for unlimited plans. */
const usageAdvice = computed(() => {
  const b = billing.value;
  if (!b?.limits) return null;
  const pairs = [
    { used: b.usage.locations, max: b.limits.locations },
    { used: b.usage.activeTerminals, max: b.limits.activeTerminals },
  ];
  if (pairs.some((p) => p.max !== null && p.used > p.max)) return { text: t('bill.usage.advice.over'), tone: 'text-danger' };
  if (pairs.some((p) => p.max !== null && p.max > 0 && p.used / p.max >= 0.8)) return { text: t('bill.usage.advice.near'), tone: 'text-warning' };
  return null;
});

/** What the plan card button does for this plan at the selected interval. */
function action(plan: Plan): { kind: 'checkout' | 'schedule' | 'current' | 'scheduled' | 'none'; label: string } {
  const b = billing.value;
  if (!b || !canWrite.value) return { kind: 'none', label: '' };
  if (b.status !== 'active') return { kind: 'checkout', label: t('bill.choose', { plan: planName(plan) }) };
  if (b.cancelAtPeriodEnd) return { kind: 'none', label: '' };
  if (b.pendingPlan === plan && b.pendingInterval === interval.value) return { kind: 'scheduled', label: t('bill.scheduled') };
  const current = b.plan === plan && b.interval === interval.value;
  if (current && !b.pendingPlan) return { kind: 'current', label: t('bill.currentPlanButton') };
  return { kind: 'schedule', label: current ? t('bill.undoChange') : t('bill.switch') };
}
async function planButton(plan: Plan) {
  const b = billing.value;
  if (!b) return;
  const kind = action(plan).kind;
  if (kind === 'checkout') return choose(plan);
  if (kind !== 'schedule') return;
  // back to the current plan = undo the scheduled change
  await (b.plan === plan && b.interval === interval.value ? undoChange() : scheduleChange(plan));
  if (!error.value) choosing.value = false;
}
const features = (plan: Plan): MessageKey[] =>
  CATALOGUE[plan].limits.locations === null
    ? ['bill.feature.locationsUnlimited', 'bill.feature.terminalsUnlimited', 'bill.feature.archive', 'bill.feature.wallet']
    : ['bill.feature.locations1', 'bill.feature.terminals2', 'bill.feature.archive', 'bill.feature.wallet'];
</script>

<template>
  <div class="mx-auto w-full max-w-4xl pb-12">
    <AppPageHeading :title="t('nav.billing')" :description="t('bill.subtitle')" />

    <div class="mt-6 px-2">
      <div v-if="payment || simulated || (error && !choosing)" class="mb-4 space-y-2">
        <AppNotice v-if="payment === 'success'" tone="success" role="status" data-testid="billing-payment-success">{{ t('bill.paymentSuccess') }}</AppNotice>
        <AppNotice v-if="payment === 'failed'" tone="danger" role="alert" data-testid="billing-payment-failed">{{ t('bill.paymentFailed') }}</AppNotice>
        <AppNotice v-if="simulated" role="status" data-testid="billing-simulated">{{ t(mk(`bill.simulated.${simulated}`)) }}</AppNotice>
        <AppErrorNote v-if="error && !choosing" data-testid="error">{{ error }}</AppErrorNote>
      </div>

      <!-- plan -->
      <AppSettingsSection :title="t('bill.current')" :aria-busy="!billing && !error" data-testid="billing-current">
        <div v-if="billing" class="space-y-5">
          <div class="space-y-1.5">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p class="text-lg font-medium leading-7" data-testid="billing-plan">{{ billing.status === 'trialing' ? t('bill.trialPlan') : `${planName(billing.plan)} · ${t(mk(`bill.interval.${billing.interval}`))}` }}</p>
              <Badge :variant="statusVariant" aria-live="polite" data-testid="billing-status">{{ statusLabel }}</Badge>
            </div>
            <p v-if="priceText" class="text-sm text-text-secondary" data-testid="billing-price">{{ priceText }}</p>
          </div>

          <div class="space-y-2 text-sm">
            <dl class="space-y-2">
              <div v-if="billing.status === 'trialing' && billing.trialEndsAt" class="flex flex-col gap-0.5 sm:flex-row sm:gap-6">
                <dt class="text-muted-foreground sm:w-44 sm:shrink-0">{{ t('bill.trialEnds') }}</dt>
                <dd data-testid="billing-trial-ends">{{ amsterdamDay(billing.trialEndsAt) }}</dd>
              </div>
              <div v-if="billing.status === 'active' && !billing.cancelAtPeriodEnd && billing.next" class="flex flex-col gap-0.5 sm:flex-row sm:gap-6">
                <dt class="text-muted-foreground sm:w-44 sm:shrink-0">{{ t('bill.nextRenewal') }}</dt>
                <dd><span data-testid="billing-next">{{ amsterdamDay(billing.next.at) }}</span><span class="text-text-secondary"> · {{ t('bill.inclBtw', { amount: euro(billing.next.gross) }) }}</span></dd>
              </div>
              <template v-if="billing.status === 'past_due'">
                <div v-if="billing.next" class="flex flex-col gap-0.5 sm:flex-row sm:gap-6">
                  <dt class="text-muted-foreground sm:w-44 sm:shrink-0">{{ t('bill.nextAttempt') }}</dt>
                  <dd>{{ amsterdamDay(billing.next.at) }}<span class="text-text-secondary"> · {{ t('bill.inclBtw', { amount: euro(billing.next.gross) }) }}</span></dd>
                </div>
                <div v-if="billing.graceEndsAt" class="flex flex-col gap-0.5 sm:flex-row sm:gap-6">
                  <dt class="text-muted-foreground sm:w-44 sm:shrink-0">{{ t('bill.graceEnds') }}</dt>
                  <dd>{{ amsterdamDay(billing.graceEndsAt) }}</dd>
                </div>
              </template>
            </dl>
            <div v-if="billing.status === 'active' && billing.pendingPlan && billing.pendingInterval && billing.currentPeriodEnd" class="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="billing-pending">
              <ClockIcon class="size-4 shrink-0 text-warning" aria-hidden="true" />
              <span>{{ t('bill.pendingChange', { plan: planName(billing.pendingPlan), interval: t(mk(`bill.intervalLower.${billing.pendingInterval}`)), date: amsterdamDay(billing.currentPeriodEnd) }) }}</span>
              <Button v-if="canWrite" variant="link" size="sm" class="h-auto p-0" :disabled="busy" data-testid="billing-undo" @click="undoChange">{{ t('bill.undoChange') }}</Button>
            </div>
          </div>

          <p v-if="billing.status === 'trialing'" class="text-sm text-text-secondary">{{ t('bill.trialHelp') }}</p>
          <p v-if="billing.status === 'canceled'" class="text-sm text-text-secondary">{{ t('bill.inactiveHelp') }}</p>
          <p v-if="billing.status === 'past_due'" class="text-sm text-danger">{{ t('bill.pastDueHelp') }}</p>
          <p v-if="billing.status === 'active' && billing.cancelAtPeriodEnd && billing.currentPeriodEnd" class="text-sm text-warning" data-testid="billing-canceled-at-end">{{ t('bill.canceledAtEnd', { date: amsterdamDay(billing.currentPeriodEnd) }) }}</p>
          <p v-if="!canWrite" class="text-xs text-muted-foreground">{{ t('bill.readOnly') }}</p>

          <div v-if="canWrite" class="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button v-if="billing.status !== 'active' || !billing.cancelAtPeriodEnd" :variant="billing.status === 'trialing' || billing.status === 'canceled' ? 'default' : 'outline'" :disabled="busy" data-testid="billing-change-plan" @click="choosing = true">{{ billing.status === 'trialing' || billing.status === 'canceled' ? t('bill.choosePlan') : t('bill.changePlan') }}</Button>
            <Button v-if="billing.status === 'active' && !billing.cancelAtPeriodEnd" variant="ghost" class="px-0 text-text-secondary hover:bg-transparent hover:text-danger hover:underline" :disabled="busy" data-testid="billing-cancel" @click="cancelOpen = true">{{ t('bill.cancel') }}</Button>
            <Button v-if="billing.status === 'active' && billing.cancelAtPeriodEnd" :disabled="busy" data-testid="billing-resume" @click="resume">{{ t('bill.resume') }}</Button>
          </div>
        </div>
        <div v-else-if="!error" class="space-y-3" aria-hidden="true">
          <Skeleton class="h-7 w-52" />
          <Skeleton class="h-4 w-80 max-w-full" />
          <Skeleton class="h-4 w-64 max-w-full" />
          <Skeleton class="h-9 w-48" />
        </div>
      </AppSettingsSection>

      <!-- usage -->
      <AppSettingsSection :title="t('bill.usage')" :aria-busy="!billing && !error" data-testid="billing-usage">
        <div v-if="billing" class="max-w-md space-y-5">
          <AppUsageMeter :label="t('bill.usage.locations')" :used="billing.usage.locations" :limit="billing.limits?.locations" data-testid="billing-usage-locations" />
          <AppUsageMeter :label="t('bill.usage.terminals')" :used="billing.usage.activeTerminals" :limit="billing.limits?.activeTerminals" data-testid="billing-usage-terminals" />
          <p v-if="usageAdvice" :class="['text-sm', usageAdvice.tone]" data-testid="billing-usage-advice">{{ usageAdvice.text }}</p>
        </div>
        <div v-else-if="!error" class="max-w-md space-y-5" aria-hidden="true">
          <Skeleton class="h-7 w-full" />
          <Skeleton class="h-7 w-full" />
        </div>
      </AppSettingsSection>

      <!-- payment method: no update-card API exists, so the row is read-only except for the past-due "pay now" flow -->
      <AppSettingsSection :title="t('bill.method')" :aria-busy="!billing && !error" data-testid="billing-method-section">
        <div v-if="billing" class="space-y-2">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <span class="flex h-7 w-10 items-center justify-center rounded-md border bg-card text-muted-foreground" aria-hidden="true">
                <LandmarkIcon v-if="billing.method?.startsWith('iDEAL')" class="size-4" />
                <CreditCardIcon v-else class="size-4" />
              </span>
              <span :class="['text-sm', billing.method ? 'font-medium' : 'text-muted-foreground']" data-testid="billing-method">{{ billing.method ?? t('bill.noMethod') }}</span>
            </div>
            <Button v-if="canWrite && billing.status === 'past_due'" :disabled="busy" data-testid="billing-pay-again" @click="payAgain">{{ t('bill.updateMethod') }}</Button>
          </div>
          <p v-if="billing.method" class="text-xs text-muted-foreground">{{ t('bill.methodHelp') }}</p>
        </div>
        <Skeleton v-else-if="!error" class="h-7 w-56" aria-hidden="true" />
      </AppSettingsSection>

      <!-- invoices -->
      <AppSettingsSection :title="t('bill.invoices')" :aria-busy="!billing && !error" data-testid="billing-invoices">
        <template v-if="billing">
          <p v-if="!invoices.length" class="text-sm leading-7 text-muted-foreground" data-testid="invoice-empty">{{ t('bill.invoicesEmpty') }}</p>
          <Table v-else class="max-md:block">
            <TableHeader class="max-md:sr-only [&_th]:h-7 [&_th]:px-0 [&_th]:pr-4 [&_th:last-child]:pr-0 [&_th]:text-xs [&_th]:font-normal [&_th]:text-muted-foreground">
              <TableRow class="hover:bg-transparent">
                <TableHead>{{ t('bill.col.date') }}</TableHead><TableHead>{{ t('bill.col.number') }}</TableHead><TableHead>{{ t('bill.col.plan') }}</TableHead><TableHead class="text-right">{{ t('bill.col.amount') }}</TableHead><TableHead>{{ t('common.status') }}</TableHead><TableHead class="text-right"><span class="sr-only">{{ t('bill.col.download') }}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody class="max-md:block">
              <TableRow
                v-for="i in invoices"
                :key="i.id"
                class="hover:bg-transparent max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:items-center max-md:gap-x-4 max-md:gap-y-1 max-md:py-4 [&_td]:px-0 [&_td]:py-3 [&_td]:pr-4 [&_td:last-child]:pr-0 max-md:[&_td]:whitespace-normal max-md:[&_td]:py-0 max-md:[&_td]:pr-0"
                data-testid="invoice-row"
              >
                <TableCell class="max-md:order-1">{{ amsterdamDay(i.createdAt) }}</TableCell>
                <TableCell class="font-mono text-xs text-text-secondary max-md:order-5" data-testid="invoice-number">{{ i.number }}</TableCell>
                <TableCell class="max-md:order-3">
                  <span>{{ planName(i.plan) }} · {{ t(mk(`bill.intervalLower.${i.interval}`)) }}</span>
                  <span class="block text-xs text-muted-foreground">{{ amsterdamDay(i.periodStart) }} – {{ amsterdamDay(i.periodEnd) }}</span>
                </TableCell>
                <TableCell class="text-right font-mono max-md:order-2">{{ euro(i.gross) }}</TableCell>
                <TableCell class="max-md:order-4 max-md:text-right"><Badge :variant="i.status === 'paid' ? 'success' : 'danger'" data-testid="invoice-status">{{ t(mk(`bill.invoiceStatus.${i.status}`)) }}</Badge></TableCell>
                <TableCell class="text-right max-md:order-6">
                  <Button variant="ghost" size="sm" class="-mr-3.5" as-child><a :href="`/api/dashboard/billing/invoices/${i.id}/pdf`" download :aria-label="t('bill.downloadInvoice', { number: i.number })" data-testid="invoice-pdf"><FileDownIcon />{{ t('bill.pdf') }}</a></Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </template>
        <div v-else-if="!error" class="space-y-3" aria-hidden="true">
          <Skeleton class="h-7 w-full" />
          <Skeleton class="h-10 w-full" />
          <Skeleton class="h-10 w-full" />
        </div>
      </AppSettingsSection>

      <div v-if="showDemoTools" class="flex flex-wrap items-center justify-between gap-3 border-t border-dashed pt-6" data-testid="billing-demo-tools">
        <div>
          <p class="text-xs font-medium text-text-secondary">{{ t('bill.demoTools') }}</p>
          <p class="text-xs text-muted-foreground">{{ t('bill.simulateHint') }}</p>
        </div>
        <Button variant="outline" size="sm" :disabled="busy" data-testid="billing-simulate" @click="simulate"><RefreshCwIcon />{{ t('bill.simulate') }}</Button>
      </div>
    </div>

    <!-- plan chooser -->
    <Dialog v-model:open="choosing">
      <DialogContent class="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto p-4 sm:max-w-3xl sm:p-6" data-testid="plan-dialog">
        <DialogHeader>
          <DialogTitle class="text-lg font-medium">{{ t('bill.choosePlan') }}</DialogTitle>
          <DialogDescription>{{ t(billing?.status === 'active' ? 'bill.chooseHelpActive' : 'bill.chooseHelp') }}</DialogDescription>
        </DialogHeader>

        <AppErrorNote v-if="error" data-testid="error">{{ error }}</AppErrorNote>

        <div class="flex flex-wrap items-center gap-3">
          <div role="group" :aria-label="t('bill.intervalGroup')" class="inline-flex items-center gap-1 rounded-lg border bg-muted p-1">
            <button
              v-for="iv in INTERVALS"
              :key="iv"
              type="button"
              :aria-pressed="interval === iv"
              :class="['h-8 rounded-md px-3 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring', interval === iv ? 'bg-primary text-primary-foreground' : 'text-text-secondary hover:text-foreground']"
              :data-testid="`billing-interval-${iv}`"
              @click="interval = iv"
            >
              {{ t(mk(`bill.interval.${iv}`)) }}
            </button>
          </div>
          <Badge variant="success" data-testid="billing-two-months-free">{{ t('bill.twoMonthsFree') }}</Badge>
        </div>

        <div v-if="billing" class="grid gap-4 md:grid-cols-2">
          <article v-for="p in PLANS" :key="p" :class="['flex flex-col rounded-lg border p-5', billing.effectivePlan === p && billing.status !== 'trialing' ? 'border-primary' : '']" :data-testid="`plan-card-${p}`">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-base font-medium">{{ planName(p) }}</h3>
              <Badge v-if="billing.effectivePlan === p && billing.status !== 'trialing'" variant="accent" :data-testid="`plan-current-${p}`">{{ t('bill.currentPlanButton') }}</Badge>
            </div>
            <p class="mt-1 text-sm text-muted-foreground">{{ t(mk(`bill.planDesc.${p}`)) }}</p>
            <div v-if="interval === 'monthly'" class="mt-5">
              <p><span class="font-mono text-2xl font-medium">{{ euro(CATALOGUE[p].prices.monthly) }}</span> <span class="text-sm text-muted-foreground">{{ t('bill.perMonth') }} {{ t('bill.exclBtw') }}</span></p>
              <p class="mt-0.5 text-xs text-text-secondary">{{ t('bill.inclBtw', { amount: euro(priceFor(p, 'monthly').gross) }) }}</p>
            </div>
            <div v-else class="mt-5">
              <p><span class="font-mono text-2xl font-medium">{{ euro(monthlyEquivalent(p)) }}</span> <span class="text-sm text-muted-foreground">{{ t('bill.perMonth') }} {{ t('bill.exclBtw') }}</span></p>
              <p class="mt-0.5 text-xs text-text-secondary">{{ t('bill.inclBtw', { amount: euro(vatSplit(monthlyEquivalent(p)).gross) }) }} · {{ t('bill.billedYearly', { amount: euro(CATALOGUE[p].prices.annual), gross: euro(priceFor(p, 'annual').gross) }) }}</p>
            </div>
            <ul class="mt-5 flex-1 space-y-2 text-sm">
              <li v-for="f in features(p)" :key="f" class="flex items-center gap-2"><CheckIcon class="size-4 shrink-0 text-success" aria-hidden="true" />{{ t(f) }}</li>
            </ul>
            <Button
              v-if="action(p).kind !== 'none'"
              class="mt-6 w-full"
              :variant="action(p).kind === 'checkout' || action(p).kind === 'schedule' ? 'default' : 'outline'"
              :disabled="busy || action(p).kind === 'current' || action(p).kind === 'scheduled'"
              :data-testid="`plan-choose-${p}`"
              @click="planButton(p)"
            >
              {{ action(p).label }}
            </Button>
          </article>
        </div>
      </DialogContent>
    </Dialog>

    <!-- cancel confirmation -->
    <AlertDialog v-model:open="cancelOpen">
      <AlertDialogContent data-testid="billing-cancel-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('bill.cancelTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('bill.cancelBody', { date: billing?.currentPeriodEnd ? amsterdamDay(billing.currentPeriodEnd) : '' }) }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="billing-cancel-keep">{{ t('bill.cancelKeep') }}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" data-testid="billing-cancel-confirm" @click="cancel">{{ t('bill.cancelConfirm') }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
