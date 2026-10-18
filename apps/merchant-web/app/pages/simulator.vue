<script setup lang="ts">
import { CheckIcon, CopyIcon, ExternalLinkIcon, LayoutDashboardIcon } from '@lucide/vue';

definePageMeta({ layout: 'default' });

const { t, tx } = useLocale();
const sim = useSimulator();
onMounted(() => sim.init());
onBeforeUnmount(() => sim.dispose());

/** the fiscal data the state integration added to the receipt, with the country's names for them */
const fiscalRows = computed(() => {
  const f = sim.current.value?.crf.fiscal;
  const spec = sim.fiscal.value;
  if (!f || !spec) return [];
  const names = new Map(spec.fields.map((x) => [x.key, x.label]));
  return Object.entries(f.extra).map(([key, value]) => ({ key, label: names.get(key) ?? (key === 'mode' ? t('fiscal.mode') : key), value }));
});

const voidOpen = ref(false);
const cancelled = computed(() => sim.state.value === 'void');
async function confirmVoid() {
  voidOpen.value = false;
  await sim.voidSale();
}

const linkCopied = ref(false);
async function copyLink() {
  const url = sim.current.value?.qrUrl;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    linkCopied.value = true;
    setTimeout(() => (linkCopied.value = false), 2000);
  } catch {
    /* clipboard unavailable: the link stays visible and selectable */
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-7xl flex-col gap-4 p-4">
    <header class="flex flex-wrap items-center gap-3 px-2 pt-2">
      <div>
        <h1 class="text-2xl font-medium tracking-tight">{{ t('sim.title') }}</h1>
        <p class="text-sm text-muted-foreground">{{ t('adm.sim.subtitle') }}</p>
      </div>
      <div class="ml-auto flex items-center gap-3">
        <Badge v-if="sim.creds.value" :variant="sim.offline.value ? 'warning' : 'success'">{{ sim.offline.value ? t('sim.offline') : t('sim.online') }}</Badge>
        <AppLocaleSwitch />
        <Button variant="outline" as-child><NuxtLink to="/dashboard" data-testid="sim-dashboard-link"><LayoutDashboardIcon />{{ t('sim.dashboard') }}</NuxtLink></Button>
      </div>
    </header>

    <Card v-if="!sim.creds.value" class="max-w-xl" data-testid="sim-setup-panel">
      <CardHeader>
        <CardTitle class="text-base">{{ t('sim.noTerminal') }}</CardTitle>
        <CardDescription>{{ t('sim.noTerminalHelp') }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <Button :disabled="sim.busy.value" data-testid="sim-setup" @click="sim.setupDemoTerminal()">{{ t('sim.setup') }}</Button>
        <AppErrorNote v-if="sim.error.value" data-testid="sim-error">{{ sim.error.value }} <NuxtLink to="/dashboard/login" class="font-medium underline">{{ t('sim.logIn') }}</NuxtLink></AppErrorNote>
      </CardContent>
    </Card>

    <div v-else class="grid items-start gap-4 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
      <div class="flex flex-col gap-4">
        <Card>
          <CardHeader><CardTitle class="text-base">{{ t('sim.addItem') }}</CardTitle></CardHeader>
          <CardContent class="grid grid-cols-2 gap-3">
            <Button v-for="p in sim.products.value" :key="p.sku" variant="outline" class="h-auto flex-col gap-0.5 py-3.5" :disabled="!sim.editable.value || sim.busy.value" :data-testid="`sim-add-${p.sku}`" @click="sim.addItem(p.sku)">
              <span>{{ p.label }}</span>
              <span class="font-mono text-xs font-normal text-muted-foreground tabular-nums">{{ money(p.unitPrice) }} · {{ p.vatRate }}%</span>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <CardTitle class="text-base">{{ t('sim.cart') }}</CardTitle>
              <CardDescription class="text-xs">{{ t('sim.state') }} <span data-testid="sim-state">{{ sim.state.value ? tx('status', sim.state.value) : t('sim.stateNone') }}</span> · {{ t('sim.version') }} <span data-testid="sim-version">{{ sim.current.value?.crf.version ?? 0 }}</span></CardDescription>
            </div>
          </CardHeader>
          <CardContent class="space-y-4">
            <ul class="divide-y rounded-md border text-sm" data-testid="sim-cart">
              <li v-for="l in sim.cart.value" :key="l.sku" class="flex h-[52px] items-center justify-between px-4" data-testid="sim-cart-line">
                <span>{{ l.qty }} × {{ l.description }}</span><span class="tabular-nums">{{ money(l.qty * l.unitPrice) }}</span>
              </li>
              <li v-if="!sim.cart.value.length" class="flex h-[52px] items-center px-4 text-muted-foreground">{{ t('sim.empty') }}</li>
            </ul>
            <div class="space-y-1">
              <div v-if="sim.rounding.value" class="flex justify-between text-sm text-muted-foreground"><span>{{ t('common.rounding') }}</span><span class="tabular-nums" data-testid="sim-rounding">{{ money(sim.rounding.value) }}</span></div>
              <div class="flex justify-between text-xl font-medium"><span>{{ t('common.total') }}</span><span class="tabular-nums" data-testid="sim-total">{{ money(sim.total.value + sim.rounding.value) }}</span></div>
            </div>
            <div class="space-y-2">
              <div class="flex gap-2">
                <Button class="flex-1" :disabled="sim.busy.value || !sim.cart.value.length || !sim.editable.value" data-testid="sim-issue" @click="sim.issue()">{{ t('sim.issue') }}</Button>
                <Button variant="outline" class="flex-1 text-danger hover:text-danger" :disabled="sim.busy.value || !sim.current.value || sim.state.value === 'void'" data-testid="sim-void" @click="voidOpen = true">{{ t('sim.void') }}</Button>
              </div>
              <Button variant="ghost" class="w-full" data-testid="sim-new-sale" @click="sim.newSale()">{{ t('sim.newSale') }}</Button>
            </div>
            <AppErrorNote v-if="sim.error.value" data-testid="sim-error">{{ sim.error.value }}</AppErrorNote>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="space-y-3 text-sm">
            <div class="flex items-center justify-between gap-4">
              <Label for="sim-offline-toggle" class="font-normal">{{ t('sim.offlineToggle') }}</Label>
              <Switch id="sim-offline-toggle" :model-value="sim.offline.value" data-testid="sim-offline-toggle" @update:model-value="sim.setOffline(Boolean($event))" />
            </div>
            <p class="text-muted-foreground">{{ t('sim.outbox') }} <span data-testid="sim-pending">{{ sim.stats.value.pending }}</span> {{ t('sim.pending') }} · <span data-testid="sim-rejected">{{ sim.stats.value.rejected }}</span> {{ t('sim.rejected') }} · <span data-testid="sim-network">{{ sim.offline.value ? t('sim.offline') : t('sim.online') }}</span></p>
            <div class="flex items-center justify-between gap-3 border-t pt-3">
              <p class="min-w-0 break-all text-xs text-muted-foreground">{{ t('sim.terminal') }} <code class="font-mono" data-testid="sim-terminal-id">{{ sim.creds.value.terminalId }}</code></p>
              <Button variant="ghost" data-testid="sim-reset" @click="sim.forgetTerminal()">{{ t('sim.forget') }}</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card class="items-center py-8 lg:sticky lg:top-4">
        <template v-if="sim.current.value">
          <CardTitle v-if="cancelled" class="text-lg text-danger" data-testid="sim-cancelled-title">{{ t('sim.cancelledTitle') }}</CardTitle>
          <CardTitle v-else class="text-lg">{{ t('sim.scan') }}</CardTitle>
          <!-- sized for a phone held 30-50 cm from a laptop screen: up to 68% of the viewport height, capped -->
          <div class="relative aspect-square w-[min(68vh,36rem)] max-w-full">
            <div class="size-full rounded-md border bg-white p-2 transition-opacity" :class="cancelled ? 'opacity-15 grayscale' : ''" data-testid="sim-qr" :aria-hidden="cancelled" v-html="sim.qrSvg.value" />
            <div v-if="cancelled" class="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center" role="status" data-testid="sim-cancelled">
              <Badge variant="destructive" class="px-4 py-1.5 text-xl">{{ t('sim.cancelledBadge') }}</Badge>
              <p class="text-sm text-muted-foreground">{{ t('sim.cancelledHelp') }}</p>
            </div>
          </div>
          <p class="max-w-full break-all px-6 text-center font-mono text-xs text-muted-foreground" data-testid="sim-qr-url">{{ sim.current.value.qrUrl }}</p>
          <div class="flex gap-2">
            <Button type="button" variant="outline" size="sm" data-testid="sim-copy-link" @click="copyLink"><component :is="linkCopied ? CheckIcon : CopyIcon" />{{ linkCopied ? t('adm.copied') : t('adm.sim.copyLink') }}</Button>
            <Button variant="outline" size="sm" as-child><a :href="sim.current.value.qrUrl" target="_blank" rel="noopener noreferrer" data-testid="sim-open-wallet"><ExternalLinkIcon />{{ t('adm.sim.openWallet') }}</a></Button>
          </div>
        </template>
        <p v-else class="my-auto px-6 py-24 text-center text-muted-foreground" data-testid="sim-qr-placeholder">{{ t('sim.qrPlaceholder') }}</p>
      </Card>

      <Card v-if="sim.fiscal.value" class="lg:col-start-2" data-testid="sim-fiscal">
        <CardHeader>
          <CardTitle class="text-base">{{ t('fiscal.title') }}</CardTitle>
          <CardDescription>{{ sim.fiscal.value.system }} · {{ sim.fiscal.value.authority }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-3 text-sm">
          <p class="text-muted-foreground">{{ sim.fiscal.value.how }}</p>
          <dl v-if="sim.current.value && fiscalRows.length" class="space-y-1 rounded-md border p-3" data-testid="sim-fiscal-data">
            <div v-for="r in fiscalRows" :key="r.key" class="flex justify-between gap-4"><dt class="shrink-0 text-muted-foreground">{{ r.label }}</dt><dd class="min-w-0 break-all text-right font-mono text-xs">{{ r.value }}</dd></div>
          </dl>
          <p v-else class="text-muted-foreground" data-testid="sim-fiscal-pending">{{ t('fiscal.waiting') }}</p>
          <Badge variant="warning">{{ t('fiscal.sandbox') }}</Badge>
        </CardContent>
      </Card>
    </div>

    <AlertDialog v-model:open="voidOpen">
      <AlertDialogContent data-testid="sim-void-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('sim.voidTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('sim.voidBody') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="sim-void-keep">{{ t('sim.voidKeep') }}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" data-testid="sim-void-confirm" @click="confirmVoid">{{ t('sim.voidConfirm') }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
