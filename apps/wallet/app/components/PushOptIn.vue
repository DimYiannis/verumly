<script setup lang="ts">
const { support, subscribed, busy, error, enable, disable } = usePush();
</script>

<template>
  <section class="space-y-3 rounded-xl border border-border bg-card p-4" aria-labelledby="push-h" data-testid="push-optin">
    <h2 id="push-h" class="text-h3 font-semibold">Meldingen bij nieuwe versies</h2>
    <p class="text-sm text-text-secondary">Optioneel. Je krijgt een melding als een bon wordt bijgewerkt, bijvoorbeeld na betaling. De melding bevat geen bedragen.</p>

    <p v-if="support.kind === 'ios-needs-install'" role="note" data-testid="ios-install-hint" class="rounded-lg border border-warning-border bg-warning-soft p-3 text-sm text-warning">
      Op iPhone en iPad werken meldingen pas nadat je de app op je beginscherm hebt gezet (iOS 16.4 of nieuwer). Tik op <strong>Deel</strong> → <strong>Zet op beginscherm</strong> en open de app daar.
      <span class="block">Push only works after Add to Home Screen, iOS 16.4+.</span>
    </p>
    <p v-else-if="support.kind === 'ios-too-old'" role="note" data-testid="ios-too-old" class="rounded-lg border border-warning-border bg-warning-soft p-3 text-sm text-warning">
      Meldingen vereisen iOS 16.4 of nieuwer. Werk je toestel bij om ze te gebruiken.
    </p>
    <p v-else-if="support.kind === 'denied'" role="note" data-testid="push-denied" class="rounded-lg border border-warning-border bg-warning-soft p-3 text-sm text-warning">
      Meldingen zijn geblokkeerd in je browser. Zet ze aan in de site-instellingen.
    </p>
    <p v-else-if="support.kind === 'unsupported'" role="note" data-testid="push-unsupported" class="rounded-lg border border-warning-border bg-warning-soft p-3 text-sm text-warning">
      Deze browser ondersteunt geen meldingen.
    </p>
    <template v-else>
      <Button v-if="!subscribed" type="button" size="lg" variant="secondary" data-testid="push-enable" :disabled="busy" @click="enable">Meldingen aanzetten</Button>
      <Button v-else type="button" size="lg" variant="secondary" data-testid="push-disable" :disabled="busy" @click="disable">Meldingen uitzetten</Button>
    </template>
    <p role="status" data-testid="push-status" class="text-sm text-text-secondary">{{ subscribed ? 'Meldingen staan aan.' : '' }}</p>
    <p v-if="error" role="alert" data-testid="push-error" class="text-sm text-danger">{{ error }}</p>
  </section>
</template>
