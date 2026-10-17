<script setup lang="ts">
const { support, subscribed, busy, error, enable, disable } = usePush();
const { t } = useLocale();
</script>

<template>
  <section class="space-y-3 rounded-xl border border-border bg-card p-4" aria-labelledby="push-h" data-testid="push-optin">
    <h2 id="push-h" class="text-h3 font-semibold">{{ t('push.title') }}</h2>
    <p class="text-sm text-text-secondary">{{ t('push.body') }}</p>

    <p v-if="support.kind === 'ios-needs-install'" role="note" data-testid="ios-install-hint" class="rounded-lg border border-warning-border bg-warning-soft p-3 text-sm text-warning">
      {{ t('push.ios1') }}<strong>{{ t('push.iosShare') }}</strong>{{ t('push.ios2') }}<strong>{{ t('push.iosAdd') }}</strong>{{ t('push.ios3') }}
      <span v-if="t('push.iosEn')" class="block">{{ t('push.iosEn') }}</span>
    </p>
    <p v-else-if="support.kind === 'ios-too-old'" role="note" data-testid="ios-too-old" class="rounded-lg border border-warning-border bg-warning-soft p-3 text-sm text-warning">
      {{ t('push.iosTooOld') }}
    </p>
    <p v-else-if="support.kind === 'denied'" role="note" data-testid="push-denied" class="rounded-lg border border-warning-border bg-warning-soft p-3 text-sm text-warning">
      {{ t('push.denied') }}
    </p>
    <p v-else-if="support.kind === 'unsupported'" role="note" data-testid="push-unsupported" class="rounded-lg border border-warning-border bg-warning-soft p-3 text-sm text-warning">
      {{ t('push.unsupported') }}
    </p>
    <template v-else>
      <Button v-if="!subscribed" type="button" size="lg" variant="secondary" data-testid="push-enable" :disabled="busy" @click="enable">{{ t('push.enable') }}</Button>
      <Button v-else type="button" size="lg" variant="secondary" data-testid="push-disable" :disabled="busy" @click="disable">{{ t('push.disable') }}</Button>
    </template>
    <p role="status" data-testid="push-status" class="text-sm text-text-secondary">{{ subscribed ? t('push.on') : '' }}</p>
    <p v-if="error" role="alert" data-testid="push-error" class="text-sm text-danger">{{ t(error) }}</p>
  </section>
</template>
