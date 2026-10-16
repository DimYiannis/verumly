<script setup lang="ts">
const { support, subscribed, busy, error, enable, disable } = usePush();
</script>

<template>
  <section class="card space-y-2" aria-labelledby="push-h" data-testid="push-optin">
    <h2 id="push-h" class="font-semibold">Notifications for new versions</h2>
    <p class="text-sm text-slate-800">Optional. You get a notification when a receipt is updated, for example after payment. The notification contains no amounts.</p>

    <p v-if="support.kind === 'ios-needs-install'" role="note" data-testid="ios-install-hint" class="rounded-lg bg-amber-100 p-3 text-sm text-amber-950">
      On iPhone and iPad, notifications only work after you add the app to your home screen (iOS 16.4 or newer). Tap <strong>Share</strong> → <strong>Add to Home Screen</strong> and open the app from there.
    </p>
    <p v-else-if="support.kind === 'ios-too-old'" role="note" data-testid="ios-too-old" class="rounded-lg bg-amber-100 p-3 text-sm text-amber-950">
      Notifications require iOS 16.4 or newer. Update your device to use them.
    </p>
    <p v-else-if="support.kind === 'denied'" role="note" data-testid="push-denied" class="rounded-lg bg-amber-100 p-3 text-sm text-amber-950">
      Notifications are blocked in your browser. Turn them on in the site settings.
    </p>
    <p v-else-if="support.kind === 'unsupported'" role="note" data-testid="push-unsupported" class="rounded-lg bg-amber-100 p-3 text-sm text-amber-950">
      This browser does not support notifications.
    </p>
    <template v-else>
      <button v-if="!subscribed" type="button" class="btn btn-secondary" data-testid="push-enable" :disabled="busy" @click="enable">Turn on notifications</button>
      <button v-else type="button" class="btn btn-secondary" data-testid="push-disable" :disabled="busy" @click="disable">Turn off notifications</button>
    </template>
    <p role="status" data-testid="push-status" class="text-sm text-slate-800">{{ subscribed ? 'Notifications are on.' : '' }}</p>
    <p v-if="error" role="alert" data-testid="push-error" class="text-red-800">{{ error }}</p>
  </section>
</template>
