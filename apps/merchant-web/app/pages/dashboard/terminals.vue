<script setup lang="ts">
import { generateKeyPair } from '@lr/crypto';
import { CheckIcon, CopyIcon, KeyRoundIcon, PlusIcon } from '@lucide/vue';

definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Term { id: string; label: string; locationId: string; locationName: string; signingPublicKey: string; lastSeenAt: string | null; revokedAt: string | null; createdAt: string }
interface Loc { id: string; name: string }

const { t: tl, intlLocale } = useLocale();
const rows = ref<Term[]>([]);
const locations = ref<Loc[]>([]);
const error = ref('');
const refusal = ref<PlanRefusal | null>(null);
const form = reactive({ label: '', locationId: '', publicKey: '' });
// shown exactly once, never stored in the page after dismissal
const created = ref<{ terminalId: string; apiKey: string } | null>(null);
const generatedPrivateKey = ref('');
const confirming = ref<string | null>(null);
const copied = ref(false);
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
const OFFLINE_AFTER_MS = 5 * 60 * 1000;

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
onMounted(() => {
  load();
  timer = setInterval(() => (now.value = Date.now()), 30_000);
});
onBeforeUnmount(() => clearInterval(timer));

// active: never seen yet or seen within 5 minutes; offline: not seen for more than 5 minutes
function statusOf(t: Term): 'revoked' | 'offline' | 'active' {
  if (t.revokedAt) return 'revoked';
  if (t.lastSeenAt && now.value - new Date(t.lastSeenAt).getTime() > OFFLINE_AFTER_MS) return 'offline';
  return 'active';
}
function relative(iso: string | null): string {
  if (!iso) return tl('adm.term.never');
  const sec = Math.round((new Date(iso).getTime() - now.value) / 1000);
  if (sec > -60) return tl('adm.term.justNow');
  const rtf = new Intl.RelativeTimeFormat(intlLocale.value, { numeric: 'auto' });
  const min = Math.round(sec / 60);
  if (Math.abs(min) < 60) return rtf.format(min, 'minute');
  const hr = Math.round(min / 60);
  if (Math.abs(hr) < 24) return rtf.format(hr, 'hour');
  return rtf.format(Math.round(hr / 24), 'day');
}
async function copyKey() {
  if (!created.value) return;
  try {
    await navigator.clipboard.writeText(created.value.apiKey);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    /* clipboard unavailable: the key stays selectable on screen */
  }
}
function focusForm() {
  document.getElementById('terminal-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('terminal-label')?.focus({ preventScroll: true });
}

function generate() {
  const k = generateKeyPair();
  form.publicKey = k.publicKey;
  generatedPrivateKey.value = k.privateKey;
}

async function create() {
  const r = await attemptPlan(error, refusal, () => $fetch<{ terminalId: string; apiKey: string }>('/api/dashboard/terminals', { method: 'POST', body: { label: form.label, locationId: form.locationId, publicKey: form.publicKey } }));
  if (r) {
    created.value = r;
    copied.value = false;
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
  <AppPageHeading :title="tl('nav.terminals')" :description="tl('adm.term.subtitle')">
    <Button data-testid="terminal-add" @click="focusForm"><PlusIcon />{{ tl('adm.term.add') }}</Button>
  </AppPageHeading>
  <AppErrorNote v-if="error" data-testid="error">{{ error }}</AppErrorNote>
  <AppPlanRefusal v-if="refusal" :code="refusal" />

  <Card v-if="created" class="border-warning-border bg-warning-soft" data-testid="terminal-created">
    <CardContent class="space-y-3">
      <div class="flex flex-wrap items-center gap-4">
        <KeyRoundIcon class="size-5 shrink-0 text-warning" />
        <div class="min-w-0 flex-1 basis-56">
          <p class="font-medium text-warning">{{ tl('adm.term.keyNow') }}</p>
          <p class="text-xs text-warning">{{ tl('adm.term.keyOnce') }} {{ tl('terminals.keyHelp') }}</p>
        </div>
        <code class="block min-w-0 max-w-full flex-1 basis-80 break-all rounded-md border bg-card px-3 py-2 font-mono text-[13px] text-foreground" data-testid="terminal-key">{{ created.apiKey }}</code>
        <Button type="button" variant="outline" size="sm" data-testid="terminal-key-copy" @click="copyKey"><component :is="copied ? CheckIcon : CopyIcon" />{{ copied ? tl('adm.copied') : tl('adm.copy') }}</Button>
      </div>
      <p class="text-xs text-text-secondary">{{ tl('terminals.id') }} <code class="font-mono" data-testid="terminal-id">{{ created.terminalId }}</code></p>
      <Button variant="outline" data-testid="terminal-key-dismiss" @click="created = null">{{ tl('terminals.keySaved') }}</Button>
    </CardContent>
  </Card>

  <Card>
    <CardContent>
      <div class="overflow-hidden rounded-md border">
        <Table>
          <TableHeader class="bg-muted [&_th]:text-xs [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-text-secondary">
            <TableRow class="hover:bg-muted"><TableHead class="px-4">{{ tl('adm.term.col.terminal') }}</TableHead><TableHead>{{ tl('common.location') }}</TableHead><TableHead>{{ tl('common.status') }}</TableHead><TableHead>{{ tl('adm.term.lastReceipt') }}</TableHead><TableHead>{{ tl('terminals.publicKey') }}</TableHead><TableHead class="px-4" /></TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="t in rows" :key="t.id" class="h-[52px]" data-testid="terminal-row" :data-terminal-id="t.id">
              <TableCell class="px-4 font-medium" data-testid="terminal-label-cell">{{ t.label }}</TableCell>
              <TableCell>{{ t.locationName }}</TableCell>
              <TableCell>
                <Badge :variant="statusOf(t) === 'active' ? 'success' : statusOf(t) === 'offline' ? 'warning' : 'neutral'" data-testid="terminal-status">{{ statusOf(t) === 'offline' ? tl('adm.status.offline') : tl(statusOf(t) === 'revoked' ? 'status.revoked' : 'status.active') }}</Badge>
              </TableCell>
              <TableCell :title="t.lastSeenAt ? amsterdam(t.lastSeenAt) : undefined">{{ relative(t.lastSeenAt) }}</TableCell>
              <TableCell class="font-mono text-xs text-muted-foreground">{{ t.signingPublicKey.slice(0, 12) }}…</TableCell>
              <TableCell class="px-4 text-right">
                <Button v-if="!t.revokedAt" :variant="confirming === t.id ? 'destructive' : 'outline'" size="sm" :class="confirming === t.id ? '' : 'text-danger hover:text-danger'" :data-testid="confirming === t.id ? 'terminal-revoke-confirm' : 'terminal-revoke'" @click="revoke(t.id)">
                  {{ confirming === t.id ? tl('terminals.confirmRevoke') : tl('terminals.revoke') }}
                </Button>
              </TableCell>
            </TableRow>
            <TableRow v-if="!rows.length" class="hover:bg-transparent"><TableCell colspan="6" class="h-[52px] text-center text-muted-foreground">{{ tl('terminals.empty') }}</TableCell></TableRow>
          </TableBody>
        </Table>
      </div>
      <p class="mt-3 text-xs text-muted-foreground">{{ tl('adm.term.offlineHint') }}</p>
    </CardContent>
  </Card>

  <Card id="terminal-form">
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
