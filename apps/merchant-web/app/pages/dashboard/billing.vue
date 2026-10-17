<script setup lang="ts">
import { CheckIcon, CircleCheckIcon, CircleAlertIcon, CreditCardIcon, FileDownIcon, RefreshCwIcon } from '@lucide/vue';
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
const confirmingCancel = ref(false);
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
async function cancel() {
  if (!confirmingCancel.value) {
    confirmingCancel.value = true;
    return;
  }
  confirmingCancel.value = false;
  await act(() => $fetch<unknown>('/api/dashboard/billing/cancel', { method: 'POST' }));
}
async function simulate() {
  busy.value = true;
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
function usageText(n: number, max: number | null | undefined, kind: 'Locations' | 'Terminals'): string {
  if (max !== null && max !== undefined) return t(mk(`bill.usage${kind}`), { n, max });
  return n === 1 ? t(mk(`bill.usage${kind}One`)) : t(mk(`bill.usage${kind}Unlimited`), { n });
}

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
function planButton(plan: Plan) {
  const a = action(plan);
  if (a.kind === 'checkout') return choose(plan);
  if (a.kind === 'schedule') {
    const b = billing.value!;
    // back to the current plan = undo the scheduled change
    return b.plan === plan && b.interval === interval.value ? undoChange() : scheduleChange(plan);
  }
}
function focusPlans() {
  document.getElementById('billing-plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const features = (plan: Plan): MessageKey[] =>
  CATALOGUE[plan].limits.locations === null
    ? ['bill.feature.locationsUnlimited', 'bill.feature.terminalsUnlimited', 'bill.feature.archive', 'bill.feature.wallet']
    : ['bill.feature.locations1', 'bill.feature.terminals2', 'bill.feature.archive', 'bill.feature.wallet'];
</script>

<template>
  <AppPageHeading :title="t('nav.billing')" :description="t('bill.subtitle')">
    <Button v-if="billing?.canSimulateRenewal && canWrite && (billing.status === 'active' || billing.status === 'past_due')" variant="outline" :disabled="busy" :title="t('bill.simulateHint')" data-testid="billing-simulate" @click="simulate">
      <RefreshCwIcon />{{ t('bill.simulate') }}
    </Button>
  </AppPageHeading>

  <div v-if="payment === 'success'" role="status" class="flex items-center gap-2 rounded-md border border-success-border bg-success-soft px-3 py-2 text-sm text-success" data-testid="billing-payment-success">
    <CircleCheckIcon class="size-4" />{{ t('bill.paymentSuccess') }}
  </div>
  <div v-if="payment === 'failed'" role="alert" class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger" data-testid="billing-payment-failed">
    <CircleAlertIcon class="size-4" />{{ t('bill.paymentFailed') }}
  </div>
  <div v-if="simulated" role="status" class="rounded-md border bg-card px-3 py-2 text-sm" data-testid="billing-simulated">{{ t(mk(`bill.simulated.${simulated}`)) }}</div>
  <AppErrorNote v-if="error" data-testid="error">{{ error }}</AppErrorNote>

  <Card v-if="billing" data-testid="billing-current">
    <CardHeader>
      <CardDescription>{{ t('bill.current') }}</CardDescription>
      <div class="flex flex-wrap items-center gap-3">
        <CardTitle class="text-xl" data-testid="billing-plan">{{ billing.status === 'trialing' ? t('bill.trialPlan') : `${planName(billing.plan)} · ${t(mk(`bill.interval.${billing.interval}`))}` }}</CardTitle>
        <Badge :variant="statusVariant" data-testid="billing-status">{{ statusLabel }}</Badge>
      </div>
    </CardHeader>
    <CardContent class="mt-4 space-y-4">
      <dl class="grid gap-4 text-sm sm:grid-cols-3">
        <div v-if="billing.status === 'trialing' && billing.trialEndsAt">
          <dt class="text-muted-foreground">{{ t('bill.trialEnds') }}</dt>
          <dd class="font-medium" data-testid="billing-trial-ends">{{ amsterdamDay(billing.trialEndsAt) }}</dd>
        </div>
        <div v-if="billing.status === 'active' && billing.next">
          <dt class="text-muted-foreground">{{ t('bill.nextRenewal') }}</dt>
          <dd class="font-medium" data-testid="billing-next">{{ amsterdamDay(billing.next.at) }}</dd>
          <dd class="font-mono text-xs text-text-secondary">{{ t('bill.amountIncl', { gross: euro(billing.next.gross), net: euro(billing.next.net) }) }}</dd>
        </div>
        <div v-if="billing.status === 'active' && billing.cancelAtPeriodEnd && billing.currentPeriodEnd">
          <dt class="text-muted-foreground">{{ t('bill.endsOn') }}</dt>
          <dd class="font-medium" data-testid="billing-ends">{{ amsterdamDay(billing.currentPeriodEnd) }}</dd>
        </div>
        <template v-if="billing.status === 'past_due'">
          <div v-if="billing.next">
            <dt class="text-muted-foreground">{{ t('bill.nextAttempt') }}</dt>
            <dd class="font-medium">{{ amsterdamDay(billing.next.at) }}</dd>
            <dd class="font-mono text-xs text-text-secondary">{{ t('bill.amountIncl', { gross: euro(billing.next.gross), net: euro(billing.next.net) }) }}</dd>
          </div>
          <div v-if="billing.graceEndsAt">
            <dt class="text-muted-foreground">{{ t('bill.graceEnds') }}</dt>
            <dd class="font-medium">{{ amsterdamDay(billing.graceEndsAt) }}</dd>
          </div>
        </template>
        <div>
          <dt class="text-muted-foreground">{{ t('bill.method') }}</dt>
          <dd class="flex items-center gap-1.5 font-medium" data-testid="billing-method"><CreditCardIcon v-if="billing.method" class="size-4 text-muted-foreground" />{{ billing.method ?? t('bill.noMethod') }}</dd>
        </div>
        <div>
          <dt class="text-muted-foreground">{{ t('bill.usage') }}</dt>
          <dd data-testid="billing-usage">{{ usageText(billing.usage.locations, billing.limits?.locations, 'Locations') }}</dd>
          <dd>{{ usageText(billing.usage.activeTerminals, billing.limits?.activeTerminals, 'Terminals') }}</dd>
        </div>
      </dl>

      <p v-if="billing.status === 'trialing'" class="text-sm text-text-secondary">{{ t('bill.trialHelp') }}</p>
      <p v-if="billing.status === 'canceled'" class="text-sm text-text-secondary">{{ t('bill.inactiveHelp') }}</p>
      <p v-if="billing.status === 'past_due'" class="text-sm text-danger">{{ t('bill.pastDueHelp') }}</p>
      <p v-if="billing.status === 'active' && billing.cancelAtPeriodEnd && billing.currentPeriodEnd" class="text-sm text-warning" data-testid="billing-canceled-at-end">{{ t('bill.canceledAtEnd', { date: amsterdamDay(billing.currentPeriodEnd) }) }}</p>
      <div v-if="billing.status === 'active' && billing.pendingPlan && billing.pendingInterval && billing.currentPeriodEnd" class="flex flex-wrap items-center gap-3 rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-sm text-warning" data-testid="billing-pending">
        <span class="flex-1">{{ t('bill.pendingChange', { plan: planName(billing.pendingPlan), interval: t(mk(`bill.intervalLower.${billing.pendingInterval}`)), date: amsterdamDay(billing.currentPeriodEnd) }) }}</span>
        <Button v-if="canWrite" variant="outline" size="sm" :disabled="busy" data-testid="billing-undo" @click="undoChange">{{ t('bill.undoChange') }}</Button>
      </div>
      <p v-if="!canWrite" class="text-xs text-muted-foreground">{{ t('bill.readOnly') }}</p>
    </CardContent>
    <CardFooter v-if="canWrite && (billing.status === 'active' || billing.status === 'past_due')" class="mt-6 justify-end gap-2">
      <Button v-if="billing.status === 'past_due'" :disabled="busy" data-testid="billing-pay-again" @click="payAgain">{{ t('bill.updateMethod') }}</Button>
      <Button v-if="billing.status === 'active' && !billing.cancelAtPeriodEnd" variant="outline" data-testid="billing-change" @click="focusPlans">{{ t('bill.changePlan') }}</Button>
      <Button v-if="billing.status === 'active' && !billing.cancelAtPeriodEnd" :variant="confirmingCancel ? 'destructive' : 'outline'" :disabled="busy" :data-testid="confirmingCancel ? 'billing-cancel-confirm' : 'billing-cancel'" @click="cancel">
        {{ confirmingCancel ? t('bill.cancelConfirm') : t('bill.cancel') }}
      </Button>
      <Button v-if="billing.status === 'active' && billing.cancelAtPeriodEnd" :disabled="busy" data-testid="billing-resume" @click="resume">{{ t('bill.resume') }}</Button>
    </CardFooter>
  </Card>

  <section v-if="billing" id="billing-plans" class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-3 px-2">
      <h2 class="text-lg font-medium">{{ t('bill.choosePlan') }}</h2>
      <div class="inline-flex items-center gap-2">
        <div role="group" class="inline-flex overflow-hidden rounded-md border">
          <button
            v-for="(iv, idx) in INTERVALS"
            :key="iv"
            type="button"
            :aria-pressed="interval === iv"
            :class="['h-9 px-3 text-sm transition-colors', idx ? 'border-l border-border' : '', interval === iv ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted']"
            :data-testid="`billing-interval-${iv}`"
            @click="interval = iv"
          >
            {{ t(mk(`bill.interval.${iv}`)) }}
          </button>
        </div>
        <Badge variant="success" data-testid="billing-two-months-free">{{ t('bill.twoMonthsFree') }}</Badge>
      </div>
    </div>
    <div class="grid gap-4 md:grid-cols-2">
      <Card v-for="p in PLANS" :key="p" :class="billing.effectivePlan === p && billing.status !== 'trialing' ? 'border-primary' : ''" :data-testid="`plan-card-${p}`">
        <CardHeader>
          <CardTitle class="text-base">{{ planName(p) }}</CardTitle>
          <CardDescription>{{ t(mk(`bill.planDesc.${p}`)) }}</CardDescription>
        </CardHeader>
        <CardContent class="mt-4 space-y-4">
          <div v-if="interval === 'monthly'">
            <p><span class="font-mono text-2xl font-medium">{{ euro(CATALOGUE[p].prices.monthly) }}</span> <span class="text-sm text-muted-foreground">{{ t('bill.perMonth') }} {{ t('bill.exclBtw') }}</span></p>
            <p class="text-xs text-text-secondary">{{ t('bill.inclBtw', { amount: euro(priceFor(p, 'monthly').gross) }) }}</p>
          </div>
          <div v-else>
            <p><span class="font-mono text-2xl font-medium">{{ euro(monthlyEquivalent(p)) }}</span> <span class="text-sm text-muted-foreground">{{ t('bill.perMonth') }} {{ t('bill.exclBtw') }}</span></p>
            <p class="text-xs text-text-secondary">{{ t('bill.inclBtw', { amount: euro(vatSplit(monthlyEquivalent(p)).gross) }) }} · {{ t('bill.billedYearly', { amount: euro(CATALOGUE[p].prices.annual), gross: euro(priceFor(p, 'annual').gross) }) }}</p>
          </div>
          <ul class="space-y-1.5 text-sm">
            <li v-for="f in features(p)" :key="f" class="flex items-center gap-2"><CheckIcon class="size-4 text-success" />{{ t(f) }}</li>
          </ul>
        </CardContent>
        <CardFooter v-if="action(p).kind !== 'none'" class="mt-6">
          <Button
            class="w-full"
            :variant="action(p).kind === 'checkout' || action(p).kind === 'schedule' ? 'default' : 'outline'"
            :disabled="busy || action(p).kind === 'current' || action(p).kind === 'scheduled'"
            :data-testid="`plan-choose-${p}`"
            @click="planButton(p)"
          >
            {{ action(p).label }}
          </Button>
        </CardFooter>
      </Card>
    </div>
  </section>

  <Card v-if="billing">
    <CardHeader><CardTitle class="text-base">{{ t('bill.invoices') }}</CardTitle></CardHeader>
    <CardContent class="mt-4">
      <div class="overflow-hidden rounded-md border">
        <Table>
          <TableHeader class="bg-muted [&_th]:text-xs [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-text-secondary">
            <TableRow class="hover:bg-muted">
              <TableHead class="px-4">{{ t('bill.col.number') }}</TableHead><TableHead>{{ t('bill.col.date') }}</TableHead><TableHead>{{ t('bill.col.period') }}</TableHead><TableHead class="text-right">{{ t('bill.col.amount') }}</TableHead><TableHead>{{ t('common.status') }}</TableHead><TableHead class="px-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="i in invoices" :key="i.id" class="h-[52px]" data-testid="invoice-row">
              <TableCell class="px-4 font-mono text-xs" data-testid="invoice-number">{{ i.number }}</TableCell>
              <TableCell>{{ amsterdamDay(i.createdAt) }}</TableCell>
              <TableCell class="text-text-secondary">{{ amsterdamDay(i.periodStart) }} – {{ amsterdamDay(i.periodEnd) }}</TableCell>
              <TableCell class="text-right font-mono">{{ euro(i.gross) }}</TableCell>
              <TableCell><Badge :variant="i.status === 'paid' ? 'success' : 'danger'" data-testid="invoice-status">{{ t(mk(`bill.invoiceStatus.${i.status}`)) }}</Badge></TableCell>
              <TableCell class="px-4 text-right">
                <Button variant="outline" size="sm" as-child><a :href="`/api/dashboard/billing/invoices/${i.id}/pdf`" download data-testid="invoice-pdf"><FileDownIcon />{{ t('bill.pdf') }}</a></Button>
              </TableCell>
            </TableRow>
            <TableRow v-if="!invoices.length" class="hover:bg-transparent"><TableCell colspan="6" class="h-[52px] text-center text-muted-foreground">{{ t('bill.invoicesEmpty') }}</TableCell></TableRow>
          </TableBody>
        </Table>
      </div>
    </CardContent>
  </Card>
</template>
