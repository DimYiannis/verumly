<script setup lang="ts">
import { LayoutDashboardIcon } from '@lucide/vue';

definePageMeta({ layout: 'default' });

const sim = useSimulator();
onMounted(() => sim.init());
onBeforeUnmount(() => sim.dispose());
</script>

<template>
  <div class="mx-auto flex max-w-7xl flex-col gap-4 p-4">
    <header class="flex flex-wrap items-center gap-3 px-2 pt-2">
      <div>
        <h1 class="text-2xl font-medium tracking-tight">POS simulator</h1>
        <p class="text-sm text-muted-foreground">Horeca till on the browser terminal SDK.</p>
      </div>
      <Button variant="outline" class="ml-auto" as-child><NuxtLink to="/dashboard" data-testid="sim-dashboard-link"><LayoutDashboardIcon />Dashboard</NuxtLink></Button>
    </header>

    <Card v-if="!sim.creds.value" class="max-w-xl" data-testid="sim-setup-panel">
      <CardHeader>
        <CardTitle class="text-base">No terminal yet</CardTitle>
        <CardDescription>Log in to the dashboard, then create a demo terminal here. A keypair is generated in this browser. Only the public key is registered, and the API key is stored in this browser's localStorage.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <Button :disabled="sim.busy.value" data-testid="sim-setup" @click="sim.setupDemoTerminal()">Set up demo terminal</Button>
        <AppErrorNote v-if="sim.error.value" data-testid="sim-error">{{ sim.error.value }} <NuxtLink to="/dashboard/login" class="font-medium underline">Log in</NuxtLink></AppErrorNote>
      </CardContent>
    </Card>

    <div v-else class="grid items-start gap-4 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
      <div class="flex flex-col gap-4">
        <Card>
          <CardHeader><CardTitle class="text-base">Add item</CardTitle></CardHeader>
          <CardContent class="grid grid-cols-2 gap-3">
            <Button v-for="p in PRODUCTS" :key="p.sku" variant="outline" class="h-auto flex-col gap-0.5 py-3" :disabled="!sim.editable.value || sim.busy.value" :data-testid="`sim-add-${p.sku}`" @click="sim.addItem(p.sku)">
              <span>{{ p.label }}</span>
              <span class="text-xs font-normal text-muted-foreground tabular-nums">{{ euro(p.unitPrice) }} · {{ p.vatRate }}%</span>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle class="text-base">Cart</CardTitle>
            <CardDescription>State <span data-testid="sim-state">{{ sim.state.value ?? 'none' }}</span> · version <span data-testid="sim-version">{{ sim.current.value?.crf.version ?? 0 }}</span></CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <ul class="divide-y rounded-md border text-sm" data-testid="sim-cart">
              <li v-for="l in sim.cart.value" :key="l.sku" class="flex h-[52px] items-center justify-between px-4" data-testid="sim-cart-line">
                <span>{{ l.qty }} × {{ l.description }}</span><span class="tabular-nums">{{ euro(l.qty * l.unitPrice) }}</span>
              </li>
              <li v-if="!sim.cart.value.length" class="flex h-[52px] items-center px-4 text-muted-foreground">Empty</li>
            </ul>
            <div class="space-y-1">
              <div v-if="sim.rounding.value" class="flex justify-between text-sm text-muted-foreground"><span>Rounding</span><span class="tabular-nums" data-testid="sim-rounding">{{ euro(sim.rounding.value) }}</span></div>
              <div class="flex justify-between text-xl font-medium"><span>Total</span><span class="tabular-nums" data-testid="sim-total">{{ euro(sim.total.value + sim.rounding.value) }}</span></div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <Button variant="outline" :disabled="sim.busy.value || !sim.cart.value.length || !sim.editable.value" data-testid="sim-present" @click="sim.present()">Present</Button>
              <Button variant="destructive" :disabled="sim.busy.value || !sim.current.value || sim.state.value === 'void'" data-testid="sim-void" @click="sim.voidSale()">Void</Button>
              <Button :disabled="sim.busy.value || !sim.cart.value.length || !sim.editable.value" data-testid="sim-pay-card" @click="sim.pay('card')">Pay card</Button>
              <Button variant="outline" :disabled="sim.busy.value || !sim.cart.value.length || !sim.editable.value" data-testid="sim-pay-cash" @click="sim.pay('cash')">Pay cash</Button>
              <Button variant="ghost" class="col-span-2" data-testid="sim-new-sale" @click="sim.newSale()">New sale</Button>
            </div>
            <AppErrorNote v-if="sim.error.value" data-testid="sim-error">{{ sim.error.value }}</AppErrorNote>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="space-y-3 text-sm">
            <div class="flex items-center justify-between gap-4">
              <Label for="sim-offline-toggle" class="font-normal">Offline (pause uploads, fail requests)</Label>
              <Switch id="sim-offline-toggle" :model-value="sim.offline.value" data-testid="sim-offline-toggle" @update:model-value="sim.setOffline(Boolean($event))" />
            </div>
            <p class="text-muted-foreground">Outbox: <span data-testid="sim-pending">{{ sim.stats.value.pending }}</span> pending · <span data-testid="sim-rejected">{{ sim.stats.value.rejected }}</span> rejected · <span data-testid="sim-network">{{ sim.offline.value ? 'offline' : 'online' }}</span></p>
            <div class="flex items-center justify-between gap-3 border-t pt-3">
              <p class="min-w-0 break-all text-xs text-muted-foreground">Terminal <code class="font-mono" data-testid="sim-terminal-id">{{ sim.creds.value.terminalId }}</code></p>
              <Button variant="ghost" data-testid="sim-reset" @click="sim.forgetTerminal()">Forget terminal</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card class="items-center py-8 lg:sticky lg:top-4">
        <template v-if="sim.current.value">
          <CardTitle class="text-lg">Scan to get your receipt</CardTitle>
          <!-- sized for a phone held 30-50 cm from a laptop screen: up to 68% of the viewport height, capped -->
          <div class="aspect-square w-[min(68vh,36rem)] max-w-full rounded-md border bg-white p-2" data-testid="sim-qr" v-html="sim.qrSvg.value" />
          <p class="max-w-full break-all px-6 text-center font-mono text-xs text-muted-foreground" data-testid="sim-qr-url">{{ sim.current.value.qrUrl }}</p>
        </template>
        <p v-else class="my-auto px-6 py-24 text-center text-muted-foreground" data-testid="sim-qr-placeholder">Add items, then present or pay. The QR code appears here.</p>
      </Card>
    </div>
  </div>
</template>
