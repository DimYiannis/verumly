<script setup lang="ts">
definePageMeta({ layout: 'default' });

const sim = useSimulator();
onMounted(() => sim.init());
onBeforeUnmount(() => sim.dispose());

const btn = 'rounded px-4 py-3 text-base font-medium disabled:opacity-40';
</script>

<template>
  <div class="mx-auto max-w-7xl px-4 py-5">
    <header class="mb-4 flex flex-wrap items-center gap-4">
      <h1 class="text-xl font-semibold">POS simulator</h1>
      <span class="text-sm text-slate-500">Horeca till · browser terminal SDK</span>
      <NuxtLink to="/dashboard" class="ml-auto text-sm underline" data-testid="sim-dashboard-link">Dashboard</NuxtLink>
    </header>

    <section v-if="!sim.creds.value" class="max-w-xl rounded-lg border border-slate-200 bg-white p-5" data-testid="sim-setup-panel">
      <h2 class="mb-2 font-medium">No terminal yet</h2>
      <p class="mb-3 text-sm text-slate-600">Log in to the dashboard, then create a demo terminal here. A keypair is generated in this browser; only the public key is registered, and the API key is stored in this browser's localStorage.</p>
      <button :disabled="sim.busy.value" :class="[btn, 'bg-slate-900 text-white']" data-testid="sim-setup" @click="sim.setupDemoTerminal()">Set up demo terminal</button>
      <p v-if="sim.error.value" class="mt-3 text-sm text-red-700" role="alert" data-testid="sim-error">{{ sim.error.value }} <NuxtLink to="/dashboard/login" class="underline">Log in</NuxtLink></p>
    </section>

    <div v-else class="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
      <div class="space-y-5">
        <section class="rounded-lg border border-slate-200 bg-white p-4">
          <h2 class="mb-2 text-sm font-medium text-slate-600">Add item</h2>
          <div class="grid grid-cols-2 gap-3">
            <button v-for="p in PRODUCTS" :key="p.sku" :disabled="!sim.editable.value || sim.busy.value" :class="[btn, p.vatRate === 9 ? 'bg-emerald-100 hover:bg-emerald-200' : 'bg-sky-100 hover:bg-sky-200']" :data-testid="`sim-add-${p.sku}`" @click="sim.addItem(p.sku)">
              {{ p.label }}<br /><span class="text-sm font-normal">{{ euro(p.unitPrice) }} · {{ p.vatRate }}%</span>
            </button>
          </div>
        </section>

        <section class="rounded-lg border border-slate-200 bg-white p-4">
          <h2 class="mb-2 text-sm font-medium text-slate-600">Cart</h2>
          <ul class="mb-3 space-y-1 text-sm" data-testid="sim-cart">
            <li v-for="l in sim.cart.value" :key="l.sku" class="flex justify-between" data-testid="sim-cart-line">
              <span>{{ l.qty }} × {{ l.description }}</span><span class="tabular-nums">{{ euro(l.qty * l.unitPrice) }}</span>
            </li>
            <li v-if="!sim.cart.value.length" class="text-slate-400">Empty</li>
          </ul>
          <div v-if="sim.rounding.value" class="flex justify-between text-sm text-slate-600"><span>Rounding</span><span class="tabular-nums" data-testid="sim-rounding">{{ euro(sim.rounding.value) }}</span></div>
          <div class="flex justify-between text-lg font-semibold"><span>Total</span><span class="tabular-nums" data-testid="sim-total">{{ euro(sim.total.value + sim.rounding.value) }}</span></div>
          <p class="mt-1 text-sm text-slate-500">State: <span data-testid="sim-state">{{ sim.state.value ?? 'none' }}</span> · version <span data-testid="sim-version">{{ sim.current.value?.crf.version ?? 0 }}</span></p>
        </section>

        <section class="grid grid-cols-2 gap-3">
          <button :disabled="sim.busy.value || !sim.cart.value.length || !sim.editable.value" :class="[btn, 'bg-amber-500 text-white']" data-testid="sim-present" @click="sim.present()">Present</button>
          <button :disabled="sim.busy.value || !sim.current.value || sim.state.value === 'void'" :class="[btn, 'bg-red-700 text-white']" data-testid="sim-void" @click="sim.voidSale()">Void</button>
          <button :disabled="sim.busy.value || !sim.cart.value.length || !sim.editable.value" :class="[btn, 'bg-slate-900 text-white']" data-testid="sim-pay-card" @click="sim.pay('card')">Pay card</button>
          <button :disabled="sim.busy.value || !sim.cart.value.length || !sim.editable.value" :class="[btn, 'bg-slate-700 text-white']" data-testid="sim-pay-cash" @click="sim.pay('cash')">Pay cash</button>
          <button :class="[btn, 'col-span-2 border border-slate-300 bg-white']" data-testid="sim-new-sale" @click="sim.newSale()">New sale</button>
        </section>
        <p v-if="sim.error.value" class="text-sm text-red-700" role="alert" data-testid="sim-error">{{ sim.error.value }}</p>

        <section class="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <label class="flex items-center gap-2">
            <input type="checkbox" :checked="sim.offline.value" data-testid="sim-offline-toggle" @change="sim.setOffline(($event.target as HTMLInputElement).checked)" />
            Offline (pause uploads, fail requests)
          </label>
          <p class="mt-2 text-slate-600">Outbox: <span data-testid="sim-pending">{{ sim.stats.value.pending }}</span> pending · <span data-testid="sim-rejected">{{ sim.stats.value.rejected }}</span> rejected · <span data-testid="sim-network">{{ sim.offline.value ? 'offline' : 'online' }}</span></p>
          <p class="mt-2 break-all text-xs text-slate-500">Terminal <code data-testid="sim-terminal-id">{{ sim.creds.value.terminalId }}</code> <button class="ml-2 underline" data-testid="sim-reset" @click="sim.forgetTerminal()">Forget terminal</button></p>
        </section>
      </div>

      <section class="flex flex-col items-center justify-start rounded-lg border border-slate-200 bg-white p-6">
        <template v-if="sim.current.value">
          <p class="mb-3 text-center text-lg font-medium">Scan to get your receipt</p>
          <!-- sized for a phone held 30–50 cm from a laptop screen: ≥ 60% of the viewport height, capped -->
          <div class="aspect-square w-[min(68vh,36rem)] max-w-full bg-white" data-testid="sim-qr" v-html="sim.qrSvg.value" />
          <p class="mt-3 max-w-full break-all text-center font-mono text-xs text-slate-500" data-testid="sim-qr-url">{{ sim.current.value.qrUrl }}</p>
        </template>
        <p v-else class="my-auto text-slate-400" data-testid="sim-qr-placeholder">Add items, then Present or Pay: the QR code appears here.</p>
      </section>
    </div>
  </div>
</template>
