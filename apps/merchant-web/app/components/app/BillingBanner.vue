<script setup lang="ts">
import { CircleAlertIcon } from '@lucide/vue';

// Plan banner on every dashboard page: plan inactive, payment failed, or the trial ends within 3 days.
const { t } = useLocale();
const route = useRoute();
const notice = billingNotice();
const session = sessionState();
const canSeeBilling = computed(() => session.value.user?.role !== 'manager');

watch(() => route.path, () => refreshBillingNotice(), { immediate: true });

const text = computed(() => {
  const n = notice.value;
  if (!n) return '';
  if (n.kind === 'inactive') return t('bill.banner.inactive');
  if (n.kind === 'past_due') return t('bill.banner.past_due');
  if (n.daysLeft <= 0) return t('bill.banner.trialEndingToday');
  return n.daysLeft === 1 ? t('bill.banner.trialEndingOne') : t('bill.banner.trialEnding', { n: n.daysLeft });
});
const danger = computed(() => notice.value?.kind !== 'trial_ending');
</script>

<template>
  <div
    v-if="notice"
    role="status"
    :class="['flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm', danger ? 'border-danger-border bg-danger-soft text-danger' : 'border-warning-border bg-warning-soft text-warning']"
    :data-testid="`billing-banner-${notice.kind}`"
  >
    <CircleAlertIcon class="size-4 shrink-0" />
    <span class="min-w-0 flex-1 font-medium" data-testid="billing-banner">{{ text }}<template v-if="!canSeeBilling">. {{ t('bill.banner.askOwner') }}</template></span>
    <NuxtLink v-if="canSeeBilling && route.path !== '/dashboard/billing'" to="/dashboard/billing" class="font-medium underline underline-offset-4" data-testid="billing-banner-action">{{ t('bill.banner.action') }}</NuxtLink>
  </div>
</template>
