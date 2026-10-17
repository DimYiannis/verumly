<script setup lang="ts">
import { MapPinIcon, PlusIcon } from '@lucide/vue';

definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Loc { id: string; name: string; address: string | null; postcode: string | null }
const { t } = useLocale();
const session = sessionState();
const canWrite = computed(() => session.value.user?.role !== 'accountant');
const rows = ref<Loc[]>([]);
const termCount = ref<Record<string, number>>({});
const error = ref('');
const draft = reactive({ name: '', address: '', postcode: '' });
const editing = ref<string | null>(null);
const edit = reactive({ name: '', address: '', postcode: '' });

const body = (v: { name: string; address: string; postcode: string }) => ({ name: v.name, address: v.address || null, postcode: v.postcode || null });

async function load() {
  const [r, terms] = await Promise.all([
    attempt(error, () => $fetch<Loc[]>('/api/dashboard/locations')),
    attempt(error, () => $fetch<{ locationId: string; revokedAt: string | null }[]>('/api/dashboard/terminals')),
  ]);
  if (r) rows.value = r;
  if (terms) {
    const counts: Record<string, number> = {};
    for (const x of terms) if (!x.revokedAt) counts[x.locationId] = (counts[x.locationId] ?? 0) + 1;
    termCount.value = counts;
  }
}
onMounted(load);

function terminalsLabel(id: string): string {
  const n = termCount.value[id] ?? 0;
  return n === 0 ? t('adm.loc.noTerminals') : n === 1 ? t('adm.loc.terminalsOne') : t('adm.loc.terminalsMany', { n });
}
function focusForm() {
  document.getElementById('location-name')?.focus();
}

async function add() {
  if (await attempt(error, () => $fetch<unknown>('/api/dashboard/locations', { method: 'POST', body: body(draft) }))) {
    Object.assign(draft, { name: '', address: '', postcode: '' });
    await load();
  }
}
function startEdit(l: Loc) {
  editing.value = l.id;
  Object.assign(edit, { name: l.name, address: l.address ?? '', postcode: l.postcode ?? '' });
}
async function saveEdit(id: string) {
  if (await attempt(error, () => $fetch<unknown>(`/api/dashboard/locations/${id}`, { method: 'PUT', body: body(edit) }))) {
    editing.value = null;
    await load();
  }
}
async function remove(id: string) {
  if (await attempt(error, () => $fetch<unknown>(`/api/dashboard/locations/${id}`, { method: 'DELETE' }))) await load();
}
</script>

<template>
  <AppPageHeading :title="t('nav.locations')" :description="t('adm.loc.subtitle')">
    <Button v-if="canWrite" data-testid="location-new" @click="focusForm"><PlusIcon />{{ t('adm.loc.add') }}</Button>
  </AppPageHeading>
  <AppErrorNote v-if="error" data-testid="error">{{ error }}</AppErrorNote>

  <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
    <div class="flex flex-col gap-3">
      <Card v-for="l in rows" :key="l.id" data-testid="location-row">
        <CardContent class="flex items-start gap-4">
          <span class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><MapPinIcon class="size-6" /></span>
          <template v-if="editing === l.id">
            <div class="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
              <Input v-model="edit.name" :aria-label="t('common.name')" data-testid="location-edit-name" />
              <Input v-model="edit.address" :aria-label="t('common.address')" />
              <Input v-model="edit.postcode" :aria-label="t('common.postcode')" />
              <div class="flex justify-end gap-2">
                <Button variant="ghost" @click="editing = null">{{ t('common.cancel') }}</Button>
                <Button data-testid="location-save" @click="saveEdit(l.id)">{{ t('common.save') }}</Button>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="min-w-0 flex-1 space-y-1">
              <p class="text-base font-medium">{{ l.name }}</p>
              <p class="text-sm text-muted-foreground">{{ [l.address, l.postcode].filter(Boolean).join(', ') }}</p>
              <div class="flex gap-2 pt-1"><Badge variant="accent">{{ terminalsLabel(l.id) }}</Badge></div>
            </div>
            <div v-if="canWrite" class="flex shrink-0 gap-1">
              <Button variant="outline" size="sm" data-testid="location-edit" @click="startEdit(l)">{{ t('common.edit') }}</Button>
              <Button variant="ghost" size="sm" class="text-danger hover:text-danger" data-testid="location-delete" @click="remove(l.id)">{{ t('common.delete') }}</Button>
            </div>
          </template>
        </CardContent>
      </Card>
      <Card v-if="!rows.length"><CardContent class="text-center text-muted-foreground">{{ t('locations.empty') }}</CardContent></Card>
    </div>

    <Card v-if="canWrite">
      <form @submit.prevent="add">
        <CardHeader><CardTitle class="text-base">{{ t('adm.loc.add') }}</CardTitle></CardHeader>
        <CardContent class="mt-4 space-y-4">
          <div class="space-y-2"><Label for="location-name">{{ t('common.name') }}</Label><Input id="location-name" v-model="draft.name" required :placeholder="t('adm.loc.namePlaceholder')" data-testid="location-name" /></div>
          <div class="space-y-2"><Label for="location-address">{{ t('common.address') }}</Label><Input id="location-address" v-model="draft.address" :placeholder="t('adm.loc.addressPlaceholder')" data-testid="location-address" /></div>
          <div class="space-y-2"><Label for="location-postcode">{{ t('common.postcode') }}</Label><Input id="location-postcode" v-model="draft.postcode" placeholder="1011AB" data-testid="location-postcode" /></div>
        </CardContent>
        <CardFooter class="mt-6"><Button class="w-full" data-testid="location-add">{{ t('adm.loc.save') }}</Button></CardFooter>
      </form>
    </Card>
  </div>
</template>
