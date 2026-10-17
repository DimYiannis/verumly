<script setup lang="ts">
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
const tone = computed(() => (notice.value?.kind === 'trial_ending' ? 'warning' : 'danger'));
</script>

<template>
  <AppNotice v-if="notice" :tone="tone" role="status" :data-testid="`billing-banner-${notice.kind}`">
    <span class="font-medium" data-testid="billing-banner">{{ text }}<template v-if="!canSeeBilling">. {{ t('bill.banner.askOwner') }}</template></span>
    <template v-if="canSeeBilling && route.path !== '/dashboard/billing'" #action>
      <NuxtLink to="/dashboard/billing" class="rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring" data-testid="billing-banner-action">{{ t('bill.banner.action') }}</NuxtLink>
    </template>
  </AppNotice>
</template>
