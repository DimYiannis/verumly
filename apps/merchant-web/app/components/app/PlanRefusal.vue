<script setup lang="ts">
import { SparklesIcon } from '@lucide/vue';

// A location or terminal was refused by the plan (402 plan_limit / plan_inactive): say why and link to Billing.
defineProps<{ code: PlanRefusal }>();
const { t } = useLocale();
const session = sessionState();
const canSeeBilling = computed(() => session.value.user?.role !== 'manager');
</script>

<template>
  <div role="alert" class="flex flex-wrap items-center gap-3 rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-sm text-warning" :data-testid="`plan-refusal-${code}`">
    <SparklesIcon class="size-4 shrink-0" />
    <span class="min-w-0 flex-1">{{ t(code === 'plan_limit' ? 'bill.refused.plan_limit' : 'bill.refused.plan_inactive') }}<template v-if="!canSeeBilling"> {{ t('bill.banner.askOwner') }}</template></span>
    <NuxtLink v-if="canSeeBilling" to="/dashboard/billing" class="font-medium underline underline-offset-4" data-testid="plan-refusal-upgrade">{{ t('bill.refused.upgrade') }}</NuxtLink>
  </div>
</template>
