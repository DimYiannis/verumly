<script setup lang="ts">
import { generateKeyPair } from '@lr/crypto';

definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Term { id: string; label: string; locationId: string; locationName: string; signingPublicKey: string; lastSeenAt: string | null; revokedAt: string | null; createdAt: string }
interface Loc { id: string; name: string }

const rows = ref<Term[]>([]);
const locations = ref<Loc[]>([]);
const error = ref('');
const form = reactive({ label: '', locationId: '', publicKey: '' });
// shown exactly once, never stored in the page after dismissal
const created = ref<{ terminalId: string; apiKey: string } | null>(null);
const generatedPrivateKey = ref('');
const confirming = ref<string | null>(null);

async function load() {
  const [t, l] = await Promise.all([
    attempt(error, () => $fetch<Term[]>('/api/dashboard/terminals')),
    attempt(error, () => $fetch<Loc[]>('/api/dashboard/locations')),
  ]);
  if (t) rows.value = t;
  if (l) {
    locations.value = l;
    form.locationId ||= l[0]?.id ?? '';
  }
}
onMounted(load);

function generate() {
  const k = generateKeyPair();
  form.publicKey = k.publicKey;
  generatedPrivateKey.value = k.privateKey;
}

async function create() {
  const r = await attempt(error, () => $fetch<{ terminalId: string; apiKey: string }>('/api/dashboard/terminals', { method: 'POST', body: { label: form.label, locationId: form.locationId, publicKey: form.publicKey } }));
  if (r) {
    created.value = r;
    form.label = '';
    form.publicKey = '';
    await load();
  }
}

async function revoke(id: string) {
  if (confirming.value !== id) {
    confirming.value = id;
    return;
  }
  confirming.value = null;
  if (await attempt(error, () => $fetch<unknown>(`/api/dashboard/terminals/${id}/revoke`, { method: 'POST' }))) await load();
}
</script>

<template>
  <h1 class="mb-4 text-xl font-semibold">Terminals</h1>
  <p v-if="error" class="mb-3 text-sm text-red-700" role="alert" data-testid="error">{{ error }}</p>

  <div v-if="created" class="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-4" data-testid="terminal-created">
    <p class="mb-2 text-sm font-medium">Terminal API key — copy it now. It is shown only once and cannot be recovered.</p>
    <code class="block break-all rounded bg-white p-2 text-sm" data-testid="terminal-key">{{ created.apiKey }}</code>
    <p class="mt-2 text-xs text-slate-600">Terminal id: <code data-testid="terminal-id">{{ created.terminalId }}</code></p>
    <button class="mt-3 rounded border border-slate-400 px-3 py-1 text-sm" data-testid="terminal-key-dismiss" @click="created = null">I have saved the key</button>
  </div>

  <table class="w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
    <thead class="bg-slate-100 text-left"><tr><th class="p-2">Label</th><th class="p-2">Location</th><th class="p-2">Public key</th><th class="p-2">Last seen</th><th class="p-2">Status</th><th class="p-2" /></tr></thead>
    <tbody>
      <tr v-for="t in rows" :key="t.id" class="border-t border-slate-100" data-testid="terminal-row" :data-terminal-id="t.id">
        <td class="p-2" data-testid="terminal-label-cell">{{ t.label }}</td>
        <td class="p-2">{{ t.locationName }}</td>
        <td class="p-2 font-mono text-xs">{{ t.signingPublicKey.slice(0, 12) }}…</td>
        <td class="p-2">{{ t.lastSeenAt ? amsterdam(t.lastSeenAt) : '—' }}</td>
        <td class="p-2" data-testid="terminal-status">{{ t.revokedAt ? 'revoked' : 'active' }}</td>
        <td class="p-2 text-right">
          <button v-if="!t.revokedAt" :class="confirming === t.id ? 'rounded bg-red-700 px-2 py-1 text-white' : 'text-red-700 underline'" :data-testid="confirming === t.id ? 'terminal-revoke-confirm' : 'terminal-revoke'" @click="revoke(t.id)">
            {{ confirming === t.id ? 'Confirm revoke' : 'Revoke' }}
          </button>
        </td>
      </tr>
    </tbody>
  </table>

  <form class="mt-6 max-w-2xl space-y-3 rounded-lg border border-slate-200 bg-white p-4" @submit.prevent="create">
    <h2 class="font-medium">Register a terminal</h2>
    <div class="flex flex-wrap gap-3">
      <label class="text-sm">Label<input v-model="form.label" required data-testid="terminal-label" class="mt-1 block rounded border border-slate-300 px-3 py-2" /></label>
      <label class="text-sm">Location
        <select v-model="form.locationId" required data-testid="terminal-location" class="mt-1 block rounded border border-slate-300 px-3 py-2">
          <option v-for="l in locations" :key="l.id" :value="l.id">{{ l.name }}</option>
        </select>
      </label>
    </div>
    <label class="block text-sm">Ed25519 public key (32 bytes, base64url) — the private key stays on the terminal
      <input v-model="form.publicKey" required data-testid="terminal-public-key" class="mt-1 block w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs" />
    </label>
    <div class="flex flex-wrap items-center gap-3">
      <button type="button" class="rounded border border-slate-300 px-3 py-1 text-sm" data-testid="terminal-generate" @click="generate">Generate a keypair in this browser</button>
      <button data-testid="terminal-create" class="rounded bg-slate-900 px-4 py-2 text-white">Create terminal</button>
    </div>
    <p v-if="generatedPrivateKey" class="text-xs text-slate-600">Private key (copy to the terminal now; it is never sent to the server): <code class="break-all" data-testid="terminal-private-key">{{ generatedPrivateKey }}</code></p>
  </form>
</template>
