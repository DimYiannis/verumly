<script setup lang="ts">
import { generateKeyPair } from '@lr/crypto';
import { KeyRoundIcon } from '@lucide/vue';

definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Term { id: string; label: string; locationId: string; locationName: string; signingPublicKey: string; lastSeenAt: string | null; revokedAt: string | null; createdAt: string }
interface Loc { id: string; name: string }

const { t: tl } = useLocale();
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
  <AppPageHeading :title="tl('nav.terminals')" :description="tl('terminals.description')" />
  <AppErrorNote v-if="error" data-testid="error">{{ error }}</AppErrorNote>

  <Card v-if="created" class="border-warning-border bg-warning-soft" data-testid="terminal-created">
    <CardHeader>
      <CardTitle class="flex items-center gap-2 text-base"><KeyRoundIcon class="size-4" />{{ tl('terminals.keyTitle') }}</CardTitle>
      <CardDescription class="text-text-secondary">{{ tl('terminals.keyHelp') }}</CardDescription>
    </CardHeader>
    <CardContent class="space-y-3">
      <code class="block break-all rounded-md border bg-card p-3 font-mono text-sm" data-testid="terminal-key">{{ created.apiKey }}</code>
      <p class="text-xs text-text-secondary">{{ tl('terminals.id') }} <code class="font-mono" data-testid="terminal-id">{{ created.terminalId }}</code></p>
    </CardContent>
    <CardFooter class="bg-transparent">
      <Button variant="outline" data-testid="terminal-key-dismiss" @click="created = null">{{ tl('terminals.keySaved') }}</Button>
    </CardFooter>
  </Card>

  <Card>
    <CardContent>
      <div class="overflow-hidden rounded-md border">
        <Table>
          <TableHeader class="bg-muted [&_th]:text-xs [&_th]:font-medium [&_th]:text-text-secondary">
            <TableRow class="hover:bg-muted"><TableHead class="px-4">{{ tl('common.label') }}</TableHead><TableHead>{{ tl('common.location') }}</TableHead><TableHead>{{ tl('terminals.publicKey') }}</TableHead><TableHead>{{ tl('terminals.lastSeen') }}</TableHead><TableHead>{{ tl('common.status') }}</TableHead><TableHead class="px-4" /></TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="t in rows" :key="t.id" class="h-[52px]" data-testid="terminal-row" :data-terminal-id="t.id">
              <TableCell class="px-4 font-medium" data-testid="terminal-label-cell">{{ t.label }}</TableCell>
              <TableCell>{{ t.locationName }}</TableCell>
              <TableCell class="font-mono text-xs text-muted-foreground">{{ t.signingPublicKey.slice(0, 12) }}…</TableCell>
              <TableCell>{{ t.lastSeenAt ? amsterdam(t.lastSeenAt) : '-' }}</TableCell>
              <TableCell><AppStatusBadge :status="t.revokedAt ? 'revoked' : 'active'" data-testid="terminal-status" /></TableCell>
              <TableCell class="px-4 text-right">
                <Button v-if="!t.revokedAt" :variant="confirming === t.id ? 'destructive' : 'ghost'" :class="confirming === t.id ? '' : 'text-danger hover:text-danger'" :data-testid="confirming === t.id ? 'terminal-revoke-confirm' : 'terminal-revoke'" @click="revoke(t.id)">
                  {{ confirming === t.id ? tl('terminals.confirmRevoke') : tl('terminals.revoke') }}
                </Button>
              </TableCell>
            </TableRow>
            <TableRow v-if="!rows.length" class="hover:bg-transparent"><TableCell colspan="6" class="h-[52px] text-center text-muted-foreground">{{ tl('terminals.empty') }}</TableCell></TableRow>
          </TableBody>
        </Table>
      </div>
    </CardContent>
  </Card>

  <Card>
    <form @submit.prevent="create">
      <CardHeader>
        <CardTitle class="text-base">{{ tl('terminals.register') }}</CardTitle>
        <CardDescription>{{ tl('terminals.registerHelp') }}</CardDescription>
      </CardHeader>
      <CardContent class="mt-4 space-y-6">
        <div class="grid gap-6 sm:grid-cols-2">
          <div class="space-y-2"><Label for="terminal-label">{{ tl('common.label') }}</Label><Input id="terminal-label" v-model="form.label" required data-testid="terminal-label" /></div>
          <div class="space-y-2">
            <Label for="terminal-location">{{ tl('common.location') }}</Label>
            <AppNativeSelect id="terminal-location" v-model="form.locationId" required data-testid="terminal-location">
              <option v-for="l in locations" :key="l.id" :value="l.id">{{ l.name }}</option>
            </AppNativeSelect>
          </div>
        </div>
        <div class="space-y-2">
          <Label for="terminal-public-key">{{ tl('terminals.publicKeyLabel') }}</Label>
          <Input id="terminal-public-key" v-model="form.publicKey" required class="font-mono text-xs" data-testid="terminal-public-key" />
          <p class="text-xs text-muted-foreground">{{ tl('terminals.publicKeyHelp') }}</p>
        </div>
        <p v-if="generatedPrivateKey" class="text-xs text-text-secondary">{{ tl('terminals.privateKey') }} <code class="break-all font-mono" data-testid="terminal-private-key">{{ generatedPrivateKey }}</code></p>
      </CardContent>
      <CardFooter class="mt-6 justify-end gap-2">
        <Button type="button" variant="outline" data-testid="terminal-generate" @click="generate">{{ tl('terminals.generate') }}</Button>
        <Button data-testid="terminal-create">{{ tl('terminals.create') }}</Button>
      </CardFooter>
    </form>
  </Card>
</template>
