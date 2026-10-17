<script setup lang="ts">
// A location or terminal was refused by the plan (402 plan_limit / plan_inactive): say why and link to Billing.
defineProps<{ code: PlanRefusal }>();
const { t } = useLocale();
const session = sessionState();
const canSeeBilling = computed(() => session.value.user?.role !== 'manager');
</script>

<template>
  <AppNotice tone="warning" role="alert" :data-testid="`plan-refusal-${code}`">
    {{ t(code === 'plan_limit' ? 'bill.refused.plan_limit' : 'bill.refused.plan_inactive') }}<template v-if="!canSeeBilling"> {{ t('bill.banner.askOwner') }}</template>
    <template v-if="canSeeBilling" #action>
      <NuxtLink to="/dashboard/billing" class="rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring" data-testid="plan-refusal-upgrade">{{ t('bill.refused.upgrade') }}</NuxtLink>
    </template>
  </AppNotice>
</template>
