<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Loc { id: string; name: string; address: string | null; postcode: string | null }
const session = sessionState();
const canWrite = computed(() => session.value.user?.role !== 'accountant');
const rows = ref<Loc[]>([]);
const error = ref('');
const draft = reactive({ name: '', address: '', postcode: '' });
const editing = ref<string | null>(null);
const edit = reactive({ name: '', address: '', postcode: '' });

const body = (v: { name: string; address: string; postcode: string }) => ({ name: v.name, address: v.address || null, postcode: v.postcode || null });

async function load() {
  const r = await attempt(error, () => $fetch<Loc[]>('/api/dashboard/locations'));
  if (r) rows.value = r;
}
onMounted(load);

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
  <AppPageHeading title="Locations" description="The venues your terminals belong to." />
  <AppErrorNote v-if="error" data-testid="error">{{ error }}</AppErrorNote>

  <Card>
    <CardContent>
      <div class="overflow-hidden rounded-md border">
        <Table>
          <TableHeader class="bg-muted [&_th]:text-xs [&_th]:font-medium [&_th]:text-text-secondary">
            <TableRow class="hover:bg-muted"><TableHead class="px-4">Name</TableHead><TableHead>Address</TableHead><TableHead>Postcode</TableHead><TableHead class="px-4" /></TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="l in rows" :key="l.id" class="h-[52px]" data-testid="location-row">
              <template v-if="editing === l.id">
                <TableCell class="px-4"><Input v-model="edit.name" aria-label="Name" data-testid="location-edit-name" /></TableCell>
                <TableCell><Input v-model="edit.address" aria-label="Address" /></TableCell>
                <TableCell><Input v-model="edit.postcode" aria-label="Postcode" class="w-28" /></TableCell>
                <TableCell class="space-x-2 px-4 text-right"><Button variant="ghost" @click="editing = null">Cancel</Button><Button data-testid="location-save" @click="saveEdit(l.id)">Save</Button></TableCell>
              </template>
              <template v-else>
                <TableCell class="px-4 font-medium">{{ l.name }}</TableCell><TableCell>{{ l.address }}</TableCell><TableCell>{{ l.postcode }}</TableCell>
                <TableCell v-if="canWrite" class="space-x-1 px-4 text-right"><Button variant="ghost" data-testid="location-edit" @click="startEdit(l)">Edit</Button><Button variant="ghost" class="text-danger hover:text-danger" data-testid="location-delete" @click="remove(l.id)">Delete</Button></TableCell>
                <TableCell v-else />
              </template>
            </TableRow>
            <TableRow v-if="!rows.length" class="hover:bg-transparent"><TableCell colspan="4" class="h-[52px] text-center text-muted-foreground">No locations yet.</TableCell></TableRow>
          </TableBody>
        </Table>
      </div>
    </CardContent>
  </Card>

  <Card v-if="canWrite">
    <form @submit.prevent="add">
      <CardHeader><CardTitle class="text-base">Add a location</CardTitle></CardHeader>
      <CardContent class="mt-4 grid gap-6 sm:grid-cols-3">
        <div class="space-y-2"><Label for="location-name">Name</Label><Input id="location-name" v-model="draft.name" required data-testid="location-name" /></div>
        <div class="space-y-2"><Label for="location-address">Address</Label><Input id="location-address" v-model="draft.address" data-testid="location-address" /></div>
        <div class="space-y-2"><Label for="location-postcode">Postcode</Label><Input id="location-postcode" v-model="draft.postcode" placeholder="1011AB" data-testid="location-postcode" /></div>
      </CardContent>
      <CardFooter class="mt-6 justify-end"><Button data-testid="location-add">Add location</Button></CardFooter>
    </form>
  </Card>
</template>
