<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Exp { id: string; kind: string; periodFrom: string; periodTo: string; status: string; createdAt: string; link: string | null; linkExpiresAt: string | null }
const KINDS = [
  { value: 'btw_csv', label: 'Accountant: BTW per day (rubriek 1a / 1b / 1e)' },
  { value: 'sales_csv', label: 'Sales per receipt' },
];
const today = new Date().toISOString().slice(0, 10);
const rows = ref<Exp[]>([]);
const error = ref('');
const form = reactive({ kind: 'btw_csv', from: today.slice(0, 8) + '01', to: today });
let timer: ReturnType<typeof setInterval> | undefined;

async function load() {
  const r = await attempt(error, () => $fetch<Exp[]>('/api/dashboard/exports'));
  if (r) rows.value = r;
}
onMounted(() => {
  void load();
  // keep polling while the worker is still producing a file
  timer = setInterval(() => {
    if (rows.value.some((r) => r.status === 'queued' || r.status === 'processing')) void load();
  }, 3000);
});
onBeforeUnmount(() => clearInterval(timer));

async function request() {
  if (await attempt(error, () => $fetch<unknown>('/api/dashboard/exports', { method: 'POST', body: { ...form } }))) await load();
}
</script>

<template>
  <AppPageHeading title="Exports" description="CSV files for your accountant and for your own analysis." />

  <Card>
    <form @submit.prevent="request">
      <CardContent class="grid items-end gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <div class="space-y-2 lg:col-span-2">
          <Label for="export-kind">Export</Label>
          <AppNativeSelect id="export-kind" v-model="form.kind" data-testid="export-kind"><option v-for="k in KINDS" :key="k.value" :value="k.value">{{ k.label }}</option></AppNativeSelect>
        </div>
        <div class="space-y-2"><Label for="export-from">From</Label><Input id="export-from" v-model="form.from" type="date" required data-testid="export-from" /></div>
        <div class="space-y-2"><Label for="export-to">To</Label><Input id="export-to" v-model="form.to" type="date" required data-testid="export-to" /></div>
      </CardContent>
      <CardFooter class="mt-6 justify-end"><Button data-testid="export-request">Request export</Button></CardFooter>
    </form>
  </Card>

  <AppErrorNote v-if="error" data-testid="error">{{ error }}</AppErrorNote>

  <Card>
    <CardContent>
      <div class="overflow-hidden rounded-md border">
        <Table>
          <TableHeader class="bg-muted [&_th]:text-xs [&_th]:font-medium [&_th]:text-text-secondary">
            <TableRow class="hover:bg-muted"><TableHead class="px-4">Requested</TableHead><TableHead>Kind</TableHead><TableHead>Period</TableHead><TableHead>Status</TableHead><TableHead class="px-4">Download</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="e in rows" :key="e.id" class="h-[52px]" data-testid="export-row" :data-status="e.status">
              <TableCell class="px-4">{{ amsterdam(e.createdAt) }}</TableCell>
              <TableCell>{{ e.kind }}</TableCell>
              <TableCell class="tabular-nums">{{ e.periodFrom }} to {{ e.periodTo }}</TableCell>
              <TableCell><AppStatusBadge :status="e.status" data-testid="export-status" /></TableCell>
              <TableCell class="px-4"><a v-if="e.link" :href="e.link" data-testid="export-link" class="font-medium text-primary hover:underline">Download (valid 24 h)</a></TableCell>
            </TableRow>
            <TableRow v-if="!rows.length" class="hover:bg-transparent"><TableCell colspan="5" class="h-[52px] text-center text-muted-foreground">No exports yet.</TableCell></TableRow>
          </TableBody>
        </Table>
      </div>
    </CardContent>
  </Card>
</template>
